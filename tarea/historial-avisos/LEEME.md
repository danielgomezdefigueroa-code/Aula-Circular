# Historial propio y avisos (370 horas)

## Objetivo y version
En este ejercicio reviso que Mi espacio muestre una historia coherente y privada. La lectura de un aviso no debe cambiar una operacion ni duplicar eventos. Mi version local es HIST-370-2026-11-18-v1, rama ejercicio/historial-avisos, sobre 7e7f5d93e80990f05def3082203030f90d0989df (integracion).
La implementacion y las pruebas automaticas se han preparado con ayuda de Codex. Los cambios se identifican por SHA-256 en version.json. La publicacion se realiza en una rama de ejercicio, sin integrar en main.

## Historia conocida y actores
La prueba crea dos cesiones completadas de A a B, un prestamo activo del centro a B y un intercambio cancelado entre A y B. Las cesiones y el prestamo se preparan por HTTP usando las rutas reales. El intercambio cancelado es una semilla SQL historica con dos items, un evento docente y dos avisos; no se acredita en esta tarea su ciclo de cancelacion por HTTP.
A participa en 3 operaciones; B en 4; C en ninguna. El docente consulta las cuatro desde la ruta de supervision. ADM, que solo tiene rol admin, no hereda acceso docente. Hay otra cuenta pendiente para comprobar el rechazo por estado.
Los ID se obtienen de los INSERT; no se supone que existan en otra base. La semilla se conserva como codigo dentro de prueba.mjs.

## Cambios
- sql/migraciones/014_avisos_leidos.sql: fecha leido_en en aviso e indices para historial y avisos. No altera operaciones ni eventos.
- src/historial.mjs: GET /api/mi-espacio/historial (solo las relaciones del usuario de sesion), GET /api/gestion/historial (solo docente), POST /api/avisos/:id/leido (solo destinatario activo con CSRF).
- src/app.mjs: montaje del router nuevo. Se conserva GET /api/mi-espacio para los anuncios existentes; no se cambia su contrato.
- src/cesiones.mjs: avisos ordenados por creado_en DESC,id DESC.
- public/html/mi-espacio.html y public/mjs/historial.mjs: operaciones, solicitudes y avisos en Mi espacio, filtro de modalidad, paginas, fechas, autores de eventos y siguiente accion.

## Consultas propias y seguridad
La consulta usa EXISTS sobre operacion_item con origen_usuario_id o destino_usuario_id igual al usuario de sesion. No acepta usuarioId del cliente. No filtra por el curso actual ni por categoria activa. Los items y eventos se agrupan con subconsultas para devolver una fila por operacion, incluidos intercambios de dos unidades.
Orden estable de operaciones y solicitudes: creada_en DESC,id DESC; eventos: creada_en,id; avisos: creado_en DESC,id DESC. Pagina desde 1, limite hasta 20 y filtros permitidos tipo/estado. El filtro tipo/estado solo afecta a operaciones; solicitudes y avisos conservan su propia paginacion. No se reescribe ningun evento historico.
La ruta propia exige rol alumno o docente activo; la docente exige ademas docente. La consulta devuelve solo operaciones relacionadas y sus eventos, sin hashes, correos, contraseñas ni sesiones.

## Aviso leido sin efecto lateral
POST /api/avisos/:id/leido recibe {}. Revalida estado y version de sesion bajo bloqueo compartido de usuario y ejecuta UPDATE aviso SET leido_en=COALESCE(leido_en,now()) WHERE id=$1 AND destinatario_id=$2. No escribe en operacion, operacion_item, evento_operacion, reserva_activa ni solicitud.
Dos peticiones simultaneas sobre el aviso propio devuelven 200 y la misma primera fecha. Otra cuenta recibe 404 AVISO_NO_DISPONIBLE; una peticion sin CSRF devuelve 403. El estado SQL de las tablas de operacion es identico antes y despues.
Repetir la entrega de una cesion completada devuelve su estado existente sin otro aviso ni evento.

## Control SQL y resultados
control.sql agrupa count(*) de operacion con EXISTS por participante. No cuenta eventos ni items como operaciones. Se ejecuta con pg usando el ID ficticio como parametro $1 y se compara con el numero de operaciones devueltas por la API.

Resultados reales:
1. Historia: 2 cesiones completadas + 1 prestamo prestada + 1 intercambio cancelado.
2. A=3, B=4, C=0 operaciones; docente=4. Admin sin docente y alumno en ruta docente: 403. Anonimo: 401. Pendiente: 403. usuarioId enviado como filtro: 422.
3. Aviso propio: 200 en dos peticiones concurrentes, fecha estable; ajeno: 404; sin CSRF: 403. Operaciones, reservas, eventos, items y solicitudes intactos.
4. Entrega repetida: 200, ninguna escritura adicional en eventos o avisos.
5. Cambio controlado de curso de B a curso 2 y desactivacion de categoria: historial identico, mismos actores, fechas, ID y eventos; la cuenta refleja curso 2. Estos cambios de escenario se hicieron por SQL de prueba, no mediante una nueva pantalla administrativa.
6. Paginas de dos operaciones: 4 ID distintos al reunir ambas; filtro prestamo devuelve una y al quitarlo reaparecen cuatro; filtros y limites invalidos dan 422.
7. Edge automatizado: filtro y restauracion en Mi espacio, marcar aviso sin alterar tablas de operacion y vista de 390 px sin desbordamiento horizontal.

Primera ejecucion conjunta con regresion: 18 aprobados, 0 fallos (15 casos y 3 contenedores de node:test). Ultima repeticion del ejercicio tras mejorar etiquetas de autores: 8 aprobados, 0 fallos (7 casos y un contenedor). resultados.json conserva fecha, entorno, SQL y resultados; evidencias/ conserva capturas.

## Reproduccion
Desde la raiz Aula-Circular, con Node 24, dependencias y .env propio para PostgreSQL local:

```powershell
node --env-file=.env --test --test-concurrency=1 tarea/historial-avisos/prueba.mjs tests/cesiones.test.mjs tests/diagnosticoServidor.test.mjs
```

La cuenta necesita permiso para crear esquemas. Se aplica toda la migracion en un esquema aula_test_... aislado, se crean datos ficticios, se arranca HTTP en puerto libre y se elimina solo el esquema temporal al terminar. No se migra la base de trabajo ni se cambian sus credenciales.
Sin navegador el ejercicio informa 7 resultados (6 casos y contenedor). Para incluir navegador, definir PRUEBA_NAVEGADOR=1 y PLAYWRIGHT_MODULE con la ruta del modulo Playwright instalado; requiere Edge. La ejecucion registrada uso Playwright del runtime de Codex.
Para usarlo manualmente en la base de trabajo hay que aplicar antes las migraciones pendientes, incluida 014, segun la guia del proyecto. Revisar el entorno y las migraciones antes de ejecutarlas. Despues, npm.cmd start y /html/mi-espacio.html con una cuenta propia. Los datos temporales y sus ID no persisten tras la prueba.

## Mi explicacion y ayuda
La relacion guardada entre usuario y operacion determina lo que puedo consultar; mi curso actual y la categoria activa no deben borrar hechos anteriores. La lectura del aviso es una accion independiente: comunica que he visto el mensaje, pero no devuelve material ni cancela una reserva. El SQL de control cuenta operaciones por ID para no multiplicar intercambios o eventos.
He contado con Codex para implementar los cambios, preparar los datos, ejecutar las pruebas automaticas y redactar la evidencia. Se reutiliza el codigo de cuentas, cesiones y prestamos del equipo. Recursos: Datos y estados, API y permisos, Libros cesiones e intercambios y Pruebas y evidencias suministrados con la tarea.
No dispongo de compañero para una revision humana independiente; queda pendiente para el tutor. No se atribuye una ejecucion manual no realizada. Al ser el plan de 370 horas, no se implementan informes agregados exclusivos de 500. El SQL de control se usa para contrastar el historial.
El PDF de hasta 3 paginas esta en output/pdf/Historial-avisos.pdf. No se ha subido a FCTconecta.
