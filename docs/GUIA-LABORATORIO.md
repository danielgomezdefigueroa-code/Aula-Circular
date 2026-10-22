# Guía del laboratorio: servidor y datos

## Qué hace y dónde está cada parte

El navegador carga `public/index.html`, que redirige a `public/html/index.html`. La portada y las páginas de área consultan las APIs de catálogo; las páginas de producto viven en `public/html/` y cargan módulos de `public/mjs/`. La demo de la API vive en `public/laboratorio/index.html` y `public/laboratorio/catalogo.mjs`: solicita `/api/recursos-demo`. `src/app.mjs` arranca Express y monta la aplicación de `src/aplicacion.mjs`; las rutas de catálogo de `src/catalogo.mjs` y la demo consultan PostgreSQL mediante `pg` y devuelven JSON. El cliente crea las tarjetas con ese resultado.

| Archivo | Responsabilidad |
| --- | --- |
| src/app.mjs | Arranque de Express, pool de PostgreSQL y cierre ordenado |
| src/aplicacion.mjs | Sesiones, CSRF, registro, acceso, perfil, demo y archivos públicos |
| src/catalogo.mjs | Rutas de lectura `/api/biblioteca` y `/api/documentacion` |
| src/anuncios.mjs | Rutas y reglas de anuncios propios y publicados |
| src/docencia.mjs | Validación docente de cuentas |
| public/index.html | Puerta de entrada: redirige a `html/index.html` |
| public/html/*.html | Páginas de producto: login, inicio, áreas y Mi espacio |
| public/mjs/shell.mjs | Sesión, menú por permisos, CSRF y cierre de sesión |
| public/mjs/login.mjs | Acceso, registro y estados de cuenta |
| public/mjs/docencia.mjs | Validación de cuentas por docencia |
| public/mjs/libros.mjs | Listado real de anuncios publicados |
| public/mjs/mi-espacio.mjs | Perfil y gestión de anuncios propios |
| public/mjs/inicio.mjs | Catálogo de Inicio contra las APIs de las tres áreas |
| public/mjs/biblioteca.mjs | Catálogo de Biblioteca contra `/api/biblioteca` |
| public/mjs/documentacion.mjs | Documentos contra `/api/documentacion` |
| public/mjs/catalogo-comun.mjs | Tarjetas y filtros compartidos del catálogo |
| public/laboratorio/index.html | Demo del catálogo conectado a `/api/recursos-demo` |
| public/laboratorio/catalogo.mjs | Búsqueda, peticiones y presentación de la demo |
| sql/001_laboratorio.sql | Datos de demo, inventario y documentos; ejecutar después de migrar |
| sql/migraciones/005_documentos.sql | Documentos, archivos y versiones; listado en `/api/documentacion` y descarga pendiente |
| sql/historico/ | SQL antiguo conservado como referencia; no ejecutar |
| .env.example | Plantilla; revisar `PGDATABASE` y no usar el marcador de `SESSION_SECRET` sin preparar |
| .gitignore | Excluye `.env`, dependencias y archivos privados; no incluye `.docente-local.json` |
| package.json | Dependencias y comandos npm |
| package-lock.json | Versiones resueltas para npm ci; no editar a mano |

## Entorno

Usar Node.js 24 y PostgreSQL 17. En la sesión de Fede se comprobaron Node 24.21.0, npm 11.19.0 y PostgreSQL 17.11. Los archivos adjuntos fijan Express 5.2.1 y pg 8.23.1. Cada integrante debe registrar sus propias versiones.

> **Revisión del 2026-10-22.** La instancia local revisada usa Node 24.22.0, npm 11.19.1, PostgreSQL 18.6 y la base `aula_prueba_catalogo`. El proyecto sigue fijando PostgreSQL 17; no se ha decidido cambiar ese requisito. No mezclar versiones ni nombres de base entre esta guía, `.env.example` y `.env`. El estado completo está en [REVISION-2026-10-22.md](REVISION-2026-10-22.md).

Los siguientes comandos son para Windows PowerShell. Usar `npm.cmd` evita problemas con npm.ps1 sin modificar la política global de scripts.

## Configuración y base de datos

Esta guía crea `aula_circular`; `.env.example` propone `aula_circular_sprint2_ensayo`; en el equipo revisado el `.env` apunta a `aula_prueba_catalogo`. No hay un nombre canónico decidido. Antes de ejecutar:

1. Elige un nombre de base y anótalo.
2. Usa el mismo nombre en `CREATE DATABASE`, `PGDATABASE` y `psql -d`.
3. No renombres ni borres la base actual sin copia y autorización.

El detalle y las decisiones pendientes están en [REVISION-2026-10-22.md](REVISION-2026-10-22.md).

Para seguir los ejemplos de esta guía, usa `aula_circular` y cambia `PGDATABASE` en `.env`; si prefieres otro nombre, cámbialo en los tres sitios.

## Preparación en un ordenador nuevo

Clonar la rama y entrar en el proyecto:

```powershell
git clone --branch sprint1-servidor-y-datos --single-branch https://github.com/danielgomezdefigueroa-code/Aula-Circular.git
Set-Location Aula-Circular
npm.cmd ci
```

Comprobar que PostgreSQL está ejecutándose:

```powershell
Get-Service -Name '*postgres*'
```

La ruta de los ejecutables debe adaptarse a la instalación real. Fede utiliza `D:\Program Files\PostgreSQL\17\bin`; una instalación habitual usa C:. Ejemplo:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h 127.0.0.1 -U postgres -d postgres -W
```

Dentro de psql, ejecutar una instrucción cada vez:

```sql
CREATE ROLE aula_app LOGIN;
```

```text
\password aula_app
```

Elegir una contraseña propia, distinta de la de postgres.

```sql
CREATE DATABASE aula_circular OWNER aula_app;
```

Si eliges otro nombre, cambia `aula_circular` aquí y en `PGDATABASE`.

```text
\q
```

Si el usuario o la base existen, comprobar su origen antes de continuar; no borrarlos. El repositorio contiene instrucciones SQL, no un servidor ni la base instalada en otro ordenador.

El orden es: preparar `.env`, aplicar las migraciones y, por último, cargar los datos de demo e inventario.

Crear la configuración solo si aún no existe:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad.exe .env
```

Completar PGPASSWORD con la contraseña local de aula_app. Comprueba que `PGDATABASE` coincide con la base creada. Si contiene # o espacios, delimitar el valor con comillas adecuadas. No compartir .env ni incluir contraseñas en capturas. PGPORT es el puerto de la base (5432); PORT es el del servidor web (3000).

Aplicar el esquema con las migraciones:

```powershell
npm.cmd run preparar
npm.cmd run migrar
```

Esperado: se aplican `002_cuentas.sql`, `003_validacion_docente.sql`, `004_anuncios.sql` y `005_documentos.sql`.

Después, cargar los datos ficticios de demo, inventario, anuncios y documentos:

```powershell
$env:PGCLIENTENCODING = 'UTF8'
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h 127.0.0.1 -U aula_app -d aula_circular -W -v ON_ERROR_STOP=1 -f sql/001_laboratorio.sql
```

Esperado: `CREATE TABLE`, `INSERT 0 4` y los datos del inventario y los documentos. El archivo se guarda en UTF-8 sin BOM. Es idempotente: se puede repetir sin duplicar los datos. Si se ejecuta antes de las migraciones, se detiene con un error controlado.

## Arranque y parada

```powershell
npm.cmd run dev
```

Abrir http://127.0.0.1:3000 y mantener la terminal abierta. La entrada redirige a `html/index.html`; el acceso está en `http://127.0.0.1:3000/html/login.html`. `dev` vigila cambios del código; `npm.cmd run start` arranca sin vigilancia. Reiniciar manualmente si cambia .env. Ctrl+C detiene el servidor.

El servidor escucha solo en 127.0.0.1: no publica la aplicación para otros ordenadores.

## API y pruebas manuales

| Petición | Resultado esperado |
| --- | --- |
| GET /api/salud | 200; estado listo, baseDatos true si puede conectar |
| GET /api/recursos-demo | 200; datos con todos los recursos |
| GET /api/recursos-demo?q=calculadora | Recursos cuyo título coincide |
| GET /ruta-inexistente | 404; error NO_ENCONTRADO |

```powershell
Invoke-RestMethod 'http://127.0.0.1:3000/api/salud'
Invoke-RestMethod 'http://127.0.0.1:3000/api/recursos-demo?q=calculadora' | ConvertTo-Json -Depth 4
curl.exe -i http://127.0.0.1:3000/ruta-inexistente
```

La salud ejecuta SELECT 1: comprueba conexión, pero no que recurso_demo exista. Una migración ausente puede dar salud 200 y catálogo 500.

`/api/biblioteca`, `/api/documentacion` y `/api/libros` exigen una sesión activa con rol alumno o docente. `/api/recursos-demo` es pública y solo contiene datos sintéticos.

Rutas de la aplicación organizada:

| Ruta | Uso |
| --- | --- |
| /html/login.html | Registro y acceso |
| /html/index.html | Inicio y catálogo de las tres áreas |
| /html/biblioteca.html | Catálogo de recursos de Biblioteca |
| /html/libros.html | Anuncios publicados |
| /html/documentacion.html | Documentos y versiones |
| /html/mi-espacio.html | Perfil, cierre de sesión y anuncios propios |
| /html/docencia.html | Validación de cuentas (solo docencia activa) |
| /laboratorio/ | Demo del catálogo de `/api/recursos-demo` |

Buscar calculadora debe mostrar una tarjeta; zzzz debe mostrar cero; vacío, cuatro en el conjunto inicial. Cambiar un título en PostgreSQL y recargar demuestra que los datos vienen de la base. La demo se abre en `/laboratorio/`; la portada y las áreas usan `/api/biblioteca`, `/api/libros` y `/api/documentacion`.

Para probar puerto ocupado, mantener el primer servidor y lanzar `npm.cmd run start` en otra terminal desde la misma carpeta. Esperado: EADDRINUSE. No detener procesos de otras personas.

Para copia limpia, clonar en una carpeta nueva, ejecutar npm.cmd ci, preparar .env, migrar y cargar `sql/001_laboratorio.sql` tras parar el servidor anterior. Documentar si se reutilizó la base existente o se preparó otra. El `001` es idempotente, pero no sustituye a las migraciones.

`npm.cmd test` ejecuta `pruebas/cuentas.test.mjs` y `pruebas/anuncios.test.mjs` contra PostgreSQL y HTTP reales. Crea esquemas temporales `aula_test_...`, necesita permiso para crear esquemas y no vacía las tablas de trabajo. Si PostgreSQL no está levantado, falla con `ECONNREFUSED 127.0.0.1:5432`; las pruebas manuales de esta guía siguen siendo necesarias para la interfaz. Los resultados esperados no acreditan por sí solos su ejecución. En la revisión local del 2026-10-22 pasaron 17 de 17. `tests/` es legado y no forma parte de esta suite.

## Decisiones del código

- Pool reutiliza hasta cinco conexiones y limita la espera de conexión a tres segundos.
- La búsqueda usa $1: el dato se envía separado del SQL; ILIKE ignora mayúsculas y % busca coincidencias parciales. % y _ siguen siendo comodines.
- El contador del cliente ignora respuestas antiguas si se hacen búsquedas seguidas; no cancela sus solicitudes.
- textContent presenta los títulos como texto, sin ejecutar HTML procedente de los datos.
- Express publica public/ y la API desde el mismo origen, por lo que no se necesita CORS aquí.
- 503 indica fallo de conexión en salud; 500, error en una ruta; 404, recurso inexistente. No se envían detalles internos al cliente.
- La API demo es pública y solo usa datos sintéticos. No tiene autenticación: antes de incorporar datos privados se requieren sesiones y autorización.

## Diagnóstico

| Síntoma | Comprobar |
| --- | --- |
| node no se reconoce | Instalación y una terminal nueva |
| npm.ps1 bloqueado | Usar npm.cmd |
| Connection refused | Servicio de PostgreSQL y puerto configurado |
| Sin servicio registrado | Instalación del servidor y posible fallo de creación del clúster |
| Contraseña rechazada | Usuario, base y contraseña del .env; probar con psql |
| DLL bloqueada | Eventos de CodeIntegrity; identificar la protección antes de modificarla |
| Error antes de CREATE por caracteres extraños | Guardar SQL en UTF-8 sin BOM y usar PGCLIENTENCODING UTF8 |
| relation already exists | No repetir la inicialización; revisar estado de la base |
| EADDRINUSE | Otro servidor ocupa PORT |
| Página abierta como file:// | Abrir la dirección HTTP |

## Revisión y cambios pendientes

El estado comprobado el 2026-10-22, los riesgos y los cambios recomendados que aún no se han aplicado están en [REVISION-2026-10-22.md](REVISION-2026-10-22.md).

## Evidencias y colaboración

Guardar versiones reales, salud, catálogo, filtro y resultados de pruebas realizadas. Anotar quién ejecutó cada tarea; no atribuir pruebas sin evidencia. Fede preparó el laboratorio según la sesión compartida; completar el reparto del resto del equipo con su trabajo real.

Estos comentarios no cambian la lógica de la aplicación. Para incorporar la documentación, copiar los archivos sobre la copia local del repositorio, conservar .git y .env propios, revisar git diff y publicar una rama de documentación para revisión. Este paquete no modifica GitHub por sí solo.
