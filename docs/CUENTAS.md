# Registro y sesiones: primer paso

Se añade la base de cuentas que usan la validación docente y los anuncios. El registro crea una cuenta pendiente con rol alumno. El navegador no elige roles ni confirma cursos. Una cuenta pendiente puede iniciar sesión y consultar su perfil, pero no entrar en Biblioteca.

> **Revisión del 2026-10-22.** No uses el marcador de `SESSION_SECRET` sin ejecutar `npm.cmd run preparar` y no des por hecho que `.docente-local.json` está ignorado: actualmente no lo está. El estado y los cambios pendientes están en [REVISION-2026-10-22.md](REVISION-2026-10-22.md).

## Arranque en Windows

Usa Node 24. Si `node --version` muestra Node 6 de Brackets, abre una terminal nueva y revisa PATH; temporalmente usa `& "C:\Program Files\nodejs\node.exe"` y `& "C:\Program Files\nodejs\npm.cmd"`.

1. `npm.cmd ci`
2. Copia `.env.example` a `.env` solo si no existe. Comprueba que `PGDATABASE` coincide con la base creada y completa tu contraseña local de PostgreSQL.
3. `npm.cmd run preparar`: genera un secreto local si no existe y añade el origen local.
4. `npm.cmd run migrar`: aplica las migraciones pendientes en una transacción. Conserva su hash y no vuelve a aplicarlas. No cambia el SQL inicial ya utilizado.
5. `psql -f sql/001_laboratorio.sql`: carga los datos ficticios de demo, inventario, anuncios y documentos. Es idempotente y debe ejecutarse después de migrar.
6. `npm.cmd run dev`
7. Abre `http://127.0.0.1:3000/html/login.html`.

En `.env.example`, SESSION_SECRET es una indicación, no una clave válida para compartir. El script preparar reemplaza ese marcador por un valor aleatorio local. La comprobación actual de la aplicación solo exige 32 caracteres: el marcador supera ese mínimo y sería aceptado si no se ejecuta el script. No arranques con él. APP_ORIGIN debe coincidir con el origen del navegador (protocolo, host y puerto). Para este laboratorio utiliza siempre 127.0.0.1, no localhost.

## Prueba manual

Registra una cuenta inventada eligiendo uno de los cursos de ensayo DAW1/DAW2. Usa una frase de 15 a 128 caracteres. Inicia sesión con ella y abre `/html/mi-espacio.html`: el perfil debe indicar pendiente y curso confirmado pendiente de confirmación. Cierra sesión: el perfil deja de mostrarse. Conservar los resultados sin contraseñas, cookies ni token CSRF.

`npm.cmd test` prueba registro, aislamiento entre sesiones, CSRF, regeneración de sesión, protección de cuenta pendiente/suspendida, lectura actual de estado, revocación por auth_version y logout. Usa un esquema PostgreSQL temporal `aula_test_...`, no vacía tablas de trabajo y elimina solo ese esquema al terminar. Necesita permiso de crear esquemas en la base configurada. Los límites de intentos se desactivan exclusivamente en esta prueba de integración para poder repetirla. En la revisión local del 2026-10-22 pasaron 17 de 17. `tests/` es legado y no forma parte de la suite.

## Qué contiene

- `src/claves.mjs`: hash scrypt con sal; máximo dos derivaciones simultáneas.
- `src/app.mjs`: registro, login, logout, perfil y protección CSRF con comprobación de Origin.
- `sql/migraciones/002_cuentas.sql`: usuarios, cursos, roles y almacén de sesiones.
- `sql/migraciones/005_documentos.sql`: documentos, archivos y versiones; base para la descarga autorizada, todavía sin rutas HTTP.
- Las sesiones caducan tras 30 minutos de inactividad y 8 horas absolutas. Cambiar auth_version revoca sesiones previas.
- El perfil lee roles, estado y curso actuales de PostgreSQL en cada petición.
- Límite de login: cinco fallos por cliente/correo en 15 minutos y 30 intentos por cliente. Registro también limitado por cliente. Límites en memoria para un único proceso: se reinician con el servidor.

## Qué sigue pendiente

La revisión docente de anuncios y la administración de roles. No hay una ruta pública para convertir una cuenta en docente. `/api/biblioteca` lista los recursos del centro y `/api/documentacion` lista los documentos con su versión vigente; ambas exigen una cuenta activa con rol alumno o docente. `/api/recursos-demo` sigue siendo la demostración pública con cuatro recursos sintéticos.

## Validación docente

`npm.cmd run migrar` aplica 003_validacion_docente.sql. El docente activo accede al listado paginado de pendientes mediante GET /api/gestion/usuarios y confirma cuenta/curso con POST /api/gestion/usuarios/:id/validar y {cursoId}. El servidor registra autor, fecha y evento. No concede roles. Un admin sin rol docente no puede validar.

La validación bloquea la cuenta dentro de una transacción para evitar una doble revisión. Incrementa auth_version: el alumno vuelve a iniciar sesión para usar su nuevo estado. El curso solicitado se conserva, mientras el confirmado puede ser otro curso activo que el docente haya comprobado.

Preparación local separada del registro público: `npm.cmd run docente:local` crea exclusivamente la cuenta ficticia docente.ensayo@example.invalid con rol docente. No modifica ninguna cuenta existente. Solo se permite en desarrollo contra PostgreSQL local. Genera una contraseña aleatoria en `.docente-local.json`. Ese archivo **no está incluido actualmente en `.gitignore`**: comprueba `git status` antes de continuar y no lo añadas a Git. El mensaje del script afirma que está excluido, pero mientras no se corrija `.gitignore` no es cierto. No compartir ese archivo. Este procedimiento de preparación no representa una validación de pertenencia realizada por otro docente.

Inicia sesión en `/html/login.html` con esa cuenta y abre `/html/docencia.html`. Revisa la cuenta pendiente y confirma su curso. Para comparar simultáneamente alumno y docente, usa perfiles o navegadores separados; dos pestañas normales comparten sesión.

El despliegue HTTPS requiere revisar configuración del proxy y cookie segura. Este paso solo prepara el entorno local.
