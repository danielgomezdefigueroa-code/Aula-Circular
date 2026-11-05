# Alcance de la rama del ejercicio

Rama: `ejercicio/conectar-entregas-solicitudes`.
Base: `datos/panel-docente-administracion`, commit `7661dd9`.

Esta rama contiene únicamente la solución del ejercicio de conectar entregas y
solicitudes en el panel docente, sus pruebas, documentación y PDF de evidencia.
Los cambios se comparan contra esa base; no es una integración de todas las ramas.

Se revisaron en GitHub los avances posteriores de main, servidor/datos,
interfaz y biblioteca. Hay servicios de intercambios, préstamos e incidencias
más recientes que se solapan con esta solución de ensayo. Por ello, esta rama
queda separada para revisión y no se debe fusionar directamente con main sin
adaptarla previamente a esos servicios. Publicarla no modifica main ni las ramas
de los demás integrantes.

Validación de esta versión: 36 pruebas aprobadas en su base de ensayo. Las 83
pruebas de la integración amplia corresponden a otra versión local y no se
atribuyen a esta rama.

Feedback: la cola, los permisos reales, las reservas únicas y las pruebas de
concurrencia cubren el núcleo del ejercicio. La mejora principal antes de integrar
es reutilizar los servicios actuales del equipo para evitar reglas paralelas.
También conviene sustituir el ID de curso por un selector con nombres y separar
la consulta de la cola en su propio módulo.

Evidencia: `output/pdf/Ejercicio-conectar-entregas-solicitudes.pdf`.
Detalles y reproducción: `docs/CIRCULACION-DOCENTE.md`.
