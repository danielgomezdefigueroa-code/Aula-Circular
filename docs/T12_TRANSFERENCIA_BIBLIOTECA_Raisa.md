# T12 — Reconstrucción y transferencia del módulo Biblioteca
**Responsable:** Raisa Julia Ochoa Domínguez
**Modalidad:** Reconstrucción individual con simulación de transferencia técnica.

## 1. Objetivo y recorrido seleccionado

El objetivo de esta tarea es reconstruir una funcionalidad de Aula Circular siguiendo la documentación y el código existente, como si hubiese sido desarrollada por otra pareja.

He seleccionado la consulta de Biblioteca, porque permite seguir un dato desde la interfaz hasta PostgreSQL y comprobar tanto su representación como los permisos de acceso.

Se utilizan tres recursos ficticios:

- Calculadora científica, recurso físico de DAW1, ID 2.
- Manual digital de SQL (T11), recurso digital de DAW1, ID 14.
- Referencia JavaScript MDN (T11), recurso de tipo enlace de DAW1, ID 15.

## 2. Revisión de la documentación original

Al revisar el README y `docs/GUIA-LABORATORIO.md`, he identificado referencias a una estructura anterior del proyecto.

En concreto, la guía menciona `src/aplicacion.mjs` como archivo responsable de sesiones y rutas, aunque la implementación actual concentra el arranque y el registro de las rutas en `src/app.mjs`.

La duda planteada durante la reconstrucción fue cómo identificar el archivo correcto y localizar la consulta que recupera los recursos de Biblioteca.

Tras revisar el código, he identificado este recorrido:

1. `public/html/biblioteca.html`: página de entrada.
2. `public/mjs/biblioteca.mjs`: inicialización de Biblioteca.
3. `public/mjs/area-catalogo.mjs`: petición HTTP, filtros y representación.
4. `public/mjs/shell.mjs`: gestión de sesión y peticiones a la API.
5. `src/app.mjs`: comprobación de sesión y registro de rutas.
6. `src/catalogo.mjs`: validación de permisos y consulta SQL.
7. PostgreSQL: tablas `recurso`, `curso`, `ejemplar` y `reserva_activa`.

## 3. Instrucción corregida para reproducir el recorrido

**Requisitos:** Node.js 24, PostgreSQL, dependencias instaladas, archivo `.env` configurado y una cuenta de alumno o docente activa.

La base utilizada en esta reconstrucción es `aula_circular_integracion`. No es necesario volver a crearla ni cargar datos si ya está preparada.

**Paso 1.** Situarse en la rama `biblioteca-documentos` y comprobar su estado mediante `git status --short`.

**Paso 2.** Iniciar la aplicación:

`npm run dev`

Comprobar que se utiliza el puerto configurado en `.env`, en este entorno `3000`, y que `APP_ORIGIN` coincide con la dirección del servidor.

**Paso 3.** Acceder a:

`http://127.0.0.1:3000/html/login.html`

Iniciar sesión con una cuenta de prueba activa.

**Paso 4.** Abrir:

`http://127.0.0.1:3000/html/biblioteca.html`

Buscar el recurso «Calculadora científica» y comprobar que se identifica como material físico.

**Paso 5.** Buscar «Manual digital de SQL» y comprobar que aparece como material digital de consulta.

**Paso 6.** Seleccionar el filtro de curso DAW1 y comprobar los resultados.

**Paso 7.** Abrir las herramientas del navegador, pestaña Red, y recargar Biblioteca. Localizar la petición `GET /api/biblioteca` y comprobar su respuesta JSON.

**Paso 8.** Sin una sesión autenticada, ejecutar:

`curl -i http://127.0.0.1:3000/api/biblioteca`

El resultado esperado es HTTP 401 con `SIN_SESION`.

Esta secuencia sustituye la dependencia de instrucciones antiguas y permite repetir el recorrido con la estructura vigente del proyecto.

## 4. Entradas, resultados esperados y observados

| Caso | Entrada | Esperado | Observado |
|---|---|---|---|
| 1 | Consulta sin sesión | HTTP 401 | HTTP 401, correcto |
| 2 | Alumno activo en Biblioteca | Catálogo accesible | Correcto |
| 3 | Calculadora, ID 2 | Recurso físico con 2 ejemplares registrados | Confirmado en PostgreSQL y visible en Biblioteca |
| 4 | Manual SQL, ID 14 | Recurso digital sin ejemplares físicos | Confirmado: 0 ejemplares |
| 5 | GET /api/biblioteca | HTTP 200 y JSON | Correcto |
| 6 | Pruebas automáticas | Permisos y disponibilidad correctos | 7 pruebas superadas, 0 fallidas |

La consulta SQL realizada sobre la base de integración ha confirmado la existencia de los recursos y sus cantidades.

También se ha ejecutado:

`node --env-file=.env --test --test-concurrency=1 tests/disponibilidad.test.mjs`

El resultado ha sido de siete pruebas correctas, sin fallos ni pruebas omitidas.

## 5. Variante: recurso de tipo enlace

Para comprobar un recorrido diferente, se ha seleccionado el recurso «Referencia JavaScript MDN (T11)», ID 15, perteneciente a DAW1.

La consulta PostgreSQL confirma que está registrado como recurso de tipo `enlace` y que su dirección es:

`https://developer.mozilla.org/es/docs/Web/JavaScript`

A diferencia de la calculadora, este recurso no necesita ejemplares físicos ni disponibilidad de préstamo.

Su representación en la interfaz utiliza la modalidad «Enlace educativo» y, para direcciones HTTP o HTTPS válidas, ofrece la acción «Abrir enlace».

**Validación visual pendiente de registrar:** búsqueda del recurso en Biblioteca y comprobación de que aparece la acción correspondiente.

El permiso que debe conservarse es el acceso al catálogo únicamente mediante una sesión activa con rol alumno o docente. La ruta de Biblioteca no limita la lectura al curso confirmado del usuario.

## 6. Validación y permisos

La validación principal del catálogo se encuentra en `src/catalogo.mjs`.

Antes de ejecutar la consulta, la API comprueba que existe una sesión, que la cuenta está activa y que tiene un rol autorizado.

La consulta SQL obtiene los recursos de origen `centro`, su curso, modalidad y disponibilidad. Para los recursos físicos, la disponibilidad depende de los ejemplares habilitados que no tienen una reserva activa.

La interfaz también comprueba el estado de la sesión, pero esa comprobación no sustituye la autorización del servidor.

Las pruebas de `tests/disponibilidad.test.mjs` comprueban, entre otras condiciones, que un alumno de otro curso puede consultar Biblioteca, que una solicitud no equivale a una reserva y que una unidad reservada no puede volver a solicitarse.

## 7. Transferencia y revisión

La reconstrucción se ha realizado individualmente, simulando la perspectiva de una persona que recibe el módulo sin conocer previamente su implementación.

La ayuda utilizada ha consistido en la revisión del README, la guía del laboratorio, los archivos de código y las pruebas automatizadas, además del acompañamiento de ChatGPT para organizar las comprobaciones y la documentación.

**Instrucción mejorada:** se ha identificado el archivo de arranque vigente, la ruta de consulta, la base utilizada, los datos de prueba y los permisos que deben mantenerse.

**Siguiente apoyo recomendado:** que otro integrante del equipo ejecute esta guía desde su propia copia y confirme que puede reproducir el recorrido sin instrucciones adicionales.

No se atribuye una reproducción independiente ni una revisión humana a otra persona, puesto que no ha participado en esta comprobación.

## 8. Resultado y conclusión

La reconstrucción ha permitido relacionar la interfaz, la API y PostgreSQL, identificar una instrucción desactualizada y comprobar que la consulta principal funciona con los permisos previstos.

La variante permite verificar que la misma ruta sirve para recursos de naturaleza distinta, manteniendo las restricciones de acceso al catálogo.

La documentación corregida facilita que otra persona pueda localizar los archivos relevantes y repetir las pruebas sin depender de explicaciones orales.