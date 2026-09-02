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
