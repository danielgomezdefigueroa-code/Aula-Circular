\# Sprint2: integración de cuentas y sesiones



\## Alcance



Registro, acceso, salida, identidad, activación docente y catálogo

de ensayo protegido. Ejecución local con Node.js 24 y PostgreSQL 17.



La interfaz del Sprint1 todavía consulta una ruta antigua.

Las pruebas de esta integración se ejecutan directamente por HTTP.

recurso\_demo es un catálogo sintético, no el modelo final de Biblioteca.



\## Preparación



Instalar dependencias desde la raíz:



```powershell

npm.cmd ci --ignore-scripts

```



Crear una base vacía aula\_circular\_sprint2\_ensayo, propiedad de aula\_app.



Aplicar como aula\_app, una sola vez y en este orden:

1\. sql/002\_cuentas.sql

2\. sql/003\_sesiones.sql

3\. sql/004\_recursos\_ensayo.sql



No ejecutar 001\_laboratorio.sql en esta base: 004 ya crea recurso\_demo.

Si una migración ya se aplicó, no repetirla ni borrar tablas.



Copiar .env.example a .env solo si este no existe.

Completar PGPASSWORD y generar SESSION\_SECRET localmente:



```powershell

node -e "const fs=require('node:fs');fs.appendFileSync('.env','\\nSESSION\_SECRET='+require('node:crypto').randomBytes(32).toString('hex')+'\\n');"

```



Antes de generar, eliminar únicamente la línea vacía SESSION\_SECRET=

de la copia local y comprobar que no existe otra clave configurada.

No publicar .env.



Preparar cuentas ficticias una sola vez:



```powershell

node --env-file=.env scripts/preparar-cuentas.mjs

```



El archivo .cuentas-ensayo.json contiene credenciales locales y está

excluido de Git. Cada ordenador genera sus propias credenciales.



El bootstrap establece las primeras cuentas directamente en PostgreSQL.

Es una preparación local de ensayo, no una validación pública.

El administrador no recibe rol docente automáticamente.



\## Arranque



```powershell

npm.cmd run start

```



Servidor: http://127.0.0.1:3000.

APP\_ORIGIN debe coincidir con esa dirección.



\## Pruebas HTTP



En otra terminal, desde la raíz:



```powershell

node scripts/probar-acceso.mjs

node --env-file=.env scripts/probar-registro-http.mjs

node --env-file=.env scripts/probar-activacion.mjs

```



Registro y activación dejan una cuenta ficticia nueva por ejecución.

Las pruebas no imprimen contraseñas, cookies, tokens ni hashes.



Los límites de intentos viven en memoria. Repetir muchas veces los

scripts puede producir 429. No confundirlo con un fallo de permisos.



\## Persistencia



Iniciar sesión y consultar /api/yo. Detener Node con Ctrl+C y arrancarlo

de nuevo. Reutilizar la misma sesión sin volver a acceder.

Mantener PostgreSQL y SESSION\_SECRET; completar antes de 30 minutos.

Comprobar también el estado persistido de la cuenta activada.



\## Evidencias y límites



Registrar commit probado, entrada, esperado, observado y aportaciones.

La revisión conjunta con Daniel debe realizarse y anotarse realmente.



No se ha implementado una ruta administrativa de cambio de roles.

Se ha probado el rechazo de intentos de conceder roles mediante registro

y activación. No se ha acreditado una autenticación desde la interfaz.

