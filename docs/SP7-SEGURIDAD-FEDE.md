\# SP7: seguridad de objetos y consultas



\## Versión y autoría



Base: main integrado, commit 98f856d.

Rama: practica/sprint7-seguridad-fede.

Autor de esta ampliación de pruebas: Fede, con ayuda de IA.

No modifica código de producción.



\## Aislamiento



Base local: aula\_circular\_sprint7\_ensayo.

Los tests preparan cuentas ficticias en esquemas temporales.

No compartir .env, cookies, tokens ni contraseñas.



\## Casos específicos



Archivo: tests/seguridad-objetos.test.mjs.



\- Escritura sin CSRF: 403.

\- Datos mal formados o propietario enviado: 422.

\- Edición de anuncio ajeno: 404.

\- Marcar aviso ajeno: 404.

\- Tras cada rechazo se comparan las tablas de negocio.

\- Alta, edición y lectura de aviso propias siguen permitidas.

\- Comillas y texto SQL se buscan como valores literales.

\- Se comprueban campos internos prohibidos en las respuestas.



Resultado observado: cuatro casos y su prueba principal;

cinco pruebas contabilizadas, cero fallos.



\## Regresión ejecutada



&#x20;   node --env-file=.env --test --test-concurrency=1 tests/seguridad-objetos.test.mjs tests/documentos.test.mjs tests/prestamos.test.mjs



Resultado observado: 24 pruebas, cero fallos.



Incluye descarga autorizada, rechazo desde otro curso,

solicitud y adjudicación de préstamo permitidas.



\## Límites



No acredita la ampliación administrativa de Daniel:

sus cambios locales no están incluidos en esta rama.



No acredita reproducción por otra pareja.

Las pruebas HTTP automatizadas no son pruebas manuales

de navegador ni de producción con HTTPS.

