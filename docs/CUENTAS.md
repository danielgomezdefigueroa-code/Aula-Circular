# Registro y sesiones: primer paso

Se añade la base de cuentas para después implementar los anuncios. El registro crea una cuenta pendiente con rol alumno. El navegador no elige roles ni confirma cursos. Una cuenta pendiente puede iniciar sesión y consultar su perfil, pero no entrar en Biblioteca.

## Arranque en Windows

Usa Node 24. Si `node --version` muestra Node 6 de Brackets, abre una terminal nueva y revisa PATH; temporalmente usa `& "C:\Program Files\nodejs\node.exe"` y `& "C:\Program Files\nodejs\npm.cmd"`.

1. `npm.cmd ci`
2. Copia `.env.example` a `.env` solo si no existe. Completa tu contraseña local de PostgreSQL.
3. `npm.cmd run preparar`: genera un secreto local si no existe y añade el origen local.
4. `npm.cmd run migrar`: aplica las migraciones pendientes en una transacción. Conserva su hash y no vuelve a aplicarlas. No cambia el SQL inicial ya utilizado.
5. `npm.cmd run dev`
6. Abre `http://127.0.0.1:3000/cuenta.html`.

En `.env.example`, SESSION_SECRET es una indicación, no una clave válida para compartir. El script preparar reemplaza ese marcador por un valor aleatorio local. APP_ORIGIN debe coincidir con el origen del navegador (protocolo, host y puerto). Para este laboratorio utiliza siempre 127.0.0.1, no localhost.

## Prueba manual

Registra una cuenta inventada eligiendo uno de los cursos de ensayo DAW1/DAW2. Usa una frase de 15 a 128 caracteres. Inicia sesión con ella: el perfil debe indicar pendiente y curso confirmado pendiente de confirmación. Cierra sesión: el perfil deja de mostrarse. Conservar los resultados sin contraseñas, cookies ni token CSRF.

`npm.cmd test` prueba registro, aislamiento entre sesiones, CSRF, regeneración de sesión, protección de cuenta pendiente/suspendida, lectura actual de estado, revocación por auth_version y logout. Usa un esquema PostgreSQL temporal `aula_test_...`, no vacía tablas de trabajo y elimina solo ese esquema al terminar. Necesita permiso de crear esquemas en la base configurada. Los límites de intentos se desactivan exclusivamente en esta prueba de integración para poder repetirla.

## Qué contiene

- `src/claves.mjs`: hash scrypt con sal; máximo dos derivaciones simultáneas.
- `src/aplicacion.mjs`: registro, login, logout, perfil y protección CSRF con comprobación de Origin.
- `sql/migraciones/002_cuentas.sql`: usuarios, cursos, roles y almacén de sesiones.
- Las sesiones caducan tras 30 minutos de inactividad y 8 horas absolutas. Cambiar auth_version revoca sesiones previas.
- El perfil lee roles, estado y curso actuales de PostgreSQL en cada petición.
- Límite de login: cinco fallos por cliente/correo en 15 minutos y 30 intentos por cliente. Registro también limitado por cliente. Límites en memoria para un único proceso: se reinician con el servidor.

## Qué sigue pendiente

Anuncios, historial de revisión de anuncios, administración de roles y Mi espacio completo. No hay una ruta pública para convertir una cuenta en docente. `/api/biblioteca` comprueba acceso pero responde 501 a cuentas autorizadas porque el catálogo de producto no está construido. `/api/recursos-demo` sigue siendo la demostración pública con dos recursos sintéticos.

## Validación docente

`npm.cmd run migrar` aplica 003_validacion_docente.sql. El docente activo accede al listado paginado de pendientes mediante GET /api/gestion/usuarios y confirma cuenta/curso con POST /api/gestion/usuarios/:id/validar y {cursoId}. El servidor registra autor, fecha y evento. No concede roles. Un admin sin rol docente no puede validar.

La validación bloquea la cuenta dentro de una transacción para evitar una doble revisión. Incrementa auth_version: el alumno vuelve a iniciar sesión para usar su nuevo estado. El curso solicitado se conserva, mientras el confirmado puede ser otro curso activo que el docente haya comprobado.

Preparación local separada del registro público: `npm.cmd run docente:local` crea exclusivamente la cuenta ficticia docente.ensayo@example.invalid con rol docente. No modifica ninguna cuenta existente. Solo se permite en desarrollo contra PostgreSQL local. Genera una contraseña aleatoria en `.docente-local.json`, excluido de Git. No compartir ese archivo. Este procedimiento de preparación no representa una validación de pertenencia realizada por otro docente.

Inicia sesión en /cuenta.html con esa cuenta y abre /docencia.html. Revisa la cuenta pendiente y confirma su curso. Para comparar simultáneamente alumno y docente, usa perfiles o navegadores separados; dos pestañas normales comparten sesión.

El despliegue HTTPS requiere revisar configuración del proxy y cookie segura. Este paso solo prepara el entorno local.
