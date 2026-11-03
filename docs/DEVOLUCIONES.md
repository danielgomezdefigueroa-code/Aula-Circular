# Devoluciones cancelaciones e incidencias

Plan 370 horas. Continuación de sprint1-servidor-y-datos desde el trabajo de Fede
157da5c. Desarrollo local de Daniel en codex/devoluciones-incidencias. Main no se
ha modificado; se consultó para prever incompatibilidades.

## Qué está hecho

- src/prestamos/devoluciones.mjs: función y ruta POST /api/gestion/operaciones/:id/devolver.
- src/aplicacion.mjs: importa y monta el router, conservando los demás servicios.
- sql/migraciones/009_incidencias.sql: tabla común de incidencias, sin modificar migraciones previas.
- pruebas/devoluciones.test.mjs: pruebas HTTP/PostgreSQL, permisos, rechazo, repetición y rollback.
- scripts/probar-devolucion.mjs: ensayo conservado con pausa para consultar antes/después en pgAdmin.

La devolución recibe exactamente apto (booleano) y conservacion (texto 1-500).
Solo docente activo con sesión y CSRF. Relee permiso, préstamo prestado, entrega,
vencimiento, un ítem y reserva coherente, ejemplar habilitado y ninguna incidencia
abierta. Completa, actualiza conservación, elimina reserva, guarda evento devolver
y aviso a participantes históricos. No cambia propietario ni fecha de entrega.
Repetir devuelve 409 sin duplicados. No apto o retirado requiere incidencia; una
incidencia abierta bloquea la devolución. Vencimiento pasado no libera por sí solo.

## Continuación de Fede

Implementar incidencias, resolución como baja y revisar cancelaciones. Reutilizar
incidencia de la migración 009: operacion_id, ejemplar_id, autor_id, tipo dano/perdida,
descripcion, estado abierta/resuelta, resolucion, resuelta_por, creada_en, resuelta_en.
Una sola incidencia abierta por ítem. Al abrir, resolución/autor/fecha de resolución
son nulos; al resolver son obligatorios. No editar la migración si ya fue aplicada.

Bloquear primero usuario/rol, después ejemplares ordenados, anuncios ordenados,
operación, ítems y reservas, y después incidencias. Un único cliente pg desde BEGIN
hasta COMMIT/ROLLBACK. Abrir incidencia debe bloquear ejemplar y operación antes
de escribir para no competir con devolución. No libera reserva. La baja documentada
retira ejemplar, cierra por incidencia, resuelve y libera conjuntamente, sin devolución
ficticia. Revisar anuncio asociado. Conservar el historial y los servicios de intercambios.

Probar: incidencia mantiene ocupación; baja autorizada; alumno sin permiso;
devolución de cesión rechazada; cancelación de intercambio completado rechazada;
repetición sin duplicados; vencimiento no libera; fallos sin cierres parciales.
No implementar la ampliación de 500 horas.

## Qué se comprobó

03/11/2026: 21 tests, cero fallos, ejecutando devoluciones más anuncios y cesiones.
Los 21 incluyen las regresiones. Esquemas temporales propios eliminados al terminar.
El fallo se provoca mediante trigger SQL únicamente de ensayo al insertar el aviso
antes del COMMIT: HTTP 500 y datos intactos; eliminado el trigger, el reintento confirma.
La línea P0001 de ese test es intencionada; la API no tiene un modo de provocar fallos.

Ensayo conservado de Daniel: base aula_circular_devoluciones_ensayo, operación 2,
ejemplar DEV-864ba87d. Antes prestada/1 reserva/0 devoluciones; después completada/
0 reservas/1 devolución. HTTP 200, repetición 409. Consultado también en pgAdmin.
Los IDs son locales. El script conserva datos y crea dos cuentas, un ejemplar y una
operación nuevos por ejecución; no borra ensayos anteriores ni muestra credenciales.

Desde la raíz, con un .env privado propio, host local y la base de ensayo:

```powershell
node --env-file=.env scripts/migrar.mjs
node --env-file=.env --test --test-concurrency=1 pruebas/devoluciones.test.mjs pruebas/anuncios.test.mjs pruebas/cesiones.test.mjs
node --env-file=.env scripts/probar-devolucion.mjs
```

PGDATABASE definido en la terminal prevalece sobre .env. El último script exige
aula_circular_devoluciones_ensayo y aula_app. No compartir .env ni sesiones/tokens.

## Compatibilidad y límites pendientes

La preparación SQL simula préstamos ya entregados; la devolución sí es HTTP real.
No acredita solicitud/asignación/entrega completas. El circuito antiguo de Sprint 3
usa otra estructura: estados de ejemplar, solicitud asignada/adjudicada y avisos.
No ejecutar su sql/009_prestamos.sql sobre esta base. Coordinar la adaptación
pendiente entre ambos, sin atribuirla automáticamente a Fede ni darla por terminada.

Main consultado (4c9ea80) usa src/app.mjs y tests/, y ya tiene
008_documentos_protegidos.sql. Por eso la nueva migración se llama 009 aunque
esta rama salte de 007 a 009. Al integrar, conservar documentos y adaptar el montaje;
no restaurar indiscriminadamente src/aplicacion.mjs ni migraciones antiguas.
La alternativa local codex/devoluciones-base-main es solo respaldo; NO usarla como
base acordada ni fusionarla a ciegas. Main consultado no incluía todavía los servicios
de cierre/reserva de intercambios de 157da5c, que sí conserva esta rama compartida.

## Documento conjunto

Continuar el Google Docs de Daniel. Máximo 5 páginas/10 MB. Su borrador ocupa 3
páginas y tiene una cuarta vacía: eliminar salto final y recortar capturas para dejar
espacio legible a Fede. Quitar figura inicial repetida si hace falta; recortar PowerShell
desde DEVOLUCION hasta RESULTADO y pgAdmin a identificación/encabezados/filas.

Continuar: 4. Incidencia y baja (entrada, esperado, observado y evidencia antes/después);
5. Cancelaciones, permisos y recuperación (tabla breve de casos reales);
6. Versión, aportaciones de ambos y revisión conjunta real. Anotar commit final ejecutado.
Cambiar a pasado solo lo terminado y no inventar observados ni revisión. Mantener
la aclaración sobre la semilla SQL y el circuito antiguo pendiente. Trabajar en local,
redactar mientras se prueban los casos, y coordinar antes de publicar o fusionar main.
