## 🚀 Instalación y ejecución en local

Estas instrucciones permiten preparar **Aula Circular** en un ordenador nuevo para desarrollo y pruebas.

### 1. Requisitos previos

Es necesario tener instalados:

- **Node.js 24** y npm.
- **PostgreSQL 17**.
- **Git**.
- Un editor de código, como Visual Studio Code.

### 2. Descargar el proyecto

Desde una terminal:

```bash
git clone https://github.com/danielgomezdefigueroa-code/Aula-Circular.git
cd Aula-Circular
npm ci
```

Durante la integración, utilizar la rama `integracion` una vez publicada. Cuando esté incorporada a `main`, bastará con clonar la rama principal.

### 3. Preparar PostgreSQL

Con PostgreSQL iniciado, abrir `psql` como administrador:

```bash
psql -h 127.0.0.1 -U postgres -d postgres
```

Crear un usuario y una base de datos locales:

```sql
CREATE ROLE aula_app LOGIN;
\password aula_app
CREATE DATABASE aula_circular_local OWNER aula_app;
```

Elegir una contraseña propia para `aula_app` y guardarla para el siguiente paso.

Si el usuario o la base ya existen, reutilizarlos o elegir otros nombres sin eliminar los datos existentes.

### 4. Configurar las variables de entorno

Crear el archivo `.env` a partir de la plantilla:

```bash
cp .env.example .env
```

Abrir `.env` y comprobar estos valores:

```dotenv
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://127.0.0.1:3000

PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=aula_circular_local
PGUSER=aula_app
PGPASSWORD=TU_CONTRASEÑA_LOCAL
```

Mantener la línea `SESSION_SECRET` de la plantilla. El siguiente comando generará automáticamente un secreto de sesión seguro:

```bash
npm run preparar
```

**Importante:** `.env` contiene información privada y no debe subirse a GitHub.

### 5. Preparar la base de datos

Aplicar todas las migraciones:

```bash
npm run migrar
```

Opcionalmente, cargar los recursos ficticios de demostración:

```bash
psql -h 127.0.0.1 -U aula_app -d aula_circular_local -v ON_ERROR_STOP=1 -f sql/001_laboratorio.sql
```

También se puede crear una cuenta docente ficticia para realizar pruebas:

```bash
npm run docente:local
```

Si se crea correctamente, sus credenciales estarán en `.docente-local.json`, un archivo privado que no debe compartirse.

### 6. Iniciar la aplicación

Para arrancar el servidor:

```bash
npm start
```

Abrir en el navegador:

**http://127.0.0.1:3000**

Para trabajar en desarrollo y reiniciar automáticamente el servidor al modificar el código:

```bash
npm run dev
```

Para detener el servidor, pulsar `Ctrl + C` en la terminal.

### 7. Ejecutar las pruebas

Con PostgreSQL iniciado y `.env` configurado:

```bash
npm test
```

Este comando ejecuta las pruebas automatizadas de los distintos módulos de Aula Circular.

En Windows PowerShell, si existe un bloqueo de ejecución de `npm.ps1`, utilizar `npm.cmd` en lugar de `npm`.

### 📖 Más información

Para consultar el funcionamiento técnico, las migraciones, las rutas API y la resolución de errores, revisar la [Guía del laboratorio](docs/GUIA-LABORATORIO.md).