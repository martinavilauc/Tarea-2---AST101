import asyncio
import logging
import random
import re
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from Cliente_JPL_Horizons import (
    pedir_cordenadas,
    pedir_elementos_orbitales,
    pedir_trayectoria,
)

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

# ============================================================
# Catálogo de MISIONES (modo "misiones")
# ============================================================
# Cada misión define una sonda del catálogo CUERPOS de arriba y una ventana
# de tiempo; el backend pide a JPL Horizons la trayectoria de esa sonda Y de
# todos los cuerpos del sistema solar a lo largo de esa ventana, para poder
# reproducirla como una animación en el frontend.
#
# Para agregar una misión nueva alcanza con una entrada acá (igual que con
# los cuerpos), más —opcionalmente— dos archivos con el mismo "slug" que se
# calcula desde el nombre (minúsculas, sin tildes, espacios como guiones):
#   - static/resources/misiones/<slug>.jpg -> preview del menú de misiones
#   - static/resources/misiones/<slug>.txt -> descripción larga (mismo
#         formato que la de los cuerpos)
# Van en su propia subcarpeta a propósito: el slug de una misión puede
# coincidir con el de un cuerpo (la misión "Voyager 1" y la sonda
# "Voyager 1" dan el mismo "voyager-1"), y en una carpeta compartida una
# imagen pisaría a la otra.
#
# Campos:
#   "cuerpo": nombre EXACTO (clave de CUERPOS) de la sonda protagonista.
#   "inicio"/"fin": 'YYYY-MM-DD'. Rango que cubre la animación. Debe estar
#       dentro del rango que Horizons tiene para esa sonda (típicamente
#       desde poco después del lanzamiento).
#   "paso": STEP_SIZE de Horizons ("30d", "1y", "6h"...). Es el que define
#       cuántos cuadros tiene la animación: rango/paso. Ojo con pasos muy
#       chicos en rangos largos — son muchísimos puntos y una respuesta
#       enorme desde Horizons.
#   "descripcion_corta": una línea, se muestra en la tarjeta del menú.
MISIONES = {
# Visitante interestelar, de ~6 UA de distancia a la entrada, por la órbita
    # de Marte (3 oct 2025), el perihelio (29 oct 2025), el máximo acercamiento
    # a la Tierra (19 dic 2025) y la órbita de Júpiter (mar 2026), hasta ~14 UA.
    # 578 días / 2 = 289 pasos exactos. Encuadre inicial: el Sol a ~9 UA.
    "Paso de 3I ATLAS": {
        "cuerpo": "3I/ATLAS",
        "inicio": "2024-06-01",
        "fin": "2026-12-31",
        "paso": "2d",
        "encuadre": {"cuerpo": "3I/ATLAS", "distancia_km": 1.4e9},
        "descripcion_corta": "El tercer visitante interestelar cruza la órbita de Marte camino al Sol.",
    },
    "Paso de Oumuamua": {
            "cuerpo": "Oumuamua",
            # De ~4 UA de distancia a la entrada, pasando por el perihelio (dentro
            # de la órbita de Mercurio) y el máximo acercamiento a la Tierra, hasta
            # mucho más allá de Júpiter. Paso de 3 días: el perihelio es rapidísimo
            # (el objeto barre ~11° por día), con pasos de semanas se vería angular.
            "inicio": "2017-01-01",
            "fin": "2019-12-31",
            "paso": "3d",
            "encuadre": {"cuerpo": "Oumuamua", "distancia_km": 4500000000},
            "descripcion_corta": "El primer visitante interestelar conocido cruza el sistema solar.",
    },
    "Voyager 1, al espacio interestelar": {
        "cuerpo": "Voyager 1",
        "inicio": "1977-09-06",
        "fin": "1983-03-09",
        "paso": "30d",
        "encuadre": {"cuerpo": "Voyager 1", "distancia_km": 4500000000},
        "descripcion_corta": "Del lanzamiento al último retrato del sistema solar.",
    },
    "Voyager 2, al Espacio Interestelar, con escalas": {
        "cuerpo": "Voyager 2",
        "inicio": "1980-08-21",
        "fin": "1990-12-31",
        "paso": "30d",
        "encuadre": {"cuerpo": "Voyager 2", "distancia_km": 4500000000},
        "descripcion_corta": "El Gran Tour: Júpiter, Saturno, Urano y Neptuno.",
    },
    "New Horizons, a Plutón": {
        "cuerpo": "New Horizons",
        "inicio": "2006-01-20",
        "fin": "2015-12-31",
        "paso": "30d",
        "encuadre": {"cuerpo": "New Horizons", "distancia_km": 4500000000},
        "descripcion_corta": "Nueve años de viaje hasta el sobrevuelo de Plutón.",
    },
    # Crucero de la Tierra a Marte: se pide desde 2 días después del
    # lanzamiento (30 jul 2020) hasta 1 día antes del aterrizaje (18 feb 2021)
    # para quedar bien adentro de lo que cubre la nave en Horizons. 200 días / 1 = 200 pasos
    # exactos. Encuadre inicial: el Sol a ~3 UA, para ver las órbitas de la Tierra y Marte.
    "Perseverance, a Marte": {
        "cuerpo": "Perseverance",
        "inicio": "2020-08-01",
        "fin": "2021-02-18",
        "paso": "1d",
        "encuadre": {"cuerpo": "Perseverance", "distancia_km": 4.5e8},
        "descripcion_corta": "Siete meses de viaje de la Tierra a Marte, hasta el día antes del aterrizaje.",
    },
    "Messenger, a Mercurio": {
        "cuerpo": "MESSENGER",
        "inicio": "2004-08-04",
        "fin": "2011-05-26",
        "paso": "10d",
        "encuadre": {"cuerpo": "Sol", "distancia_km": 3.7e8},
        "descripcion_corta": "El largo viaje por el sistema solar interior y el estudio orbital de Mercurio.",
    },
}

# Cuerpos que existen SOLO para misiones. Van aparte de CUERPOS a propósito:
# todo lo que está en CUERPOS aparece en la vista normal del sistema solar y
# en el índice (en este caso, ʻOumuamua quedaría listado como "satélite
# artificial", a ~45 UA del Sol, mezclado con las Voyager). Una misión puede
# usar como protagonista un cuerpo de cualquiera de los dos catálogos.
#
# "id_alternativos" (opcional): otros identificadores de JPL Horizons para el
# mismo cuerpo, que se prueban EN ORDEN si el principal no devuelve nada. Sirve
# para cuerpos menores (asteroides/cometas/objetos interestelares), donde el
# identificador que Horizons acepta puede ser la designación ("DES=1I;"), el
# número o el nombre, y no siempre se puede verificar de antemano. Solo se
# listan designaciones y nombres, NUNCA códigos numéricos adivinados: uno
# equivocado podría resolver a OTRO cuerpo y Horizons devolvería datos
# válidos de algo que no es lo que se pidió, sin ningún error.
CUERPOS_MISION = {
    "Oumuamua": {
        "id": "DES=1I;",
        "id_alternativos": ["1I;", "1I/Oumuamua;", "Oumuamua;", "DES=2017 U1;"],
        "color": "#d9765a",       # ligeramente rojizo, como se midió
        "radio_km": 0.1,          # cientos de metros: a escala, un punto
        "radio_exagerado": 0.14,
        # Tratado como una "sonda" (categoría "satelite"): tamaño despreciable,
        # trayectoria suavizada con spline, hitbox propio.
        "categoria": "satelite", "cuerpo_padre": None, "centro": "500@0",
    },
    # 3I/ATLAS (designación provisional C/2025 N1): el tercer objeto
    # interestelar confirmado. Los ids son DESIGNACIONES, nunca números
    # adivinados (ver el comentario de CUERPOS_MISION). Sin verificar contra
    # Horizons: si falla, el error muestra lo que Horizons respondió.
    "3I/ATLAS": {
        "id": "DES=3I;",
        "id_alternativos": ["3I;", "DES=C/2025 N1;", "C/2025 N1;"],
        "color": "#8fd3c2",        # el verdeazulado de su coma
        "radio_km": 1.0,           # orden de magnitud: el núcleo no se mide directamente
        "radio_exagerado": 0.14,
        "categoria": "satelite", "cuerpo_padre": None, "centro": "500@0",
    },
    # Nave Mars 2020 (cruce de la Tierra a Marte, con el rover Perseverance
    # dentro de su cápsula de entrada). Id NAIF -168. Sin verificar contra
    # Horizons; la misión pide solo el tramo de crucero (ver MISIONES).
    "Perseverance": {
        "id": "-168",
        "color": "#ffb36b",
        "radio_km": 0.0015,
        "radio_exagerado": 0.12,
        "categoria": "satelite", "cuerpo_padre": None, "centro": "500@0",
    },
    "MESSENGER": {
        "id": "-236",
        "color": "#b5a89e",
        "radio_km": 0.0015,
        "radio_exagerado": 0.12,
        "categoria": "satelite", "cuerpo_padre": None, "centro": "500@0",
    },
}


def _fecha_mision(texto: str) -> datetime:
    """Fecha de una misión (UTC): 'YYYY-MM-DD' o 'YYYY-MM-DD HH:MM'. La
    segunda forma hace falta para misiones de días, con pasos de horas o minutos."""
    texto = texto.strip()
    for formato in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(texto, formato).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"'{texto}' no tiene el formato 'YYYY-MM-DD' ni 'YYYY-MM-DD HH:MM'")


def _paso_en_segundos(paso: str):
    """El paso de Horizons ('30d', '1h', '30m'...) en segundos, o None si no
    tiene una duración fija (meses, años). El frontend lo usa para calcular la
    fecha EXACTA de cada cuadro como inicio + cuadro × paso: Horizons entrega
    las muestras en inicio + k·paso, y la última queda ANTES de "fin" cuando la
    ventana no es múltiplo del paso (con Voyager 2, 15 días antes)."""
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(d|h|m|min|s)\s*", paso, re.IGNORECASE)
    if not m:
        return None
    return float(m.group(1)) * {"d": 86400, "h": 3600, "m": 60, "min": 60, "s": 1}[m.group(2).lower()]


def _mision_con_hora(mision: dict) -> bool:
    """¿Hay que mostrar la hora (HH:MM) mientras se reproduce? Sí si el paso es
    de horas/minutos/segundos, o si las fechas del catálogo traen hora."""
    if re.fullmatch(r"\s*\d+(?:\.\d+)?\s*(?:h|m|min|s)\s*", mision["paso"], re.IGNORECASE):
        return True
    return len(mision["inicio"].strip()) > 10 or len(mision["fin"].strip()) > 10


def _info_cuerpo(nombre: str):
    """Busca un cuerpo en CUERPOS (vista normal) y, si no está, en
    CUERPOS_MISION (cuerpos exclusivos de misiones)."""
    return CUERPOS.get(nombre) or CUERPOS_MISION.get(nombre)

CACHE_TTL_SEGUNDOS = 300  # 5 minutos, para no golpear la API de la NASA

# La caché ahora es por fecha consultada: {clave: {"timestamp":..., "datos":...}}.
# clave = "ahora" para tiempo real, o la fecha 'YYYY-MM-DD' elegida por el
# usuario. Una fecha fija (pasada o futura) no cambia nunca, así que esas
# entradas no expiran por TTL — solo se recalculan si el proceso se reinicia.
# asyncio.Lock (no threading.Lock): todo el módulo corre en un único loop de
# eventos async, no en hilos del SO.
_cache_lock = asyncio.Lock()
_cache: dict = {}

# Con solicitudes async (esperan I/O sin bloquear el hilo) se sostiene más
# concurrencia real que con hilos del SO, sin gastar más recursos por eso —
# antes 3 hilos vía ThreadPoolExecutor, ahora 6 solicitudes en simultáneo vía
# un semáforo. Si JPL Horizons empieza a devolver más 503, bajar este número.
MAX_CONCURRENCIA = 6

# Reintentos con backoff exponencial, solo para 503 (servicio ocupado/caído
# temporalmente). Otros errores HTTP (404, 400, etc.) no se reintentan porque
# no son un problema de saturación, sino de la solicitud en sí. La espera
# base bajó de 1.5s a 300ms: con asyncio.sleep() la espera no bloquea el
# resto de las solicitudes en curso (a diferencia de time.sleep() en un
# hilo), así que no hace falta ser tan conservador.
MAX_REINTENTOS = 50
ESPERA_BASE_SEGUNDOS = 0.1

# Limita la concurrencia a nivel global para no saturar los worker threads de JPL
_SEMAFORO_JPL = asyncio.Semaphore(4)

async def _con_reintentos(func, *args, nombre="", etiqueta="", **kwargs):
    async with _SEMAFORO_JPL:
        for intento in range(1, MAX_REINTENTOS + 1):
            try:
                return await func(*args, **kwargs)
            except (httpx.HTTPStatusError, httpx.TransportError) as exc:
                # Comprueba si es un 503 o un fallo de conexión/timeout de red
                es_503 = isinstance(exc, httpx.HTTPStatusError) and exc.response is not None and exc.response.status_code == 503
                es_error_red = isinstance(exc, httpx.TransportError)

                if (es_503 or es_error_red) and intento < MAX_REINTENTOS:
                    # Intento 1: reintento instantáneo. Intentos posteriores: backoff exponencial + jitter
                    espera = 0.0 if intento == 1 else (ESPERA_BASE_SEGUNDOS * (2 ** (intento - 2))) + random.uniform(0, 0.1)
                    
                    logger.warning(
                        "JPL Horizons ocupado/falló pidiendo %s de %s, intento %d/%d. Reintentando en %.2fs...",
                        etiqueta, nombre, intento, MAX_REINTENTOS, espera,
                    )
                    if espera > 0:
                        await asyncio.sleep(espera)
                    continue
                raise


async def _obtener_datos_cuerpo(
    cliente: httpx.AsyncClient, semaforo: asyncio.Semaphore, nombre: str, info: dict, fecha: Optional[datetime]
):
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

    # El semáforo bounded a MAX_CONCURRENCIA cuerpos consultándose en
    # simultáneo (cada uno hasta 2 solicitudes, coordenadas + elementos) —
    # mismo rol que "max_workers" cumplía antes con ThreadPoolExecutor.
    async with semaforo:
        try:
            coords = await _con_reintentos(
                pedir_cordenadas, cliente, info["id"], fecha, centro, nombre=nombre, etiqueta="coordenadas"
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
                elementos = await _con_reintentos(
                    pedir_elementos_orbitales, cliente, info["id"], fecha, centro,
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


async def _consultar_sistema_solar(fecha: Optional[datetime]):
    cuerpos = {}
    errores = {}
    semaforo = asyncio.Semaphore(MAX_CONCURRENCIA)

    # Un solo cliente httpx reutilizado para TODAS las solicitudes de esta
    # consulta (hasta ~50 con el catálogo actual): mantiene la conexión
    # TCP/TLS hacia JPL Horizons abierta entre solicitudes en vez de
    # renegociarla en cada una — antes, con requests.get() suelto dentro de
    # cada hilo, cada solicitud abría su propia conexión desde cero.
    async with httpx.AsyncClient() as cliente:
        tareas = [
            _obtener_datos_cuerpo(cliente, semaforo, nombre, info, fecha)
            for nombre, info in CUERPOS.items()
        ]
        resultados = await asyncio.gather(*tareas)

    for nombre, datos, error in resultados:
        if datos is not None:
            cuerpos[nombre] = datos
        if error:
            errores[nombre] = error

    return {"cuerpos": cuerpos, "errores": errores}


@app.get("/api/sistema-solar")
async def obtener_sistema_solar(fecha: Optional[str] = None):
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

    async with _cache_lock:
        entrada = _cache.get(clave_cache)
        if entrada is not None:
            # Tiempo real expira a los 5 minutos; una fecha fija (pasada o
            # futura) no cambia nunca, así que se sirve de caché indefinidamente.
            vigente = (not es_tiempo_real) or (time.time() - entrada["timestamp"] < CACHE_TTL_SEGUNDOS)
            if vigente:
                return entrada["datos"]

    resultado = await _consultar_sistema_solar(fecha_dt)
    logger.info(
        "Consulta a JPL Horizons completa (%s): %d cuerpos OK, %d con error (%s)",
        clave_cache, len(resultado["cuerpos"]), len(resultado["errores"]), list(resultado["errores"].keys()),
    )

    async with _cache_lock:
        _cache[clave_cache] = {"timestamp": time.time(), "datos": resultado}

    return resultado


# ============================================================
# Modo misiones
# ============================================================

def _slug(nombre: str) -> str:
    """Mismo criterio que slugCuerpo() en app.js: minúsculas, sin tildes,
    sin paréntesis, espacios y guiones largos como guiones simples. Se usa
    para ubicar static/resources/<slug>.jpg y .txt de cada misión."""
    import unicodedata
    sin_tildes = unicodedata.normalize('NFD', nombre)
    sin_tildes = ''.join(c for c in sin_tildes if unicodedata.category(c) != 'Mn')
    limpio = sin_tildes.lower().replace('(', '').replace(')', '')
    limpio = limpio.replace('—', '-').replace('–', '-')
    limpio = re.sub(r'[\s]+', '-', limpio.strip())
    # Colapsar guiones repetidos: "Voyager 2 — Gran Tour" daría
    # "voyager-2---gran-tour" sin esto (el guion largo más los espacios que
    # lo rodean se convierten en tres guiones seguidos).
    return re.sub(r'-+', '-', limpio).strip('-')


@app.get("/api/misiones")
def listar_misiones():
    """Catálogo de misiones disponibles (sin sus trayectorias — eso lo pide
    aparte /api/mision, porque es mucho más pesado). El frontend usa esto
    para armar el menú de misiones."""
    return {
        nombre: {
            "cuerpo": info["cuerpo"],
            "inicio": info["inicio"],
            "fin": info["fin"],
            "paso": info["paso"],
            "descripcion_corta": info.get("descripcion_corta", ""),
            "slug": _slug(nombre),
            "color": (_info_cuerpo(info["cuerpo"]) or {}).get("color", "#ffffff"),
        }
        for nombre, info in MISIONES.items()
    }


async def _obtener_trayectoria_cuerpo(
    cliente: httpx.AsyncClient, semaforo: asyncio.Semaphore,
    nombre: str, info: dict, inicio: datetime, fin: datetime, paso: str,
):
    """Trayectoria de UN cuerpo a lo largo de la ventana de la misión.

    Las lunas se omiten a propósito: sus coordenadas son relativas a su
    planeta y a la escala de una misión interplanetaria no aportan nada
    visible, pero sí multiplicarían las solicitudes a Horizons.
    """
    # Se prueba el id principal y, si no devuelve nada, los "id_alternativos"
    # en orden (ver CUERPOS_MISION). Cada intento toma el semáforo por
    # separado, para no retener un lugar mientras se espera entre intentos.
    candidatos = [info["id"], *info.get("id_alternativos", [])]
    probados = []
    puntos = None
    id_usado = None
    ultimo_motivo = "JPL Horizons no devolvió trayectoria legible"
    for identificador in candidatos:
        probados.append(identificador)
        async with semaforo:
            try:
                puntos = await _con_reintentos(
                    pedir_trayectoria, cliente, identificador, inicio, fin, paso, info.get("centro", "500@0"),
                    nombre=nombre, etiqueta="trayectoria",
                )
            except httpx.TransportError as exc:
                # Un fallo de RED (timeout, conexión caída) no es evidencia de
                # que el id esté mal: probar los demás ids no ayudaría, y
                # _con_reintentos ya agotó sus reintentos con este (con un
                # timeout de 60 s por intento, cada id extra podría tardar
                # varios minutos). Se corta acá y se informa el motivo real.
                ultimo_motivo = f"error de red al pedir la trayectoria: {exc}"
                logger.error("Error de red pidiendo la trayectoria de %s (id %r): %s", nombre, identificador, exc)
                puntos = None
                break
            except Exception as exc:
                # Cualquier otro error (p. ej. HTTP 400 por un id que Horizons
                # no entiende): el problema es de ESTE id, se prueba el siguiente.
                ultimo_motivo = f"excepción al pedir trayectoria: {exc}"
                logger.warning("Falló la trayectoria de %s con id %r: %s", nombre, identificador, exc)
                puntos = None
                continue
        if puntos:
            id_usado = identificador
            break
        ultimo_motivo = "JPL Horizons no devolvió trayectoria legible"
        logger.warning("Sin trayectoria legible para %s con id %r.", nombre, identificador)

    if not puntos:
        if len(probados) > 1 or len(candidatos) > 1:
            ultimo_motivo += f" (ids probados: {', '.join(map(repr, probados))})"
        logger.error("No se pudo obtener la trayectoria de %s: %s", nombre, ultimo_motivo)
        return nombre, None, {"mensaje": ultimo_motivo, "categoria": info["categoria"]}

    logger.info("OK trayectoria %s (id %r): %d puntos", nombre, id_usado, len(puntos))
    return nombre, {
        "color": info["color"],
        "radio_km": info["radio_km"],
        "radio_exagerado": info["radio_exagerado"],
        "categoria": info["categoria"],
        "trayectoria": puntos,
    }, None


async def _obtener_elementos_planeta(
    cliente: httpx.AsyncClient, semaforo: asyncio.Semaphore,
    nombre: str, info: dict, fecha: datetime,
):
    """Elementos orbitales de UN planeta en una fecha (para dibujar su aro).

    Devuelve (nombre, elementos_o_None, error_o_None). Que falle no es
    grave: el planeta se dibuja igual, solo que sin aro.
    """
    async with semaforo:
        try:
            elementos = await _con_reintentos(
                pedir_elementos_orbitales, cliente, info["id"], fecha, info.get("centro", "500@0"),
                nombre=nombre, etiqueta="elementos orbitales",
            )
        except Exception as exc:
            logger.error("Excepción pidiendo elementos orbitales de %s (id %s): %s", nombre, info["id"], exc)
            return nombre, None, {"mensaje": f"excepción al pedir elementos orbitales: {exc}", "categoria": info["categoria"]}

    if elementos is None:
        logger.warning("Sin elementos orbitales legibles para %s (id %s): se dibujará sin aro.", nombre, info["id"])
        return nombre, None, {"mensaje": "JPL Horizons no devolvió elementos orbitales legibles", "categoria": info["categoria"]}
    return nombre, elementos, None


@app.get("/api/mision")
async def obtener_mision(nombre: str):
    """Trayectorias de la sonda protagonista + del Sol y los planetas, a lo
    largo de toda la ventana de tiempo de la misión, para poder reproducirla
    como animación en el frontend. Además trae lo necesario para dibujar los
    aros de órbita de los planetas y de las lunas (ver más abajo).

    Se cachea indefinidamente: una misión histórica no cambia, y recalcularla
    implica pedirle a Horizons trayectorias largas de una decena de cuerpos.
    """
    if nombre not in MISIONES:
        raise HTTPException(status_code=404, detail=f"Misión desconocida: '{nombre}'.")

    mision = MISIONES[nombre]
    clave_cache = f"mision:{nombre}"

    async with _cache_lock:
        entrada = _cache.get(clave_cache)
        if entrada is not None:
            return entrada["datos"]

    try:
        inicio = _fecha_mision(mision["inicio"])
        fin = _fecha_mision(mision["fin"])
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"Fechas mal configuradas en la misión '{nombre}': {exc}")

    # TRAYECTORIAS (una posición por cada paso de tiempo): solo el Sol, los
    # planetas y la sonda protagonista. Las lunas no van acá: orbitan en
    # días, y con pasos de meses sus posiciones serían ruido (ver más abajo).
    cuerpos_a_pedir = {
        n: info for n, info in CUERPOS.items()
        if info["categoria"] in ("sol", "planeta")
    }
    # El protagonista puede estar en CUERPOS (p. ej. las Voyager) o en
    # CUERPOS_MISION (cuerpos que existen solo para misiones).
    protagonista = _info_cuerpo(mision["cuerpo"])
    if protagonista is None:
        raise HTTPException(
            status_code=500,
            detail=f"La misión '{nombre}' usa el cuerpo '{mision['cuerpo']}', que no existe "
                   f"en CUERPOS ni en CUERPOS_MISION (main.py).",
        )
    cuerpos_a_pedir[mision["cuerpo"]] = protagonista

    # Cuerpos "extra" con trayectoria completa (ver MISIONES): se piden SIEMPRE
    # respecto del baricentro, aunque en CUERPOS tengan otro centro — la Luna
    # está definida respecto de la Tierra ("500@399"), pero en el modo
    # misiones todo se ubica en coordenadas baricéntricas.
    extras = list(mision.get("cuerpos_extra", []))
    for nombre_extra in extras:
        info_extra = CUERPOS.get(nombre_extra)
        if info_extra is None:
            raise HTTPException(
                status_code=500,
                detail=f"La misión '{nombre}' pide el cuerpo extra '{nombre_extra}', que no existe en CUERPOS (main.py).",
            )
        cuerpos_a_pedir[nombre_extra] = {**info_extra, "centro": "500@0"}

    # AROS DE ÓRBITA (solo planetas y lunas). Un aro es una elipse calculada
    # a partir de los elementos orbitales de UN instante — Horizons no los
    # da para una ventana de años —, así que se piden en la fecha CENTRAL de
    # la misión: es la que minimiza cuánto se aparta el planeta real de la
    # elipse (que ignora las perturbaciones) a lo largo de toda la ventana.
    #   - Planetas: solo sus elementos (la posición ya viene de la trayectoria).
    #   - Lunas: una "foto" en esa fecha — posición relativa a su planeta más
    #     sus elementos. Quedan fijas en esa posición mientras el planeta se
    #     mueve, porque una luna da una vuelta en días y la animación avanza
    #     de a meses: animarla solo produciría un parpadeo sin sentido.
    fecha_ref = inicio + (fin - inicio) / 2
    planetas = {n: info for n, info in cuerpos_a_pedir.items() if info["categoria"] == "planeta"}
    lunas_a_pedir = {
        n: info for n, info in CUERPOS.items()
        if info["categoria"] == "luna" and info.get("cuerpo_padre") in planetas
        and n not in extras   # las animadas ya vienen con su trayectoria completa
    }

    semaforo = asyncio.Semaphore(MAX_CONCURRENCIA)
    async with httpx.AsyncClient() as cliente:
        resultados, resultados_elementos, resultados_lunas = await asyncio.gather(
            asyncio.gather(*[
                _obtener_trayectoria_cuerpo(cliente, semaforo, n, info, inicio, fin, mision["paso"])
                for n, info in cuerpos_a_pedir.items()
            ]),
            asyncio.gather(*[
                _obtener_elementos_planeta(cliente, semaforo, n, info, fecha_ref)
                for n, info in planetas.items()
            ]),
            asyncio.gather(*[
                _obtener_datos_cuerpo(cliente, semaforo, n, info, fecha_ref)
                for n, info in lunas_a_pedir.items()
            ]),
        )

    cuerpos = {}
    errores = {}
    for n, datos, error in resultados:
        if datos is not None:
            cuerpos[n] = datos
        if error:
            errores[n] = error

    # Sin la trayectoria del protagonista no hay misión: reproducir solo los
    # planetas sería engañoso (la sonda simplemente no aparecería, sin
    # ningún aviso). Se corta con un error claro, que el frontend muestra en
    # el banner, y se sale ANTES de cachear — así, al corregir el id en el
    # catálogo, la siguiente carga vuelve a intentarlo en vez de servir un
    # resultado fallido guardado.
    if mision["cuerpo"] not in cuerpos:
        motivo = errores.get(mision["cuerpo"], {}).get("mensaje", "sin detalle")
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo obtener de JPL Horizons la trayectoria de '{mision['cuerpo']}' "
                   f"para la misión '{nombre}': {motivo}. Revisá el id en main.py "
                   f"(CUERPOS / CUERPOS_MISION) y el log del servidor.",
        )

    # Todas las trayectorias deberían tener la misma cantidad de puntos (mismo
    # rango y paso), pero si Horizons devolviera de más/de menos para alguna,
    # se recorta al mínimo común para que el índice del slider sea válido en
    # todas y no haya desfases entre cuerpos.
    longitudes = [len(d["trayectoria"]) for d in cuerpos.values()]
    cuadros = min(longitudes) if longitudes else 0
    for datos in cuerpos.values():
        del datos["trayectoria"][cuadros:]

    # Elementos orbitales de los planetas (None si no se pudieron leer: el
    # planeta se dibuja igual, sin aro). Nunca se agregan al Sol ni a la sonda.
    for n, elementos, error in resultados_elementos:
        if n in cuerpos:
            cuerpos[n]["elementos_orbitales"] = elementos
        if error:
            errores.setdefault(n, error)

    # Lunas: solo las que tienen datos válidos Y cuyo planeta tiene
    # trayectoria (si no, no habría dónde ubicarlas).
    lunas = {}
    for n, datos, error in resultados_lunas:
        if datos is not None and datos.get("cuerpo_padre") in cuerpos:
            lunas[n] = datos
        if error:
            errores.setdefault(n, error)

    resultado = {
        "nombre": nombre,
        "cuerpo": mision["cuerpo"],
        "inicio": mision["inicio"],
        "fin": mision["fin"],
        "paso": mision["paso"],
        "slug": _slug(nombre),
        "con_hora": _mision_con_hora(mision),
        "paso_segundos": _paso_en_segundos(mision["paso"]),
        "lunas_animadas": extras,
        "encuadre": mision.get("encuadre"),
        "cuadros": cuadros,
        "cuerpos": cuerpos,
        "lunas": lunas,
        "fecha_referencia_orbitas": fecha_ref.date().isoformat(),
        "errores": errores,
    }

    logger.info(
        "Misión '%s' lista: %d cuerpos, %d lunas, %d cuadros, %d con error (%s)",
        nombre, len(cuerpos), len(lunas), cuadros, len(errores), list(errores.keys()),
    )

    async with _cache_lock:
        _cache[clave_cache] = {"timestamp": time.time(), "datos": resultado}

    return resultado


# Servir archivos del frontend (debe ir al final, después de las rutas de la API)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
