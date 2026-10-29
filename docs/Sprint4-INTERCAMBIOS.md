# Sprint 4: intercambio y aceptaciones (plan 370)

## Base y compatibilidad
Rama de trabajo: codex/sprint4-intercambios, desde datos/cesiones-moderacion 89bdc8d.
Se reutilizan usuario, usuario_rol, recurso, ejemplar, anuncio, operacion,
operacion_item, reserva_activa, evento_operacion y aviso. No se reescriben migraciones 002-006.
No se ha fusionado ni modificado main ni ninguna rama de los companeros.
Las incompatibilidades anteriores con codex/sprint3-prestamos siguen pendientes
para una integracion general: este trabajo no las resuelve automaticamente.

## Migracion nueva 007_intercambios.sql
Solo anade intercambio y aceptacion_intercambio. No altera tablas existentes.
intercambio amplia una operacion comun con sus participantes, pareja exacta y
versiones de anuncios. No es una segunda tabla de operaciones ni de reservas.
Las dos filas de operacion_item se crean antes de intercambio por sus claves foraneas.
La aceptacion del proponente se guarda en la misma transaccion que la propuesta.
Estado inicial: operacion.tipo=intercambio y estado=propuesta; docente/vencimiento nulos.
No se crea reserva hasta la confirmacion posterior del docente.
Aplicado y comprobado el 26/10/2026 como aula_app en aula_circular_sprint4_ensayo con el ejecutor scripts/migrar.mjs. Se registraron las migraciones 002-007.

## Contrato implementado por Daniel
POST /api/intercambios: sesion y alumno activo, CSRF global ya existente.
Cuerpo: ejemplarOfrecidoId, ejemplarSolicitadoId y confirmoPropuesta:true.
La identidad del proponente se toma de la sesion; el receptor es el propietario
actual del otro ejemplar. Ambos deben estar activos y ser alumnos distintos.
Solo recursos fisicos propios con anuncios publicados para intercambio,
ejemplares habilitados y sin reserva/operacion reservada o prestada.
El servidor guarda las versiones actuales de ambos anuncios y dos items cruzados:
A entrega su ejemplar a B y B entrega el suyo a A, sin modificar propietarios.
Respuesta 201: id de operacion, estado propuesta, pareja, versiones y una aceptacion.

GET /api/intercambios/:id: mostrar el acuerdo solo a sus participantes activos.
No revela datos ni claves de otras cuentas. Permite conocer la pareja/versiones para aceptar.

POST /api/intercambios/:id/aceptar: solo el receptor autenticado.
Cuerpo: ejemplarOfrecidoId, ejemplarSolicitadoId, versionOfrecida,
versionSolicitada y confirmoAceptacion:true. Comparar con el acuerdo guardado y
revalidar en servidor propiedad, estado, modalidad, disponibilidad y versiones actuales.
Repetir exactamente una aceptacion valida no duplica filas.
No aceptar IDs de usuario ni estados desde el cliente. Un tercero recibe rechazo.
Una aceptacion no crea reserva, aunque ya existan ambas.

## Invalidacion que ya existe
src/anuncios.mjs ya cancela operaciones en estado propuesta al editar materialmente
un anuncio y deja un evento. Nuestra operacion usa ese mismo estado para aprovecharlo.
No es necesario modificar ese modulo para inventar otra cancelacion paralela.
El nuevo servicio tambien compara versiones al aceptar; Fede debe revalidarlas al reservar.
Las aceptaciones historicas se conservan, pero una operacion cancelada no se puede reservar.
No habra ruta para cambiar la pareja: se crea otra propuesta con nuevas aceptaciones.

## Orden de bloqueos que debe respetar Fede
Antes de bloquear el acuerdo, leer sus referencias sin confiar en datos del cliente.
Revalidar las cuentas implicadas con la convencion comun. Bloquear ambos ejemplares
en orden ascendente de ID; despues sus anuncios en ese mismo orden; despues operacion.
Releer dentro de la transaccion todo lo que condiciona la escritura, incluidas versiones
y dos aceptaciones de los participantes exactos. Esto mantiene la convencion de anuncios,
que bloquea ejemplar y anuncio antes de cancelar una propuesta.
No bloquear primero operacion y despues ejemplares: puede competir con la edicion.
Un solo cliente pg desde BEGIN hasta COMMIT/ROLLBACK. No confirmar nada a medias.

## Parte pendiente de Fede
POST /api/gestion/intercambios/:id/reservar: docente activo, dos aceptaciones;
crear dos reservas o ninguna y guardar evento/avisos conjuntamente.
Entrega y cancelacion docente: coordinar las rutas comunes con src/cesiones.mjs,
que ya atiende /gestion/operaciones/:id/entregar y /cancelar SOLO para cesiones.
No montar otro manejador identico detras: el primero responderia antes.
Acordar un despachador por operacion.tipo o rutas especificas documentadas.
Preservar y repetir pruebas de cesiones antes/despues de la adaptacion.
Entrega conjunta: completar operacion, retirar ambos ejemplares/anuncios del circuito,
conservar propietarios de origen y destinatarios historicos. No duplicar eventos/avisos.
Cancelacion antes de entrega: liberar las dos reservas juntas; completado no se revierte.

## Comprobaciones y documento
Implementadas y comprobadas las rutas de propuesta, consulta y aceptacion; la reserva y cierre siguen pendientes de Fede.
Daniel comprobo propuesta, suplantacion/propiedad/modalidad, tercero que acepta,
pareja o version manipulada, aceptacion correcta/repetida e invalidacion por edicion.
Fede probara una sola aceptacion sin reserva, ejemplar ocupado sin media reserva,
permisos, entrega repetida y cancelacion conjunta. Revisar tambien cuenta suspendida.
Plan 370: no anadir la ampliacion especifica de dos intercambios concurrentes de 500.
La evidencia debe tener peticiones HTTP reales y estado SQL final; UI no basta.
Docs conjunto: cinco paginas / 10 MB, version, entradas, esperado/observado,
aportacion de ambos, ayuda de IA y revision real. Reservar unas dos paginas para Daniel.

## Archivos implementados y pruebas reales del 26/10/2026
- src/intercambios/acuerdos.mjs: transacciones, bloqueos, propiedad, modalidad,
  versiones, propuesta y aceptacion. No crea reservas.
- src/intercambios/rutas.mjs: valida cuerpos exactos y usa sesion/alumno activo.
- src/app.mjs: solo se anadieron el import y el montaje del router.
- scripts/probar-intercambios.mjs: prueba HTTP real en un servidor temporal
  usando cinco cuentas y cuatro anuncios ficticios nuevos por ejecucion.
  Las claves, cookies y tokens se mantienen solo en memoria.
  Conserva los datos de ensayo y no borra los de ejecuciones anteriores.

Ejecucion desde la raiz, con .env local apuntando a la base Sprint 4 y aula_app:
```powershell
node --env-file=.env scripts/probar-intercambios.mjs
```
El script exige PGDATABASE=aula_circular_sprint4_ensayo, host local y desarrollo.
Si la terminal ya tiene PGDATABASE definido, prevalece sobre .env: revisar antes.
--captura reduce la salida a los casos principales pero ejecuta todos los casos.
Resultado: 21 casos HTTP superados con estados SQL comprobados.
Propuesta: dos items cruzados, una aceptacion, cero reservas.
Ambas aceptaciones: dos aceptaciones, dos eventos, dos avisos, cero reservas.
Repeticion: no duplica aceptaciones/eventos/avisos.
Tercero y proponente no pueden aceptar por el receptor; pareja o version falsa se rechaza.
La edicion real del anuncio cancela el acuerdo sin reserva; se conservan las dos
aceptaciones historicas y una nueva propuesta empieza otra vez con una aceptacion.
Los propietarios originales no se modifican.

Compatibilidad comprobada: las pruebas existentes tests/anuncios.test.mjs y
tests/cesiones.test.mjs pasaron: 14 tests, cero fallos, con HTTP/PostgreSQL reales.
Se ejecutaron con la base del Sprint 4 y esquemas temporales del propio test.
Esto no acredita la integracion con el esquema distinto de prestamos ni la parte futura de Fede.
Publicacion del Sprint 4 destinada a sprint1-servidor-y-datos, la rama compartida de Daniel y Fede. La rama local de preparacion es codex/sprint4-intercambios. La revision conjunta y la parte de Fede siguen pendientes.
