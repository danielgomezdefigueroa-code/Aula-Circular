# Fede: continuar Sprint 3 con el documento de Daniel

## Empieza aqui
Continua sobre el Google Docs que te pasa Daniel: **SP3 - Reservar ejemplares y registrar prestamos**. Sus apartados 1 a 4 y sus capturas son la base del documento conjunto. No empieces otro documento ni repitas esas pruebas como si fueran tuyas.

Trabajamos en el **plan de 370 horas**, sin la ampliacion de 500. La entrega final es un unico PDF conjunto de **cinco paginas y 10 MB como maximo**. Daniel ocupa aproximadamente dos paginas; conserva espacio para tu parte, la matriz y la revision real.

## Codigo y rama
Repositorio: https://github.com/danielgomezdefigueroa-code/Aula-Circular
Rama de trabajo: **codex/sprint3-prestamos**
Enlace: https://github.com/danielgomezdefigueroa-code/Aula-Circular/tree/codex/sprint3-prestamos
Guia del repositorio: https://github.com/danielgomezdefigueroa-code/Aula-Circular/blob/codex/sprint3-prestamos/docs/Sprint3-PRESTAMOS.md

Esta rama parte de **biblioteca-documentos, 46f2672**, que ya contiene las cuentas y sesiones de vuestra rama compartida. No se ha fusionado en main ni en sprint1-servidor-y-datos ni se ha modificado biblioteca-documentos.

## Como hemos trabajado
1. Revisamos las guias Datos y estados, API y permisos, Biblioteca y prestamos y Pruebas y evidencias.
2. Verificamos que la carpeta local estuviera limpia. Hicimos y comprobamos una copia completa: 916 archivos.
3. Creamos la rama local desde el catalogo para aprovechar recurso/ejemplar y las sesiones, sin duplicar sus tablas ni cambiar sus migraciones.
4. Creamos una base nueva **aula_circular_sprint3_ensayo**, propiedad de **aula_app**. Las pruebas no usan las bases anteriores.
5. Aplicamos como aula_app y una sola vez: **002, 003, 005, 006, 007, 008 y 009**. No aplicamos 001 ni 004. Comprobamos las seis tablas nuevas en pgAdmin.
6. Implementamos la solicitud y la probamos con HTTP real y consultas SQL posteriores. Daniel ejecuto el script y anadio sus capturas a Docs.
7. Usamos IA para preparar codigo comentado, comprobaciones y borradores. No se ha realizado todavia la revision conjunta.

## Que aporta cada archivo
- **sql/009_prestamos.sql**: crea solicitud, operacion, operacion_item, reserva_activa, evento_operacion y aviso. No cambia las tablas existentes. Solo admite la base de ensayo del Sprint 3.
- **src/prestamos/solicitudes.mjs**: revalida cuenta/rol, comprueba el ejemplar y guarda la solicitud pendiente. Parametros SQL y transaccion; no crea operaciones ni reservas.
- **src/prestamos/rutas.mjs**: POST /api/solicitudes con sesion, cuenta activa, rol alumno y CSRF.
- **src/app.mjs**: anadimos solo el import y el montaje del router de prestamos, antes del router del catalogo.
- **scripts/probar-solicitudes.mjs**: prepara datos ficticios, arranca el servidor real en un puerto libre, ejecuta once casos y comprueba PostgreSQL. Cierra solo la instancia que creo.
- **docs/Sprint3-PRESTAMOS.md**: esta guia. El resto del codigo de cuentas y catalogo procede de la base anterior.

## Descargar sin pisar tu trabajo
En la terminal de TU repositorio, empieza por `git status`. Si hay cambios pendientes, conservarlos y revisarlos antes de cambiar de rama. No ejecutar reset ni borrar archivos.
Con la carpeta limpia:
```powershell
git fetch origin
git branch --all
```
Si solo existe la rama remota:
```powershell
git switch --track origin/codex/sprint3-prestamos
```
Si ya existe localmente, usar `git switch codex/sprint3-prestamos`. Despues:
```powershell
git pull --ff-only
git log -1 --oneline
npm ci --ignore-scripts
```
Si el avance no es directo, detenerse y comparar, nunca forzar una subida. Comprobar cambios nuevos de otros antes de publicar.

## Preparar tu base local
Git descarga codigo, no las bases de datos ni credenciales de Daniel.
1. En pgAdmin, crear **aula_circular_sprint3_ensayo**, propietario aula_app. Si ya existe, comprobar sus tablas; no borrarla ni repetir migraciones.
2. En una conexion a esa base como **aula_app**, aplicar los archivos completos en este orden:
   002_cuentas.sql, 003_sesiones.sql, 005_catalogo_biblioteca.sql,
   006_validacion_ejemplares.sql, 007_datos_biblioteca.sql,
   008_metadatos_digitales.sql, 009_prestamos.sql.
   Si usas una conexion administradora en Query Tool, ejecutar primero `SET ROLE aula_app;` en esa base; asi las tablas quedan a nombre de la cuenta de la aplicacion. Confirmar base y rol antes de ejecutar. Detenerse ante un error; no seguir ni repetir a ciegas.
3. Preparar tu .env local a partir de .env.example SOLO si aun no existe. Si existe, conservarlo antes de adaptar su configuracion. Usar PGHOST=127.0.0.1, PGUSER=aula_app, PGDATABASE=aula_circular_sprint3_ensayo y tu PGPASSWORD local; puerto segun tu instalacion.
4. Para arrancar manualmente: NODE_ENV=development, PORT=3000, APP_ORIGIN=http://127.0.0.1:3000 y SESSION_SECRET aleatorio local de al menos 32 caracteres. No publicar su valor ni introducirlo en capturas.
5. No reutilizar scripts antiguos que exijan la base del Sprint 2 cambiando solo el .env: revisar sus protecciones. El script nuevo ya admite exclusivamente Sprint 3.

## Repetir las pruebas de Daniel
Desde la raiz, con el .env de Sprint 3:
```powershell
node --env-file=.env scripts/probar-solicitudes.mjs
```
Las variables ya definidas en la terminal tienen prioridad sobre el .env: comprobar especialmente PGDATABASE. El test se niega a usar otra base, un host remoto o un usuario distinto de aula_app.
Crea cuatro cuentas y tres ejemplares ficticios por ejecucion; conserva los datos anteriores. Las claves aleatorias, cookies y tokens solo viven en memoria y no se imprimen. Esas cuentas no sirven para login manual porque no se conservan sus claves. Para tus pruebas, prepara identidades propias en tu ensayo sin claves fijas en Git, o integra la preparacion dentro de tu script de pruebas.

Resultados reales del 19/10/2026:
- A01 y A02 solicitan el mismo ejemplar: 201 y 201.
- A01 repite: 409, con referencia a su solicitud existente.
- Sin sesion: 401.
- Pendiente, docente sin rol alumno y falta de CSRF: 403.
- Enviar solicitanteId, pedir un ejemplar propio o enviar ID no numerico: 422.
- Ejemplar retirado: 409.
- SQL final para el ejemplar del ensayo: dos solicitudes pendientes de alumnos distintos, **cero reservas y cero items de operacion**; sigue disponible.
Once casos HTTP pasaron. Esto NO demuestra asignacion ni entrega ni concurrencia.
Durante la preparacion corregimos un correo ficticio generado con mayusculas. PostgreSQL lo rechazo y la transaccion se deshizo antes de repetir el ensayo; no hubo cuentas parciales.

## Contrato que debes conservar
POST /api/solicitudes recibe solo `{ "ejemplarId": 1 }`, entero positivo. La identidad procede de la sesion. Campos extra, incluido solicitanteId, se rechazan con 422.
Exito: 201 con `{datos:{id,estado:'pendiente'},mensaje:'Solicitud enviada'}`.
Duplicado propio: 409 SOLICITUD_YA_PENDIENTE con solicitudId existente.
Esta fase cubre prestamos del centro: recurso fisico/publicado, propietario nulo, ejemplar disponible y sin reserva activa. Solicitar NO reserva.

El catalogo existente usa estado_servicio disponible/reservado/prestado/retirado. No renombramos ese esquema. Al asignar y entregar, mantenerlo coherente con reserva_activa dentro de la transaccion; la reserva es la proteccion contra doble asignacion, no un contador de stock.
009 restringe operacion.tipo a prestamo. Otras modalidades se ampliaran con una migracion acordada. operacion.vencimiento es obligatorio al asignar: proponer inicialmente 14 dias, revisar y validar al entregar. La coherencia SQL con entregada_en no sustituye comprobar en servidor una fecha futura en Europe/Madrid.

## Tu parte pendiente, paso a paso
1. Crear **POST /api/gestion/solicitudes/:id/asignar**, exclusivo de docente activo con CSRF. Tomar identidad de sesion y revalidar los permisos al escribir.
2. Bloquear el ejemplar y releer disponibilidad dentro de una transaccion en la misma conexion. Crear operacion, item, reserva, solicitud asignada, rechazo de las otras pendientes, evento y avisos juntos. Si falla algo, rollback sin filas parciales. La PK de reserva_activa impide dos reservas del mismo ejemplar.
3. Crear **POST /api/gestion/operaciones/:id/entregar**. Validar operacion reservada y fecha de vencimiento futura. Registrar prestada, fecha, evento y aviso, manteniendo la reserva. Repetir la confirmacion no debe duplicar efectos: devolver estado existente o rechazo coherente segun el contrato.
4. Probar fecha invalida y usuario sin permiso, verificando tambien que no cambiaron los datos.
5. Preparar dos alumnos que solicitan el mismo ejemplar y dos sesiones docentes independientes. Coordinar los intentos para que coincidan de forma reproducible; dos clics rapidos no acreditan concurrencia. Comprobar una asignacion aceptada, otro conflicto y SQL final con una reserva y una operacion completa, sin otra parcial.
6. Repetir la prueba de Daniel tras integrar. Revisar entre ambos los resultados antes de fusionar. La ampliacion de reintento tras respuesta perdida de 500 horas no corresponde, pero la repeticion basica de entrega sin duplicados si.

No reescribir migraciones ya aplicadas ni borrar datos ajenos. Si necesitas alterar tablas, acordar una migracion nueva. Coordinar los cambios en app.mjs y dependencias comunes.

## Completar el Google Docs existente
Conservar los apartados 1 a 4 de Daniel y sus dos figuras. Corregir, si aun aparece, el futuro de su aportacion a pasado; evitar repetir la preparacion; anadir ayuda de IA. Mantener aproximadamente dos paginas para esa parte.
Anadir:
- **5. Asignacion docente**: entrada/actor, esperado, captura HTTP y estado SQL real.
- **6. Entrega y fechas**: entrega correcta, fecha invalida, falta de permiso y repeticion sin duplicados; capturas agrupadas.
- **7. Concurrencia y estado final**: dos sesiones, dos intentos, una asignacion y un rechazo; consulta de reserva_activa, operacion y operacion_item.
- **8. Matriz y revision**: caso/entrada, esperado, observado y figura; aportacion real de cada integrante, ayuda de IA, commit final y revision con fecha, quien comprobo que y resultado.

No presentar como comprobado lo que siga pendiente. No inventar una explicacion personal ni una revision de Daniel. PDF final de cinco paginas/10 MB, capturas legibles con metodo, ruta, estado HTTP y datos seguros. Sin claves, valores de cookies, tokens ni hashes completos. La captura de las tablas no sustituye comprobar las restricciones y el estado SQL final.

## Si lo continua tu IA
Lee este archivo, el documento de Daniel y las guias oficiales antes de modificar. Conserva el trabajo realizado, la rama y el contrato. Implementa solo la parte pendiente de Fede de forma sencilla y comentada. Primero revisa estado local/remoto y crea una copia de seguridad. Trabaja en su base local separada. Explica cambios, avisa antes de capturas y registra resultados reales. No force push, reset --hard, borrados ni fusiones en ramas ajenas. Publicar y fusionar requieren la autorizacion de Federico y la revision acordada; main necesita autorizacion del equipo. No des por terminada la practica hasta completar integracion, evidencia y revision conjunta.
