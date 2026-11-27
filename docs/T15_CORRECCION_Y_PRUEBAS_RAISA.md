# T15 — Explicar una corrección y sus pruebas

**Proyecto:** Aula Circular

**Área:** Biblioteca y Documentación

**Responsable:** Raisa Julia Ochoa Domínguez

**Fecha:** 27/11/2026

**Rama de trabajo:** `biblioteca-documentos`

## 1. Objetivo

El objetivo de esta tarea es identificar una corrección concreta realizada durante el desarrollo de Aula Circular, reproducir el comportamiento anterior y posterior a dicha corrección y comprobar, mediante una variación del caso inicial, que la solución no depende únicamente de un ejemplo determinado.

Se ha seleccionado la corrección del valor predeterminado de vigencia de las versiones documentales, realizada durante la T8.

## 2. Identificación del cambio

- Commit original: `9f0d17c40563882c5089ebe6b5ac07f19cc0566e`.
- Descripción: gestión de versiones y descargas autorizadas.
- Fecha del commit: 05/11/2026.
- Autor del commit: `rjodomin22`.
- Versión de referencia actual: `c16e181`.
- Archivo original: `sql/migraciones/005_documentos.sql`.
- Restricción de coherencia: `sql/migraciones/010_versiones_documentos.sql`.
- Corrección: `sql/migraciones/011_vigencia_predeterminada_documentos.sql`.

## 3. Regla funcional

Toda nueva versión documental debe comenzar como borrador y no adquirir la condición de vigente hasta que se publique expresamente.

Las combinaciones válidas son:

| Estado documental | estado_version | actual |
|---|---|---|
| Borrador | borrador | false |
| Vigente | vigente | true |
| Histórica | historica | false |

Además, un documento no puede disponer de más de una versión vigente simultáneamente.

## 4. Causa del problema

La migración 005 establecía el valor predeterminado de la columna actual como true.

Posteriormente, la migración 010 incorporó el campo estado_version, cuyo valor predeterminado era borrador, junto con una restricción que obligaba a mantener la coherencia entre ambos campos.

La utilización simultánea de ambos valores predeterminados generaba una combinación incompatible: una versión en borrador marcada como actual.

Como consecuencia, PostgreSQL rechazaba las inserciones que no especificaban expresamente estos campos.

Las migraciones 010 y 011 pertenecen al mismo commit, por lo que el comportamiento anterior se reproduce mediante una reconstrucción controlada del estado intermedio entre ambas migraciones. No se afirma que el defecto llegara a una versión publicada de la aplicación.

## 5. Corrección aplicada

La migración 011 modifica el valor predeterminado de la columna actual a false.

De esta forma, las nuevas versiones comienzan como borrador y no vigente cuando se omiten ambos campos durante una inserción.

La solución mantiene la restricción de coherencia y complementa las validaciones del servidor, que establece explícitamente los valores false y borrador al crear versiones documentales.

## 6. Entorno de reproducción

Se ha desarrollado una prueba automatizada mediante Node.js y PostgreSQL:

`tests/correccionVigencia.test.mjs`

La prueba crea un esquema temporal independiente, aplica las migraciones hasta la 010, reproduce el problema, aplica la migración 011 y repite la operación.

Esquema temporal utilizado en la ejecución registrada:

`aula_t15_d091d9c88982670e`

Datos de ensayo:

- Código documental: DOC-T15-001.
- Título: Documento de ensayo T15.
- Archivos ficticios: t15-v1.pdf, t15-v2.pdf y t15-v3.pdf.
- Versiones: 1, 2 y 3.

Los archivos utilizados en la prueba SQL son registros ficticios. La comprobación no requiere generar archivos PDF reales.

El esquema temporal se elimina al finalizar la ejecución, sin reintroducir el defecto en las ramas compartidas.

## 7. Comparación antes y después

### P1. Antes de la corrección

**Entrada:** inserción de la versión 1 sin especificar los campos actual y estado_version.

**Esperado según la regla funcional:** creación de una versión en borrador y no vigente.

**Predicción del defecto:** rechazo de la inserción mediante el código SQLSTATE 23514.

**Resultado observado:**

- actual: true.
- estado_version: borrador.
- Código de error: 23514.
- Restricción: documento_version_vigencia_coherente.
- Número de versiones creadas: 0.

El defecto se reproduce correctamente.

### P2. Después de la corrección

Se aplica la migración 011 y se repite exactamente la misma inserción.

**Esperado:** creación de una versión en borrador con actual igual a false.

**Resultado observado:**

- numero_version: 1.
- estado_version: borrador.
- actual: false.

La inserción se realiza correctamente y respeta la regla funcional.

## 8. Variación del caso inicial

Para comprobar que la corrección no depende de la creación de la primera versión, se modifica el estado inicial del documento.

Se prepara una versión 1 vigente mediante SQL dentro del esquema temporal y se intenta crear una segunda versión sin especificar los campos actual y estado_version.

**Predicción previa:** la versión 1 debe conservar su vigencia y la versión 2 debe crearse como borrador.

**Resultado observado:**

| Versión | Estado | Actual |
|---|---|---|
| 1 | vigente | true |
| 2 | borrador | false |

La variante confirma que la creación de una nueva versión no modifica la versión vigente anterior.

La preparación mediante SQL permite aislar el comportamiento estudiado. La publicación mediante HTTP se verifica en las pruebas complementarias.

## 9. Control negativo

Se intenta insertar una tercera versión indicando expresamente una combinación incoherente: estado_version igual a borrador y actual igual a true.

**Esperado:** rechazo de la inserción mediante el código 23514.

**Observado:** PostgreSQL rechaza la operación mediante la restricción documento_version_vigencia_coherente.

Las versiones anteriores permanecen sin modificaciones.

Esta comprobación demuestra que la corrección no ha eliminado la restricción de integridad.

## 10. Pruebas complementarias

Se han ejecutado las pruebas de T8 y T11 para comprobar el funcionamiento de las versiones documentales desde el servidor.

| Archivo | Pruebas superadas | Fallos |
|---|---:|---:|
| correccionVigencia.test.mjs | 5 | 0 |
| versionesDocumentos.test.mjs | 17 | 0 |
| versiones.test.mjs | 7 | 0 |
| Total | 29 | 0 |

Las pruebas incluyen la creación de borradores, publicación de nuevas versiones, conservación del histórico, descarga autorizada, restricciones según el curso, comprobación de integridad y limpieza de archivos.

Los totales incluyen las pruebas principales y sus subpruebas, según el resumen de Node.js.

## 11. Justificación de la decisión técnica

Se decidió modificar el valor predeterminado de la columna actual porque el problema tenía su origen en la incompatibilidad entre los valores iniciales de la base de datos.

Una alternativa habría sido eliminar la restricción de coherencia. Esta opción se descarta porque permitiría almacenar combinaciones documentales inválidas.

Otra alternativa habría sido confiar exclusivamente en que el servidor especificase siempre ambos campos. Aunque el servidor ya establece dichos valores, esta medida no protege por sí sola las inserciones SQL directas ni futuros scripts que omitan los campos.

La solución seleccionada mantiene la integridad de los datos y complementa las validaciones existentes en el servidor.

## 12. Límites de las pruebas

La prueba principal verifica los valores predeterminados y las restricciones de PostgreSQL en un entorno controlado.

No permite demostrar por sí sola todos los escenarios de concurrencia, los permisos de publicación, la seguridad de las descargas ni la integridad de archivos reales.

Las pruebas complementarias amplían la cobertura mediante peticiones HTTP y archivos PDF de ensayo.

La reproducción histórica corresponde a un estado intermedio entre dos migraciones del mismo commit.

## 13. Instrucciones de reproducción

Desde el directorio raíz del repositorio, con las dependencias instaladas y PostgreSQL de ensayo configurado, ejecutar:

`node --env-file=.env --test --test-concurrency=1 tests/correccionVigencia.test.mjs`

Para ejecutar las pruebas complementarias:

`node --env-file=.env --test --test-concurrency=1 tests/versionesDocumentos.test.mjs tests/versiones.test.mjs`

## 14. Conclusión

La corrección del valor predeterminado de vigencia permite crear nuevas versiones documentales de forma coherente, manteniendo su estado inicial de borrador.

La comparación antes y después, la variante y el control negativo demuestran que la solución corrige el comportamiento estudiado sin eliminar las restricciones de integridad.

Las pruebas complementarias confirman que las funcionalidades documentales comprobadas continúan funcionando correctamente.