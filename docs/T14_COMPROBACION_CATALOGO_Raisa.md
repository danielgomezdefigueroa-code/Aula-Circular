# T14 — Ampliar el catálogo y comprobar duplicados

**Proyecto:** Aula Circular · Biblioteca y Documentos  
**Responsable:** Raisa Julia Ochoa Domínguez  
**Rama:** `biblioteca-documentos`  
**Versión inicial comprobada:** `eeb88a0` (T13, antes de introducir T14)  
**Versión final T14 (commit):** pendiente de completar tras el commit  
**Fecha de comprobación de la autora:** 17/11/2026  
**Pareja revisora / persona revisora:** pendiente  
**Fecha y resultado de la revisión externa:** pendiente  

## 1. Objetivo y criterio de identificación

Comprobar que el catálogo permite distintas unidades físicas de un mismo recurso y distintas ediciones de un manual, sin confundir ejemplar con recurso ni basar la unicidad exclusivamente en título o ISBN.

- `recurso.id` identifica la ficha del material y conserva su edición y categoría.
- `ejemplar.id` identifica cada unidad física y `ejemplar.codigo` debe ser único, también al ignorar mayúsculas y espacios exteriores.
- Dos ediciones del mismo título pueden tener distintos `recurso.id` y sus propios ejemplares.
- Los recursos digitales y los enlaces no pueden tener ejemplares físicos.
- Las categorías desactivadas conservan sus referencias históricas, pero no admiten altas nuevas.

## 2. Entradas de prueba de la base de integración

| Caso | Entrada o dato | Esperado | Observado por la autora |
| --- | --- | --- | --- |
| Calculadora existente | Recurso `#2`, edición `2026` | Mantener los ejemplares previos | Conservados: `EJ-01`, `CAL-T11-002` |
| Dos unidades adicionales | `T14-CAL-001`, `T14-CAL-002` | Añadir dos ejemplares distintos | Añadidos; calculadora con **4 ejemplares** |
| Manual original | `Manual de SQL`, recurso `#4`, edición `2026` | Conservar edición | Conservada, ejemplar `EJ-03` |
| Manual revisado | `Manual de SQL`, recurso `#16`, edición `2027` | Ficha nueva, sin sustituir 2026 | Añadida, ejemplar `T14-SQL-2027-01` |
| Segunda ejecución de la semilla | Repetir `sql/datos_t14.sql` | Ningún duplicado nuevo | **16 recursos**, **16 categorizados**, **3 ejemplares `T14-%`**; sin cambio tras repetir |
| Código repetido desde el formulario | Recurso `#2`; código `T14-CAL-001` | Rechazo y aviso junto al campo; sin alta | Mensaje visible «Ya existe un ejemplar con ese código»; prueba HTTP 409 superada |

Los conteos absolutos de 16 y 3 corresponden a la base local de integración de la autora **antes de nuevos cambios de inventario**. En una semilla nueva o en otra base deben compararse los **deltas**, no exigir estos números absolutos.

## 3. Pruebas automatizadas en un esquema limpio

**Requisitos:** PostgreSQL local configurado en `.env`, Node.js y dependencias instaladas con `npm install`. La cuenta usada debe poder crear y eliminar esquemas de prueba. No utilizar una base de producción.

Desde la raíz del repositorio:

```bash
node --env-file=.env --test --test-concurrency=1 tests/duplicadosCatalogo.test.mjs
```

La prueba crea un esquema temporal con nombre `aula_t14_...`, aplica las migraciones, crea usuarios ficticios y lo elimina al terminar. No precisa ejecutar la semilla T14 en la base de integración.

| Caso automatizado | Esperado | Observado por la autora (17/11/2026) | Revisor |
| --- | --- | --- | --- |
| 1. Alta válida | HTTP 201; recurso y primer ejemplar | Superado | Pendiente |
| 2. Código repetido en nueva ficha | HTTP 409; mismo número de recursos y ninguna ficha huérfana | Superado | Pendiente |
| 3. Segundo ejemplar / variante del código | Segundo HTTP 201; variante en minúsculas HTTP 409; quedan dos | Superado | Pendiente |
| 4. Dos ediciones con el mismo título | Dos fichas diferentes, ediciones 2026 y 2027 | Superado | Pendiente |
| 5. Digital y tipo no permitido | Digital sin ejemplar; altas inválidas HTTP 422 | Superado | Pendiente |
| 6. Modificaciones | Cambio válido HTTP 200; cambio incompatible HTTP 422; código repetido HTTP 409 | Superado | Pendiente |
| 7. Permisos | Alumno no puede gestionar inventario: HTTP 403 | Superado | Pendiente |
| 8. Independencia al reservar | Una unidad reservada, segunda disponible | Superado | Pendiente |
| 9. Categoría inactiva | Alta nueva HTTP 422; categoría y ficha históricas consultables | Superado | Pendiente |
| 10. Curso inactivo | Alta rechazada HTTP 422 | Superado | Pendiente |

**Resultado observado:** suite T14 con **11 pruebas superadas y 0 fallos** (10 subpruebas y la prueba contenedora).

Comprobación de regresión:

```bash
npm test
node --env-file=.env --test --test-concurrency=1 tests/disponibilidad.test.mjs
git diff --check
```

**Resultado observado de la autora:** `npm test` **40/40**, T14 **11/11**; la prueba de disponibilidad T11 se había ejecutado previamente con **7/7**. Volver a ejecutarla tras cualquier cambio posterior al cierre.

## 4. Semilla repetible y comparación con el catálogo visible

En una **base local de ensayo independiente, migrada y con los datos iniciales del laboratorio**, ejecutar:

```bash
psql -h 127.0.0.1 -U aula_app -d NOMBRE_BASE_ENSAYO -X -v ON_ERROR_STOP=1 -f sql/datos_t14.sql
```

**Importante:** el script requiere que existan previamente una calculadora científica de 2026 y un Manual de SQL de 2026 en DAW1. La base de la autora ya los tenía. Si se parte de una base totalmente vacía, preparar primero las migraciones y los datos iniciales según la guía del repositorio; no ejecutar este paso sobre producción.

Consultar antes y después de repetir el archivo:

```sql
SELECT COUNT(*) AS recursos_totales,
       COUNT(categoria_id) AS recursos_con_categoria
FROM recurso;

SELECT COUNT(*) AS ejemplares_t14
FROM ejemplar
WHERE codigo LIKE 'T14-%';

SELECT r.id, r.titulo, r.edicion, e.id AS ejemplar_id,
       e.codigo, e.estado_servicio
FROM recurso r
JOIN ejemplar e ON e.recurso_id = r.id
WHERE r.origen = 'centro'
  AND (r.titulo ILIKE 'Calculadora cient%'
       OR r.titulo = 'Manual de SQL')
ORDER BY r.id, e.codigo;
```

**Criterio de aceptación:** los conteos y códigos permanecen idénticos tras ejecutar la semilla por segunda vez; se conservan las ediciones; no se repite ningún código. Si ya existen estos datos, la primera ejecución tampoco debe añadir copias duplicadas.

En la página `http://127.0.0.1:3100/html/biblioteca.html`, con sesión activa:

1. Buscar «Calculadora científica» y desplegar los ejemplares: comprobar cuatro códigos en la base de integración de la autora.
2. Buscar «Manual de SQL»: comprobar **una tarjeta de material**, que agrupa las ediciones **2026 y 2027** y permite ver el ejemplar de cada edición. La agrupación es solo visual: las dos fichas siguen existiendo por separado en la base de datos.
3. En sesión docente, intentar añadir otra vez `T14-CAL-001` al recurso `#2`: verificar el aviso debajo del campo y que el contador no aumente.
4. En sesión de alumno, comprobar que la gestión docente no esté disponible.

Las pruebas de desactivación de categoría y de reserva de un ejemplar se realizan preferentemente en el esquema temporal de `duplicadosCatalogo.test.mjs` para no modificar el inventario compartido de integración.

## 5. Evidencias que debe adjuntar la persona revisora

- Salida de `tests/duplicadosCatalogo.test.mjs` y de la regresión general.
- Consulta SQL de los cuatro ejemplares de la calculadora y los dos recursos «Manual de SQL».
- Captura del catálogo mostrando una sola tarjeta «Manual de SQL» con ambas ediciones desplegadas.
- Captura del formulario con código duplicado y mensaje de error junto al campo.
- Dos ejecuciones de la semilla con conteos idénticos.
- Fecha, versión/commit, base o esquema de ensayo (sin contraseñas) y nombre de quien revisa.

## 6. Itinerario de 500 horas — Importación CSV (solo si corresponde)

**No se declara realizado ni validado en este documento.** Si se cursa el itinerario de 500 h, añadir la implementación y evidencia de vista previa sin escritura previa, selección explícita de filas, confirmación transaccional, límites de 100 filas/1 MiB, duplicados e inválidas, repetición por código externo único y exportación segura de errores para que no se ejecuten fórmulas al abrir el CSV.

## 7. Acta de revisión externa

**Revisor/a:** ______________________________  
**Fecha:** ______________________________  
**Commit o versión examinada:** ______________________________  
**Base/esquema de ensayo:** ______________________________  
**Pruebas T14:** ______ superadas / ______ fallidas  
**Comparación entre BD y catálogo visible:** conforme / no conforme  
**Incidencias y observaciones:** ______________________________  
**Decisión:** aprobado / requiere correcciones  

> No marcar la revisión como realizada hasta que otra pareja ejecute los casos y confirme sus resultados.
