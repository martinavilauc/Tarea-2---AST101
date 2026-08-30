# Preambulo:
Recuerden hacer backups antes y despues de los cambios.  
Preguntar a Martin Avila por dudas del codigo.
# Por Hacer:  
- **(HECHO)** Acercar la camara al seleccionar un cuerpo.
- Reescribir los txt de informacion en /static/resources.
- **(HECHO)** Implementar alternar interfaz.
- **(HECHO)** Agregar Caronte.
- Intensificar sombras.
- Unificar modo "exagerado" (el modo de tamaño mas grande y orbitas mas cercanas)
- Agregar Favicon.ico (Icono de la pagina en la pestaña)
- Implementar controles con teclas (cambiar de planeta seleccionado, alternar interfaz, etc) y mostrarlos en pantalla.
- Soporte movil (Pantalla vertical y menus desplegables... falta conceptualizar)(Edge permite "simular" pantalla movil en devtools (menu F12)).
- **(HECHO)** Implementar Texturas.
- Implementar modo "misiones" (mostrar misiones en el sistema solar, por ejemplo, el viaje de la voyager hasta salir del sistema solar).
- Optimizar tiempos de carga.
- Endpoints (Mover diccionarios, importar json, crear archivo de constantes, es decir: importar en main.py y no definir.)
# BUGS:
- No funciona en librewolf.
- **(ARREGLADO)** El selector de fechas se "activa" apenas escribir la fecha (debe activarse al presionar enter).
- **(ARREGLADO)** Pluton esta fuera del aro de orbita (no es por la cantidad de segmentos del aro).
- **(ARREGLADO)** Ceres esta pegado al sol.
- **(ARREGLADO)** Al quitar o poner orbita (y en general al cambiar settings) la camara se reinicia.
- **(ARREGLADO)** Al hacer click en el wireframe del planeta ya seleccionado se reinicia la camara.
