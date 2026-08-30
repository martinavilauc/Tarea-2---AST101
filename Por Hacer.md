# Preambulo:
Recuerden hacer backups antes y despues de los cambios.  
Preguntar a Martin Avila por dudas del codigo.
# Por Hacer:  
- (HECHO)Acercar la camara al seleccionar un cuerpo.
- Reescribir los txt de informacion en /static/resources.
- (HECHO)Implementar alternar interfaz.
- Agregar Caronte.
- Agregar Favicon.ico (Icono de la pagina en la pestaña)
- Implementar controles (cambiar de planeta seleccionado, alternar interfaz, etc) y mostrarlos en pantalla.
- Soporte movil (Pantalla vertical y menus desplegables... falta conceptualizar)(Edge permite "simular" pantalla movil en devtools (menu F12)).
- (HECHO)Implementar Texturas (NASA dispone de material 3d entre otras cosas que pueden ser utiles).
- Endpoints (Mover diccionarios, importar json, crear archivo de constantes, es decir: importar en main.py y no definir.)

# BUGS:
- No funciona en librewolf.
- (ARREGLADO)El selector de fechas se "activa" apenas escribir la fecha (debe activarse al presionar enter).
- (ARREGLADO)Pluton esta fuera del aro de orbita (no es por la cantidad de segmentos del aro).
- Ceres esta pegado al sol.
- Al quitar o poner orbita (y en general al cambiar settings) la camara se reinicia.
