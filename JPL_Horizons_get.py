from requests import get
from datetime import datetime, timezone, timedelta
import re

def pedir_cordenadas(cuerpo_celeste): #cuerpo_celeste acepta el id del cuerpo celeste, revisar indice en jpl horizons.
    ahora_utc = datetime.now(timezone.utc) #Hora actual en utc.

    inicio_jpl = ahora_utc.strftime('%Y-%m-%d %H:%M') #Formato para jpl.
    fin_jpl = (ahora_utc + timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M') #añade 1 minuto.
    #formato general para crear el formato de la petición a jpl horizons, se reformara para otros tipos de requests.
    parametros = ("format=json&" +
              f"COMMAND=\'{str(cuerpo_celeste)}\'&" +
              "OBJ_DATA=\'NO\'&"
              f"MAKE_EPHEM=\'YES\'&" +
              "EPHEM_TYPE=\'VECTORS\'&" +
              "CENTER=\'500@0\'&" +
              f"START_TIME=\'{inicio_jpl}\'&" +
              f"STOP_TIME=\'{fin_jpl}\'&" +
              f"STEP_SIZE=\'15m\'"
    )

    url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + parametros

    respuesta = get(url)
    datos_json = respuesta.json()
    texto = datos_json.get('result', '')

    match_x = re.search(r'X\s*=\s*([^\s]+)', texto)
    match_y = re.search(r'Y\s*=\s*([^\s]+)', texto)
    match_z = re.search(r'Z\s*=\s*([^\s]+)', texto)

    if match_x and match_y and match_z:
        return {
            'x': float(match_x.group(1)),
            'y': float(match_y.group(1)),
            'z': float(match_z.group(1))
        }
    return None
    
print(pedir_cordenadas(499))
