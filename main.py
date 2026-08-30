from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from concurrent.futures import ThreadPoolExecutor, as_completed
from requests.exceptions import HTTPError
from threading import Lock
from datetime import datetime, timezone
from typing import Optional
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

# Metadata de cada cuerpo: id de JPL Horizons, color, radio real (km, fuente:
# NASA Planetary Fact Sheet / JPL Small-Body Database) y radio exagerado
# (elegido a mano solo para que los cuerpos sean visibles/clickeables sin
# acercar tanto la cámara). El frontend elige cuál de los dos usar según el
# modo de escala de tamaño que tenga seleccionado.
#
# "categoria": "sol" | "planeta" | "luna" | "satelite" — el frontend agrupa
# el índice (menú izquierdo) usando este campo, así que agregar un cuerpo acá
# alcanza para que aparezca clasificado correctamente sin tocar el frontend.
#
# "cuerpo_padre": nombre (tal cual aparece como clave en este mismo dict) del
# cuerpo alrededor del cual orbita, o None si orbita el baricentro (planetas,
# el Sol, y las sondas heliocéntricas). Las lunas SÍ llevan cuerpo_padre.
#
# "centro": código de CENTER de JPL Horizons. '500@0' = baricentro del
# sistema solar (lo que usan el Sol, los planetas y las sondas). Para lunas
# se usa '500@<id_del_planeta>' (geocéntrico/planetocéntrico) — si se dejara
# en '500@0', las coordenadas de una luna vendrían dominadas por la órbita
# de su planeta alrededor del Sol, y su órbita alrededor del planeta (mucho
# más chica) sería indistinguible del ruido.
#
# "es_sol": True se salta el pedido de elementos orbitales (ver
# _obtener_datos_cuerpo), porque orbitar el propio origen de su centro no
# tiene sentido físico (el Sol respecto al baricentro).
#
# Para agregar un cuerpo nuevo: solo hace falta una entrada acá con su id de
# JPL Horizons correcto (buscar en https://ssd.jpl.nasa.gov/horizons/app.html)
# y, si es una luna, el nombre exacto de su "cuerpo_padre" y el CENTER
# correspondiente a ese padre.
CUERPOS = {
    # --- Sol ---
    "Sol": {
        "id": "10", "color": "#ffcc00", "radio_km": 696000, "radio_exagerado": 3,
        "es_sol": True, "categoria": "sol", "cuerpo_padre": None, "centro": "500@0",
    },

    # --- Planetas (todos heliocéntricos: centro = baricentro del sistema) ---
    "Mercurio": {"id": "199", "color": "#9c9c9c", "radio_km": 2439.7, "radio_exagerado": 0.6,
                 "categoria": "planeta", "cuerpo_padre": None, "centro": "500@0"},
    "Venus":    {"id": "299", "color": "#e8cda2", "radio_km": 6051.8, "radio_exagerado": 0.9,
                 "categoria": "planeta", "cuerpo_padre": None, "centro": "500@0"},
    "Tierra":   {"id": "399", "color": "#2b6cb0", "radio_km": 6371.0, "radio_exagerado": 0.95,
                 "categoria": "planeta", "cuerpo_padre": None, "centro": "500@0"},
    "Marte":    {"id": "499", "color": "#c1440e", "radio_km": 3389.5, "radio_exagerado": 0.7,
                 "categoria": "planeta", "cuerpo_padre": None, "centro": "500@0"},
    "Júpiter":  {"id": "599", "color": "#d9a066", "radio_km": 69911, "radio_exagerado": 2.4,
                 "categoria": "planeta", "cuerpo_padre": None, "centro": "500@0"},
    "Saturno":  {"id": "699", "color": "#ead6a6", "radio_km": 58232, "radio_exagerado": 2.0,
                 "categoria": "planeta", "cuerpo_padre": None, "centro": "500@0"},
    "Urano":    {"id": "799", "color": "#9fe3f0", "radio_km": 25362, "radio_exagerado": 1.5,
                 "categoria": "planeta", "cuerpo_padre": None, "centro": "500@0"},
    "Neptuno":  {"id": "899", "color": "#3f5efb", "radio_km": 24622, "radio_exagerado": 1.45,
                 "categoria": "planeta", "cuerpo_padre": None, "centro": "500@0"},
    # Plutón es un planeta enano, no un planeta — pero para esta escena se
    # trata igual que los demás (categoría "planeta") por simplicidad.
    "Plutón":   {"id": "999", "color": "#c9b8a0", "radio_km": 1188.3, "radio_exagerado": 0.5,
                 "categoria": "planeta", "cuerpo_padre": None, "centro": "500@0"},
    # Ceres también es un planeta enano (el más grande del cinturón de
    # asteroides, entre Marte y Júpiter), tratado igual que Plutón. Se usa
    # su SPK-ID ("2000001", el identificador dedicado de JPL Horizons para
    # efemérides) en vez del atajo de designación "1;" — este último quedó
    # resolviendo mal (Ceres aparecía pegada al Sol, con coordenadas casi
    # nulas). Si el SPK-ID también fallara, revisar el log del servidor y
    # buscar el id correcto en https://ssd.jpl.nasa.gov/horizons/app.html
    "Ceres":    {"id": "2000001", "color": "#8f8578", "radio_km": 469.7, "radio_exagerado": 0.35,
                 "categoria": "planeta", "cuerpo_padre": None, "centro": "500@0"},

    # --- Lunas (centro = planetocéntrico del padre correspondiente) ---
    "Luna":       {"id": "301", "color": "#c9c9c9", "radio_km": 1737.4, "radio_exagerado": 0.35,
                    "categoria": "luna", "cuerpo_padre": "Tierra", "centro": "500@399"},
    "Fobos":      {"id": "401", "color": "#8a7f6e", "radio_km": 11.1, "radio_exagerado": 0.12,
                    "categoria": "luna", "cuerpo_padre": "Marte", "centro": "500@499"},
    "Deimos":     {"id": "402", "color": "#9c9184", "radio_km": 6.2, "radio_exagerado": 0.1,
                    "categoria": "luna", "cuerpo_padre": "Marte", "centro": "500@499"},
    "Io":         {"id": "501", "color": "#e5d07b", "radio_km": 1821.6, "radio_exagerado": 0.3,
                    "categoria": "luna", "cuerpo_padre": "Júpiter", "centro": "500@599"},
    "Europa":     {"id": "502", "color": "#c9b491", "radio_km": 1560.8, "radio_exagerado": 0.28,
                    "categoria": "luna", "cuerpo_padre": "Júpiter", "centro": "500@599"},
    "Ganimedes":  {"id": "503", "color": "#9c8d78", "radio_km": 2634.1, "radio_exagerado": 0.34,
                    "categoria": "luna", "cuerpo_padre": "Júpiter", "centro": "500@599"},
    "Calisto":    {"id": "504", "color": "#5b5348", "radio_km": 2410.3, "radio_exagerado": 0.33,
                    "categoria": "luna", "cuerpo_padre": "Júpiter", "centro": "500@599"},
    "Titán":      {"id": "606", "color": "#d9a441", "radio_km": 2574.7, "radio_exagerado": 0.33,
                    "categoria": "luna", "cuerpo_padre": "Saturno", "centro": "500@699"},
    "Encélado":   {"id": "602", "color": "#eef4f7", "radio_km": 252.1, "radio_exagerado": 0.15,
                    "categoria": "luna", "cuerpo_padre": "Saturno", "centro": "500@699"},
    "Tritón":     {"id": "801", "color": "#e8c9a8", "radio_km": 1353.4, "radio_exagerado": 0.3,
                    "categoria": "luna", "cuerpo_padre": "Neptuno", "centro": "500@899"},
    "Caronte":    {"id": "901", "color": "#a89a8c", "radio_km": 606.0, "radio_exagerado": 0.2,
                    "categoria": "luna", "cuerpo_padre": "Plutón", "centro": "500@999"},

    # --- Satélites artificiales / sondas (heliocéntricas, centro = baricentro) ---
    # Nota: la ISS y otros satélites en órbita terrestre baja NO están acá
    # porque JPL Horizons no las trackea de forma confiable (son objetos
    # cercanos a la Tierra con perturbaciones que Horizons no modela bien
    # para consultas rápidas). En cambio, estas sondas SÍ tienen efemérides
    # reales y verificables en Horizons. Los radios reales son aproximados
    # (son objetos de metros, no esferas — el número solo evita un radio 0).
    "Voyager 1":         {"id": "-31",  "color": "#ffffff", "radio_km": 0.002, "radio_exagerado": 0.15,
                           "categoria": "satelite", "cuerpo_padre": None, "centro": "500@0"},
    "Voyager 2":         {"id": "-32",  "color": "#e0e0e0", "radio_km": 0.002, "radio_exagerado": 0.15,
                           "categoria": "satelite", "cuerpo_padre": None, "centro": "500@0"},
    "New Horizons":      {"id": "-98",  "color": "#ffd27f", "radio_km": 0.001, "radio_exagerado": 0.12,
                           "categoria": "satelite", "cuerpo_padre": None, "centro": "500@0"},
    "Parker Solar Probe": {"id": "-96",  "color": "#ff7f50", "radio_km": 0.0015, "radio_exagerado": 0.13,
                            "categoria": "satelite", "cuerpo_padre": None, "centro": "500@0"},
    "James Webb (JWST)": {"id": "-170", "color": "#c7d6ff", "radio_km": 0.0002, "radio_exagerado": 0.11,
                           "categoria": "satelite", "cuerpo_padre": None, "centro": "500@0"},
}

# TTL solo para la consulta "en tiempo real" (sin fecha elegida por el
# usuario), ya que ahí la posición sí cambia con el paso del tiempo.
CACHE_TTL_SEGUNDOS = 300  # 5 minutos, para no golpear la API de la NASA

# La caché ahora es por fecha consultada: {clave: {"timestamp":..., "datos":...}}.
# clave = "ahora" para tiempo real, o la fecha 'YYYY-MM-DD' elegida por el
# usuario. Una fecha fija (pasada o futura) no cambia nunca, así que esas
# entradas no expiran por TTL — solo se recalculan si el proceso se reinicia.
_cache_lock = Lock()
_cache: dict = {}

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


def _obtener_datos_cuerpo(nombre: str, info: dict, fecha: Optional[datetime]):
    """Devuelve (nombre, datos_o_None, error_o_None). "error", si existe, es
    un dict {"mensaje": str, "categoria": str} — la categoría viaja junto al
    mensaje para que el frontend pueda decidir cómo tratar el error sin
    tener que mantener una lista aparte de qué cuerpos son satélites (p. ej.
    para no mostrar como "error" que una sonda no exista todavía en una
    fecha anterior a su lanzamiento).

    Nunca deja que una excepción de red se pierda en silencio: si algo falla,
    queda registrado en el log del servidor (uvicorn) con el nombre del
    cuerpo y el id de JPL Horizons involucrado, para poder diagnosticar por
    qué un cuerpo (o todos) no aparecen en la escena.
    """
    centro = info.get("centro", "500@0")
    categoria = info["categoria"]

    try:
        coords = _con_reintentos(
            pedir_cordenadas, info["id"], fecha, centro, nombre=nombre, etiqueta="coordenadas"
        )
    except Exception as exc:
        logger.error("Excepción pidiendo coordenadas de %s (id %s): %s", nombre, info["id"], exc)
        return nombre, None, {"mensaje": f"excepción al pedir coordenadas: {exc}", "categoria": categoria}

    if coords is None:
        logger.warning(
            "JPL Horizons respondió pero no se pudo leer X/Y/Z para %s (id %s, centro %s). "
            "Puede que el formato de la respuesta haya cambiado, que el id/centro esté mal, "
            "o que la fecha pedida esté fuera del rango que cubre Horizons.",
            nombre, info["id"], centro,
        )
        return nombre, None, {"mensaje": "JPL Horizons no devolvió coordenadas legibles", "categoria": categoria}

    elementos = None
    if not info.get("es_sol"):
        try:
            elementos = _con_reintentos(
                pedir_elementos_orbitales, info["id"], fecha, centro,
                nombre=nombre, etiqueta="elementos orbitales",
            )
        except Exception as exc:
            logger.error("Excepción pidiendo elementos orbitales de %s (id %s): %s", nombre, info["id"], exc)
        if elementos is None:
            logger.warning(
                "No se pudieron leer elementos orbitales de %s (id %s); se dibujará "
                "el cuerpo pero sin aro de órbita.", nombre, info["id"],
            )

    logger.info("OK %s: coords=%s | elementos_orbitales=%s", nombre, coords, "sí" if elementos else "no")

    return nombre, {
        "color": info["color"],
        "radio_km": info["radio_km"],
        "radio_exagerado": info["radio_exagerado"],
        "categoria": categoria,
        "cuerpo_padre": info.get("cuerpo_padre"),
        "coordenadas": coords,
        "elementos_orbitales": elementos,
    }, None


def _consultar_sistema_solar(fecha: Optional[datetime]):
    cuerpos = {}
    errores = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS_SIMULTANEOS) as executor:
        futuros = [
            executor.submit(_obtener_datos_cuerpo, nombre, info, fecha)
            for nombre, info in CUERPOS.items()
        ]
        for futuro in as_completed(futuros):
            nombre, datos, error = futuro.result()
            if datos is not None:
                cuerpos[nombre] = datos
            if error:
                errores[nombre] = error
    return {"cuerpos": cuerpos, "errores": errores}


@app.get("/api/sistema-solar")
def obtener_sistema_solar(fecha: Optional[str] = None):
    """fecha (query param opcional): 'YYYY-MM-DD'. Si se omite, se consultan
    las posiciones en tiempo real (instante actual). Si se indica, se piden
    las posiciones de JPL Horizons para el mediodía UTC de esa fecha.
    """
    fecha_dt = None
    if fecha:
        try:
            fecha_dt = datetime.strptime(fecha, "%Y-%m-%d").replace(hour=12, minute=0, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Fecha inválida: '{fecha}'. Se espera el formato YYYY-MM-DD.",
            )

    clave_cache = fecha or "ahora"
    es_tiempo_real = fecha_dt is None

    with _cache_lock:
        entrada = _cache.get(clave_cache)
        if entrada is not None:
            # Tiempo real expira a los 5 minutos; una fecha fija (pasada o
            # futura) no cambia nunca, así que se sirve de caché indefinidamente.
            vigente = (not es_tiempo_real) or (time.time() - entrada["timestamp"] < CACHE_TTL_SEGUNDOS)
            if vigente:
                return entrada["datos"]

    resultado = _consultar_sistema_solar(fecha_dt)
    logger.info(
        "Consulta a JPL Horizons completa (%s): %d cuerpos OK, %d con error (%s)",
        clave_cache, len(resultado["cuerpos"]), len(resultado["errores"]), list(resultado["errores"].keys()),
    )

    with _cache_lock:
        _cache[clave_cache] = {"timestamp": time.time(), "datos": resultado}

    return resultado


# Servir archivos del frontend (debe ir al final, después de las rutas de la API)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
