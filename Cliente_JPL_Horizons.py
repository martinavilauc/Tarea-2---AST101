from datetime import datetime, timezone, timedelta
from typing import Optional
import re

import httpx

HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"


async def pedir_cordenadas(
    cliente: httpx.AsyncClient,
    cuerpo_celeste: str,
    fecha: Optional[datetime] = None,
    centro: str = "500@0",
):
    """cuerpo_celeste acepta el id del cuerpo celeste, revisar índice en JPL Horizons.
    CENTER='500@0' = baricentro del sistema solar (Solar System Barycenter),
    por eso incluso el Sol (id '10') tiene una posición != (0,0,0): se bambolea
    levemente alrededor del baricentro por la atracción de los planetas (sobre
    todo Júpiter).

    cliente: httpx.AsyncClient ya abierto, reutilizado entre llamadas (lo crea
    main.py una sola vez por consulta y lo comparte entre los ~50 pedidos que
    hacen falta para todo el catálogo). Mantiene la conexión TCP/TLS hacia
    JPL Horizons abierta entre solicitudes en vez de renegociarla cada vez,
    que es buena parte de por qué esto es más rápido que abrir una conexión
    nueva por pedido (lo que hacía la versión con requests.get() suelto).

    fecha: instante UTC (datetime con tzinfo) para el que se piden las
    coordenadas. Si es None (comportamiento por defecto, igual que antes),
    se usa el instante actual.

    centro: código de centro de JPL Horizons (sin las comillas simples que
    Horizons espera; esta función las agrega). Por defecto el baricentro del
    sistema solar ('500@0'), igual que antes. Para lunas se usa
    '500@<id_del_planeta>' (p. ej. '500@399' para geocéntrico), así sus
    coordenadas quedan relativas a su planeta y no al baricentro — de otro
    modo la órbita de una luna no se distinguiría de la de su planeta.
    """
    momento = fecha or datetime.now(timezone.utc)
    inicio_jpl = momento.strftime('%Y-%m-%d %H:%M')
    fin_jpl = (momento + timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M')

    # Se usa params= en vez de concatenar texto a mano: así httpx codifica
    # correctamente espacios y símbolos en la URL (el bug original rompía
    # sobre todo con los espacios de START_TIME/STOP_TIME).
    parametros = {
        "format": "json",
        "COMMAND": f"'{cuerpo_celeste}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'VECTORS'",
        "CENTER": f"'{centro}'",
        "START_TIME": f"'{inicio_jpl}'",
        "STOP_TIME": f"'{fin_jpl}'",
        "STEP_SIZE": "'15m'",
    }

    respuesta = await cliente.get(HORIZONS_URL, params=parametros, timeout=15)
    respuesta.raise_for_status()
    texto = respuesta.json().get('result', '')

    match_x = re.search(r'X\s*=\s*([-\d.eE+]+)', texto)
    match_y = re.search(r'Y\s*=\s*([-\d.eE+]+)', texto)
    match_z = re.search(r'Z\s*=\s*([-\d.eE+]+)', texto)

    if match_x and match_y and match_z:
        return {
            'x': float(match_x.group(1)),
            'y': float(match_y.group(1)),
            'z': float(match_z.group(1))
        }
    return None


async def pedir_elementos_orbitales(
    cliente: httpx.AsyncClient,
    cuerpo_celeste: str,
    fecha: Optional[datetime] = None,
    centro: str = "500@0",
):
    """cuerpo_celeste acepta el id del cuerpo celeste, revisar índice en JPL Horizons.
    Nota: los elementos orbitales relativos al centro consultado no tienen
    mucho sentido para el propio origen de ese centro (p. ej. el Sol
    respecto al baricentro), así que esta función no se llama para esos
    casos (ver main.py).

    cliente: mismo parámetro que en pedir_cordenadas (ver esa función).
    fecha: mismo parámetro que en pedir_cordenadas — instante UTC para el que
    se piden los elementos. Si es None, se usa el instante actual.
    centro: mismo parámetro que en pedir_cordenadas (ver esa función).
    """
    momento = fecha or datetime.now(timezone.utc)
    inicio_jpl = momento.strftime('%Y-%m-%d %H:%M')
    fin_jpl = (momento + timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M')

    parametros = {
        "format": "json",
        "COMMAND": f"'{cuerpo_celeste}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'ELEMENTS'",
        "CENTER": f"'{centro}'",
        "START_TIME": f"'{inicio_jpl}'",
        "STOP_TIME": f"'{fin_jpl}'",
        "STEP_SIZE": "'15m'",
    }

    respuesta = await cliente.get(HORIZONS_URL, params=parametros, timeout=15)
    respuesta.raise_for_status()
    texto = respuesta.json().get('result', '')

    match_ec = re.search(r'EC\s*=\s*([-\d.eE+]+)', texto)
    match_qr = re.search(r'QR\s*=\s*([-\d.eE+]+)', texto)
    match_in = re.search(r'IN\s*=\s*([-\d.eE+]+)', texto)
    match_om = re.search(r'OM\s*=\s*([-\d.eE+]+)', texto)
    match_w = re.search(r'W\s*=\s*([-\d.eE+]+)', texto)

    if not all([match_ec, match_qr, match_in, match_om, match_w]):
        return None

    ec = float(match_ec.group(1))   # Excentricidad
    qr = float(match_qr.group(1))   # Perihelio (km)
    inc = float(match_in.group(1))  # Inclinación (deg)
    om = float(match_om.group(1))   # Nodo ascendente (deg)
    w = float(match_w.group(1))     # Arg. del perihelio (deg)

    return {
        'excentricidad': ec,
        'perihelio_km': qr,
        'inclinacion_deg': inc,
        'nodo_ascendente_deg': om,
        'arg_perihelio_deg': w,
        'semieje_mayor_km': qr / (1.0 - ec)  # Cálculo del semieje mayor (a)
    }


async def pedir_trayectoria(
    cliente: httpx.AsyncClient,
    cuerpo_celeste: str,
    fecha_inicio: datetime,
    fecha_fin: datetime,
    paso: str = "30d",
    centro: str = "500@0",
):
    """Pide la trayectoria COMPLETA de un cuerpo entre dos fechas, en vez de
    su posición en un único instante (lo que hace pedir_cordenadas).

    Se usa para el "modo misiones": con una sola solicitud a JPL Horizons se
    obtienen todos los puntos de la trayectoria de una sonda (o de cualquier
    cuerpo) a lo largo de años, en vez de hacer una solicitud por cada paso
    de tiempo — que para una misión como la Voyager 1 (decenas de años)
    serían cientos de solicitudes.

    paso: STEP_SIZE de Horizons, en su sintaxis ("30d" = cada 30 días,
    "1y" = cada año, "6h" = cada 6 horas, etc.). Ojo con el tamaño del
    resultado: un paso chico sobre un rango largo devuelve muchísimos
    puntos y una respuesta enorme.

    Devuelve una lista de dicts {x, y, z} en el MISMO orden temporal que
    entrega Horizons (del inicio al final). Si no se pudo leer ninguna
    posición, levanta ValueError con el texto que respondió Horizons.
    A diferencia de pedir_cordenadas, acá se usa re.findall (no re.search):
    hay que capturar TODOS los pasos de tiempo, no solo el primero.
    """
    parametros = {
        "format": "json",
        "COMMAND": f"'{cuerpo_celeste}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'VECTORS'",
        "CENTER": f"'{centro}'",
        "START_TIME": f"'{fecha_inicio.strftime('%Y-%m-%d %H:%M')}'",
        "STOP_TIME": f"'{fecha_fin.strftime('%Y-%m-%d %H:%M')}'",
        "STEP_SIZE": f"'{paso}'",
    }

    # timeout más alto que en las otras funciones: una trayectoria larga
    # obliga a Horizons a calcular (y devolver) muchos más datos.
    respuesta = await cliente.get(HORIZONS_URL, params=parametros, timeout=60)
    respuesta.raise_for_status()
    texto = respuesta.json().get('result', '')

    # Cada paso de tiempo que devuelve Horizons trae TRES líneas:
    #     X = ...  Y = ...  Z = ...      <- posición (km)
    #     VX= ...  VY= ...  VZ= ...      <- velocidad (km/s)
    #     LT= ...  RG= ...  RR= ...
    # Un regex "X\s*=" a secas coincide también dentro de "VX=", así que
    # findall devolvía posiciones y velocidades INTERCALADAS: la trayectoria
    # quedaba con el doble de puntos y la mitad eran velocidades (~30 km/s,
    # o sea, el origen a escala de escena) — los cuerpos saltaban a (0,0,0)
    # en cada paso intermedio. Dos defensas:
    #   1) leer solo el bloque de datos, entre $$SOE y $$EOE;
    #   2) (?<![A-Za-z]) impide que "X" coincida cuando va pegada a otra
    #      letra (VX, VY, VZ).
    inicio_datos = texto.find('$$SOE')
    fin_datos = texto.find('$$EOE')
    if inicio_datos != -1 and fin_datos > inicio_datos:
        bloque = texto[inicio_datos + len('$$SOE'):fin_datos]
    else:
        bloque = texto

    def valores(eje):
        return re.findall(r'(?<![A-Za-z])' + eje + r'\s*=\s*([-\d.eE+]+)', bloque)

    xs, ys, zs = valores('X'), valores('Y'), valores('Z')

    if not xs or not (len(xs) == len(ys) == len(zs)):
        # Horizons no entregó posiciones: se levanta un error con LO QUE
        # RESPONDIÓ, en vez de devolver None sin más. Cuando una fecha cae
        # fuera de lo que cubre el cuerpo, o el id no existe, ese texto lo
        # dice (p. ej. 'No ephemeris for target ... prior to A.D. ...') y
        # ahorra adivinar qué falló.
        lineas = [l.strip() for l in texto.splitlines() if l.strip() and set(l.strip()) != {"*"}]
        resumen = " ".join(lineas)[:300] or "(respuesta vacía)"
        raise ValueError(f"Horizons no devolvió posiciones. Respuesta: {resumen}")

    return [
        {'x': float(x), 'y': float(y), 'z': float(z)}
        for x, y, z in zip(xs, ys, zs)
    ]
