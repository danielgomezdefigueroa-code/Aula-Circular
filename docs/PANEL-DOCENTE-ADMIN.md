# Panel docente y administración - v1

La migración 007 añade categorías y auditoría administrativa. Ejecuta `npm run migrar` y `npm start`. La página `/html/docencia.html` reúne cuentas pendientes, anuncios en revisión y acceso a Biblioteca, Documentación y solicitudes/operaciones. Las acciones de reserva y entrega usan las rutas anteriores de cesiones, sin duplicar sus reglas.

`/html/administracion.html` permite listar cuentas (sin correo ni hash), conceder o retirar roles explícitos, suspender/restablecer cuentas previamente validadas y gestionar cursos/categorías. No activa pertenencias pendientes ni cambia su curso confirmado. Las bajas son lógicas, sin borrar relaciones. El registro incluye actor, fecha, estado anterior y posterior. Las categorías se configuran como catálogo administrativo; esta tarea no añade clasificación a las fichas existentes.

## Permisos y sesiones

Admin no implica docente. El servidor consulta roles en cada petición; una retirada docente produce 403 en la siguiente petición de la misma sesión y conserva los demás permisos de esa cuenta. Los cambios de estado incrementan auth_version, invalidando las sesiones existentes. Restaurar la cuenta exige nuevo acceso. Un cambio de rol no incrementa auth_version: es una decisión explícita para conservar la sesión activa del caso de retirada docente de esta tarea; se releen los roles y las transacciones vuelven a comprobar al actor.

Todas las escrituras administrativas toman el bloqueo transaccional fijo 71001 antes de revalidar actor, contar administradores activos y modificar. Tanto suspensión como retirada de rol rechazan eliminar al último administrador activo con 409. Las mutaciones conservan CSRF y SQL parametrizado.

## Verificación reproducible

`npm test` ejecuta PostgreSQL y HTTP reales en esquemas temporales aleatorios, que elimina al finalizar. Incluye matriz de cuatro roles, validación, cursos y categorías, CSRF, retirada docente, suspensión con sesión abierta, conservación de operación/reserva y dos retiradas simultáneas sobre los últimos administradores. El resultado mínimo es una respuesta 200 y otra 409, con un administrador activo. No son respuestas simuladas.

`node --env-file=.env scripts/ensayo-panel.mjs` abre un centro ficticio aislado en el puerto 3001. Sus cuentas son alumno/docente/admin/ambos/pendiente@example.invalid y la frase de ensayo está en ese script. Son exclusivamente datos de demostración; no se usan en public. Se elimina el esquema al cerrar limpiamente con SIGINT/SIGTERM.

Capturas y resultados están en `evidencias/panel-docente/`. El PDF se guarda en `output/pdf/`. No incluye contraseñas, tokens ni cookies. No se ha realizado una revisión humana independiente ni se atribuye a los integrantes trabajo que no hayan confirmado.

Preparación local de una cuenta administradora ficticia: `npm run admin:local`. Solo funciona con NODE_ENV=development y PGHOST local. Crea una cuenta nueva de ensayo con contraseña aleatoria y credenciales en `.admin-local.json`, excluido de Git. No concede docencia ni modifica cuentas existentes.
