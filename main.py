from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from concurrent.futures import ThreadPoolExecutor, as_completed
from requests.exceptions import HTTPError
from threading import Lock
import logging
import random
import time

from Cliente_JPL_Horizons import pedir_cordenadas, pedir_elementos_orbitales

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("sistema-solar")

app = FastAPI()

# Metadata visual de cada cuerpo: id de JPL Horizons, color y radio (exagerado
# para que se vean en pantalla; no está a escala real de tamaño, solo de
# distancia). "es_sol": True se salta el pedido de elementos orbitales,
# porque orbitar el baricentro no tiene sentido físico para el propio Sol.
CUERPOS = {
    "Sol":      {"id": "10",  "color": "#ffcc00", "radio": 3,    "es_sol": True},
    "Mercurio": {"id": "199", "color": "#9c9c9c", "radio": 0.6},
    "Venus":    {"id": "299", "color": "#e8cda2", "radio": 0.9},
    "Tierra":   {"id": "399", "color": "#2b6cb0", "radio": 0.95},
    "Marte":    {"id": "499", "color": "#c1440e", "radio": 0.7},
    "Júpiter":  {"id": "599", "color": "#d9a066", "radio": 2.4},
    "Saturno":  {"id": "699", "color": "#ead6a6", "radio": 2.0},
    "Urano":    {"id": "799", "color": "#9fe3f0", "radio": 1.5},
    "Neptuno":  {"id": "899", "color": "#3f5efb", "radio": 1.45},
}

CACHE_TTL_SEGUNDOS = 300  # 5 minutos, para no golpear la API de la NASA
_cache_lock = Lock()
_cache = {"timestamp": 0, "datos": None}

# JPL Horizons devuelve 503 "Service Temporarily Unavailable" cuando le llegan
# demasiadas solicitudes en paralelo (con 9 cuerpos x hasta 2 llamadas cada uno,
# lanzar todo con 9 workers simultáneos la satura). Con menos workers a la vez
# hay menos solicitudes concurrentes golpeando la API en el mismo instante.
MAX_WORKERS_SIMULTANEOS = 3

# Reintentos con backoff exponencial, solo para 503 (servicio ocupado/caído
# temporalmente). Otros errores HTTP (404, 400, etc.) no se reintentan porque
# no son un problema de saturación, sino de la solicitud en sí.
MAX_REINTENTOS = 4
ESPERA_BASE_SEGUNDOS = 1.5


def _con_reintentos(func, *args, nombre="", etiqueta="", **kwargs):
    for intento in range(1, MAX_REINTENTOS + 1):
        try:
            return func(*args, **kwargs)
        except HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status == 503 and intento < MAX_REINTENTOS:
                espera = ESPERA_BASE_SEGUNDOS * (2 ** (intento - 1)) + random.uniform(0, 0.5)
                logger.warning(
                    "JPL Horizons devolvió 503 (ocupado) pidiendo %s de %s, intento %d/%d. "
                    "Reintentando en %.1fs...",
                    etiqueta, nombre, intento, MAX_REINTENTOS, espera,
                )
                time.sleep(espera)
                continue
            raise


def _obtener_datos_cuerpo(nombre: str, info: dict):
    """Devuelve (nombre, datos_o_None, mensaje_error_o_None).

    Nunca deja que una excepción de red se pierda en silencio: si algo falla,
    queda registrado en el log del servidor (uvicorn) con el nombre del
    cuerpo y el id de JPL Horizons involucrado, para poder diagnosticar por
    qué un cuerpo (o todos) no aparecen en la escena.
    """
    try:
        coords = _con_reintentos(pedir_cordenadas, info["id"], nombre=nombre, etiqueta="coordenadas")
    except Exception as exc:
        logger.error("Excepción pidiendo coordenadas de %s (id %s): %s", nombre, info["id"], exc)
        return nombre, None, f"excepción al pedir coordenadas: {exc}"

    if coords is None:
        logger.warning(
            "JPL Horizons respondió pero no se pudo leer X/Y/Z para %s (id %s). "
            "Puede que el formato de la respuesta haya cambiado o que el id esté mal.",
            nombre, info["id"],
        )
        return nombre, None, "JPL Horizons no devolvió coordenadas legibles"

    elementos = None
    if not info.get("es_sol"):
        try:
            elementos = _con_reintentos(
                pedir_elementos_orbitales, info["id"], nombre=nombre, etiqueta="elementos orbitales"
            )
        except Exception as exc:
            logger.error("Excepción pidiendo elementos orbitales de %s (id %s): %s", nombre, info["id"], exc)
        if elementos is None:
            logger.warning(
                "No se pudieron leer elementos orbitales de %s (id %s); se dibujará "
                "el planeta pero sin aro de órbita.", nombre, info["id"],
            )

    logger.info("OK %s: coords=%s | elementos_orbitales=%s", nombre, coords, "sí" if elementos else "no")

    return nombre, {
        "color": info["color"],
        "radio": info["radio"],
        "coordenadas": coords,
        "elementos_orbitales": elementos,
    }, None


def _consultar_sistema_solar():
    cuerpos = {}
    errores = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS_SIMULTANEOS) as executor:
        futuros = [executor.submit(_obtener_datos_cuerpo, nombre, info) for nombre, info in CUERPOS.items()]
        for futuro in as_completed(futuros):
            nombre, datos, error = futuro.result()
            if datos is not None:
                cuerpos[nombre] = datos
            if error:
                errores[nombre] = error
    return {"cuerpos": cuerpos, "errores": errores}


@app.get("/api/sistema-solar")
def obtener_sistema_solar():
    with _cache_lock:
        ahora = time.time()
        if _cache["datos"] is not None and (ahora - _cache["timestamp"]) < CACHE_TTL_SEGUNDOS:
            return _cache["datos"]

    resultado = _consultar_sistema_solar()
    logger.info(
        "Consulta a JPL Horizons completa: %d cuerpos OK, %d con error (%s)",
        len(resultado["cuerpos"]), len(resultado["errores"]), list(resultado["errores"].keys()),
    )

    with _cache_lock:
        _cache["timestamp"] = time.time()
        _cache["datos"] = resultado

    return resultado


# Servir archivos del frontend (debe ir al final, después de las rutas de la API)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
