# Cesiones y moderación (22/10/2026)

Versión: ampliación sobre 004_anuncios; migración 006_cesiones. Código en src/cesiones.mjs y pantallas /html/libros.html y /html/cesiones.html.

## Uso

1. `npm run migrar` y `npm start` desde Aula-Circular.
2. El propietario crea y envía un anuncio de modalidad cesión en Mi espacio.
3. El docente abre /html/cesiones.html, revisa curso, edición y conservación; aprueba o rechaza con motivo. La fotografía es opcional y esta versión no incorpora subida de fotos.
4. Otro alumno solicita el ejemplar desde Libros. La solicitud no reserva.
5. El docente selecciona solicitud y escribe un motivo breve para asignar.
6. Confirma entrega definitiva o cancela la reserva antes de entregar.

Las operaciones y solicitudes propias se consultan en Cesiones. El docente ve las del conjunto. Los listados admiten pagina y limite (máximo 20). La entrega conserva origen y destino, retira ejemplar y anuncio, elimina reserva y registra evento y avisos. Repetir entrega devuelve la operación sin duplicar hechos.

## Integridad y ampliación 500

Las escrituras usan un único cliente PostgreSQL y transacción. Bloquean primero ejemplar, después anuncio y operación/solicitud, y revalidan identidad, rol, participantes y disponibilidad. PK de reserva e índice parcial de solicitud impiden duplicados. Las cuentas se bloquean en orden de ID. Los conflictos de reserva/bloqueo devuelven 409.

Cancelar conserva operación e historial; solicitudes adjudicadas/rechazadas mantienen su estado. Nuevas solicitudes se registran aparte y la nueva asignación revalida disponibilidad. No hay asignación automática.

## Verificación

`npm test`: 21 comprobaciones, todas correctas en PostgreSQL local y HTTP real. Incluyen moderación, rechazo y corrección; propiedad y CSRF del módulo de anuncios; solicitud propia y duplicada; concurrencia de asignación; entrega repetida; cancelación; reasignación e historial. Los tests crean esquemas aislados aula_test_* con cuentas sintéticas y los limpian al terminar. No son respuestas simuladas.

## Límites de la evidencia

La suite verifica API y persistencia. La interfaz no se ha ensayado visualmente en navegador. No se ha subido el PDF a FCTconecta ni existe revisión del Team Leader. No se atribuyen horas ni contribuciones a dos estudiantes sin confirmación: la implementación, las pruebas y el informe se han realizado con asistencia de Codex. Cada integrante debe declarar su aportación real y recibir la revisión docente.

Integración Git: basada en interfaz-y-accesibilidad (dbce7ef); conserva public/html, public/mjs y los catálogos existentes. La migración se numera 006 para continuar después de 005_documentos. La rama codex/sprint3-prestamos utiliza otra base de servidor y aún requiere integración independiente.

Tras integrar las carpetas actuales se ejecutaron además tests/auth.test.mjs: 38 comprobaciones correctas en total. El migrador reconoce la antigua 005_cesiones local y actualiza su nombre solo si coincide el hash.
