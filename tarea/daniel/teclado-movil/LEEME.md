# Comprobar una pantalla con teclado y móvil

Ejercicio individual de Daniel · Aula Circular · 05/11/2026.

Esta carpeta contiene exclusivamente el ejercicio, su código de ensayo y su
evidencia. No modifica la aplicación, SQL, dependencias ni pruebas compartidas.

## Entrega y resultados

- [PDF de tres páginas](output/pdf/Ejercicio-teclado-y-movil.pdf).
- [Resultados y orden de foco](resultados.json).
- [Capturas](evidencias/).
- [Origen de las fuentes](origen.json).

Se comprobaron 12 escenarios con Edge headless: teclado en original/antes/después
a 320 y 390 px, formulario vacío a ambos anchos y reflujo a 768/1440 px.
La pantalla original completa el recorrido. Se introduce deliberadamente una
barrera didáctica en una copia, como permite el encargo: quitar el indicador de
foco. La corrección retira esa regla y restaura el contorno original.
No se atribuye el fallo preparado al trabajo de los compañeros.

El recorrido usa Tab, Mayús+Tab, Enter y Escape: menú, retorno al botón, búsqueda,
solicitud y aviso final. La solicitud real queda pendiente y no crea reserva.
El formulario vacío muestra errores asociados; su resumen lleva al campo.

## Repetir desde la raíz del repositorio

Requiere Python 3, Node 24, PostgreSQL, Edge, Playwright y las dependencias del
proyecto instaladas. Usa el .env local privado; no debe copiarse a esta carpeta.

```powershell
python tarea/daniel/teclado-movil/preparar.py
$env:PLAYWRIGHT_MODULO='ruta absoluta al módulo playwright instalado'
node --env-file=.env tarea/daniel/teclado-movil/prueba.mjs
```

preparar.py lee el commit fe1d34f del historial y genera .runtime/, antes/ y
despues/ en esta carpeta. Se excluyen de Git para no duplicar el código del equipo.
Si el historial es superficial y falta ese commit, ampliar el historial de la
rama interfaz-y-accesibilidad antes de preparar la copia.

La prueba crea un esquema PostgreSQL aleatorio de ensayo y lo elimina al terminar.
No vacía tablas del centro. Con --servir se mantiene un servidor para repetir
manualmente; imprime las URLs y se cierra con Ctrl+C. Las cuentas y la frase del
script son datos ficticios del esquema temporal.

Para regenerar el PDF, ejecutar crear_pdf.py con reportlab, Pillow, pypdf y
pdftoppm disponibles. Los PNG intermedios y el ZIP no se versionan.

## Explicación propuesta y revisión

El foco indica qué control recibirá Enter. Eliminar su contorno no quita el
control del recorrido, pero impide ver la posición del teclado. Retirar la regla
didáctica restaura el indicador sin cambiar el orden ni las reglas del servidor.

Codex preparó las copias, ejecutó las pruebas y redactó la evidencia. Daniel
aportó el encargo y los recursos. La repetición y explicación personal de Daniel
y la revisión del tutor siguen pendientes. Es emulación de ancho en navegador:
no se ha probado con móvil físico ni lector de pantalla y no acredita conformidad
WCAG completa. No se ha subido a FCTconecta.
