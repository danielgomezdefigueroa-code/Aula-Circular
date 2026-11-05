# Perfiles y publicaciones pendientes

## Qué funciona

La cuenta activa con rol alumno abre `/html/mi-espacio.html`. Puede crear un ejemplar propio, guardar un borrador, editarlo y enviarlo a revisión. El propietario se obtiene de la sesión; no se admite como dato del formulario. El curso solicitado/confirmado del perfil sigue siendo de consulta: este formulario selecciona el curso del libro, no cambia el curso del usuario.

Campos del anuncio: título, descripción opcional, curso del libro, asignatura, edición, ISBN opcional, conservación y una única modalidad (cesión, préstamo o intercambio). El código del ejemplar se genera en el servidor. La fotografía no forma parte de este paso.

`/html/libros.html` lista solamente anuncios publicados sin datos de contacto ni correo. La página tiene búsqueda, filtros por curso y modalidad, filtro de disponibilidad y paginación; la API aplica esos filtros. Guardar o enviar un anuncio no lo publica. La revisión y aprobación docente de anuncios corresponde al siguiente paso; el panel docente actual solo valida cuentas.

## Rutas

| Ruta | Uso |
|---|---|
| GET /api/mi-espacio?pagina=1&limite=20 | Publicaciones exclusivamente propias |
| GET /api/mi-espacio/panel?limite=20 | Resumen propio: publicaciones, solicitudes, préstamos y avisos; sin selector de propietario |
| GET /api/anuncios/:id | Detalle e historial propios; otro alumno recibe 404 |
| POST /api/anuncios | Crear borrador con recurso y ejemplar en una transacción |
| PATCH /api/anuncios/:id | Guardar todos los campos editables y la versión leída |
| POST /api/anuncios/:id/enviar | Cuerpo `{version}`; pasa borrador/rechazado a pendiente |
| GET /api/libros?q=&curso=&modalidad=&disponible=&pagina=1&limite=20 | Listado publicado para alumno/docente activos, con búsqueda, filtros y total |

Todas las escrituras exigen sesión, estado activo, rol alumno, token CSRF y Origin válido. Los listados admiten 1-20 registros por página. Los ISBN no vacíos se validan con su dígito de control (ISBN-10/ISBN-13). Una edición antigua devuelve 409 sin escribir cambios. Ese control también cubre la ampliación de versiones del itinerario de 500 h.

## Búsqueda, filtros y fichas de Libros

`/html/libros.html` pide los datos a `GET /api/libros`; no filtra solo las tarjetas que ya están en el navegador. La respuesta mantiene la forma `{ datos, total, pagina, limite }`, donde `total` es el número de anuncios que coinciden antes de paginar. Un parámetro desconocido o una paginación inválida devuelve 422 con `PAGINACION_INVALIDA`; un filtro con valor inválido devuelve 422 con `PARAMETROS_INVALIDOS`.

| Parámetro | Uso |
|---|---|
| q | Texto de hasta 80 caracteres. Busca en título, descripción, curso, asignatura, edición, ISBN y código del ejemplar, sin distinguir mayúsculas ni acentos. |
| curso | Identificador numérico del curso del libro. |
| modalidad | `cesion`, `prestamo` o `intercambio`. |
| disponible | `1` muestra solo ejemplares sin reserva activa ni operación de préstamo en curso. `0` o vacío no aplica este filtro. |
| pagina | Página solicitada, desde 1. |
| limite | Registros por página, de 1 a 20. El valor por defecto es 20. |

Cada ficha muestra sección, procedencia, curso, tipo, modalidad, estado de publicación, código del ejemplar, asignatura, edición, ISBN, conservación y descripción. Los anuncios publicados no exponen correo, alias ni otros datos de contacto. La disponibilidad se muestra aparte del estado de revisión: un anuncio puede estar publicado y, a la vez, no disponible por una reserva o un préstamo.

Prueba manual de la página:

1. Entra con una cuenta activa de alumnado o docencia y abre `/html/libros.html`.
2. Busca por un título, una asignatura, un ISBN o un código de ejemplar. Comprueba que el contador y la paginación cambian.
3. Filtra por curso y por modalidad. Prueba «Solo disponibles» y comprueba que desaparecen los ejemplares con reserva activa o préstamo en curso.
4. Revisa una ficha completa y otra sin disponibilidad. Comprueba que no aparece ningún dato de contacto.
5. Con la ventana a 320 px, comprueba que los filtros, las tarjetas y la paginación no provocan desplazamiento horizontal.

## Reglas de estado

- Crear: borrador; editar borrador: borrador.
- Enviar: pendiente; mientras está pendiente no se edita desde este formulario.
- Corregir un rechazado: borrador; después se reenvía.
- Cambiar datos de un publicado sin operación activa: pendiente y desaparece del listado publicado. Un guardado sin cambios conserva la publicación.
- Cambiar datos cancela las propuestas de operación aún no reservadas que dependían del ejemplar y conserva un evento.
- Una reserva u operación reservada/prestada bloquea cambios. Un ejemplar retirado tampoco se modifica.
- Se conserva el motivo de la revisión anterior y el historial. El detalle muestra los 100 eventos más recientes; no se eliminan los demás de la BD.

Las tablas de operaciones y reservas son la base de integridad del siguiente módulo. Aún no existen rutas para proponer intercambios, aceptar acuerdos, reservar, entregar o devolver. Las futuras rutas deberán bloquear primero todos los ejemplares en orden ascendente y después sus operaciones, conservar eventos y comprobar aceptaciones en la transacción. Este paso no acredita esos recorridos completos.

## Preparar y probar

Ejecuta `npm.cmd run migrar` con Node 24. Aplica `004_anuncios.sql` sin repetir migraciones anteriores ni borrar datos. Reinicia el servidor si no estás usando `--watch`.

1. Entra como alumno activo y abre Mis anuncios desde Mi espacio (`/html/mi-espacio.html`).
2. Crea un libro ficticio con edición y conservación claras. Puedes dejar vacío el ISBN.
3. Guarda el borrador. Abre detalle/historial y comprueba el evento crear.
4. Edita el borrador y guarda. Comprueba el evento editar.
5. Envía a revisión: debe quedar pendiente y no aparecer en Libros publicados.
6. Para comprobar otra identidad, usa otro perfil/navegador con otro alumno validado. Su Mi espacio no debe listar el anuncio anterior. Una petición directa al ID ajeno debe recibir 404 y no cambiar datos.
7. Antes de enviar, puedes abrir el mismo borrador en dos pestañas y pulsar Editar en ambas. Guarda un cambio en la primera. Guardar desde la segunda debe dar conflicto y conservar la versión reciente. La edición del formulario no se borra tras el error; compara tus cambios antes de recargar el detalle.

Las pruebas automáticas están en `pruebas/anuncios.test.mjs`, se ejecutan con el resto de la suite mediante `npm.cmd test` y usan esquemas aleatorios aislados. Cubren búsqueda sin acentos, filtros por curso y modalidad, paginación, parámetros inválidos, datos privados y el filtro de disponibilidad con una reserva activa. Los estados publicado/rechazado y las operaciones de esos tests son fixtures SQL ficticias para verificar las reglas de esta tarea, no pruebas de un panel de moderación terminado. Las pruebas de permisos sí usan sesiones y peticiones HTTP reales.

No se ha generado una nueva evidencia PDF ni se ha declarado realizada la prueba manual del alumno. Para la entrega, conserva versión, entrada, esperado, observado y aportación de cada integrante, sin cookies ni contraseñas.
