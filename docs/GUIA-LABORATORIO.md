# Guía del laboratorio: servidor y datos

## Qué hace y dónde está cada parte

El navegador carga `public/index.html` y ejecuta `public/catalogo.mjs`. Este solicita `/api/recursos-demo`; Express, en `src/app.mjs`, consulta PostgreSQL mediante `pg` y devuelve JSON. El cliente crea las tarjetas con ese resultado.

| Archivo | Responsabilidad |
| --- | --- |
| src/app.mjs | Servidor, pool, API, archivos públicos, errores y cierre |
| public/index.html | Estructura, formulario y estilos |
| public/catalogo.mjs | Búsqueda, peticiones y presentación de datos |
| sql/001_laboratorio.sql | Tabla y dos datos sintéticos iniciales |
| .env.example | Plantilla sin contraseña real |
| .gitignore | Excluye credenciales, dependencias y archivos privados |
| package.json | Dependencias y comandos npm |
| package-lock.json | Versiones resueltas para npm ci; no editar a mano |

## Entorno

Usar Node.js 24 y PostgreSQL 17. En la sesión de Fede se comprobaron Node 24.21.0, npm 11.19.0 y PostgreSQL 17.11. Los archivos adjuntos fijan Express 5.2.1 y pg 8.23.1. Cada integrante debe registrar sus propias versiones.

Los siguientes comandos son para Windows PowerShell. Usar `npm.cmd` evita problemas con npm.ps1 sin modificar la política global de scripts.

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

```text
\q
```

Si el usuario o la base existen, comprobar su origen antes de continuar; no borrarlos. El repositorio contiene instrucciones SQL, no un servidor ni la base instalada en otro ordenador.

Aplicar una sola vez sobre la base nueva:

```powershell
$env:PGCLIENTENCODING = 'UTF8'
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h 127.0.0.1 -U aula_app -d aula_circular -W -v ON_ERROR_STOP=1 -f sql/001_laboratorio.sql
```

Esperado: CREATE TABLE e INSERT 0 2. El archivo se guarda en UTF-8 sin BOM. No repetirlo si ya se creó la tabla. No incluye una transacción global: si alguna instrucción falla, revisar qué se ejecutó antes de reintentar.

Crear la configuración solo si aún no existe:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad.exe .env
```

Completar PGPASSWORD con la contraseña local de aula_app. Si contiene # o espacios, delimitar el valor con comillas adecuadas. No compartir .env ni incluir contraseñas en capturas. PGPORT es el puerto de la base (5432); PORT es el del servidor web (3000).

## Arranque y parada

```powershell
npm.cmd run dev
```

Abrir http://127.0.0.1:3000 y mantener la terminal abierta. `dev` vigila cambios del código; `npm.cmd run start` arranca sin vigilancia. Reiniciar manualmente si cambia .env. Ctrl+C detiene el servidor.

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

Buscar calculadora debe mostrar una tarjeta; zzzz debe mostrar cero; vacío, dos en el conjunto inicial. Cambiar un título en PostgreSQL y recargar demuestra que los datos vienen de la base.

Para probar puerto ocupado, mantener el primer servidor y lanzar `npm.cmd run start` en otra terminal desde la misma carpeta. Esperado: EADDRINUSE. No detener procesos de otras personas.

Para copia limpia, clonar en una carpeta nueva, ejecutar npm.cmd ci, preparar .env y arrancar tras parar el servidor anterior. Documentar si se reutilizó la base existente o se preparó otra. No reaplicar el SQL inicial sobre una tabla existente.

`npm test` todavía es el marcador creado por npm y termina con error: no hay una suite automatizada. Estas pruebas son manuales y los resultados esperados no acreditan su ejecución.

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

## Evidencias y colaboración

Guardar versiones reales, salud, catálogo, filtro y resultados de pruebas realizadas. Anotar quién ejecutó cada tarea; no atribuir pruebas sin evidencia. Fede preparó el laboratorio según la sesión compartida; completar el reparto del resto del equipo con su trabajo real.

Estos comentarios no cambian la lógica de la aplicación. Para incorporar la documentación, copiar los archivos sobre la copia local del repositorio, conservar .git y .env propios, revisar git diff y publicar una rama de documentación para revisión. Este paquete no modifica GitHub por sí solo.
