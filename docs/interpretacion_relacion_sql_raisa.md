# Interpretar una relación y una consulta SQL

**Proyecto:** Aula Circular  
**Departamento:** Biblioteca y Documentos  
**Autora:** Raisa Ochoa  
**Versión:** 1.0 
**Rama:** `biblioteca-documentos`  
**Base de datos:** `aula_circular_sprint2_ensayo`  
**Entorno:** PostgreSQL 17.11

## 1. Relación entre recurso y ejemplar

Se han localizado y comprobado las tablas `recurso` y `ejemplar` en PostgreSQL.

La tabla `recurso` representa la ficha general de un material del catálogo y utiliza `id` como clave primaria (PK).

La tabla `ejemplar` representa cada unidad física concreta. Su clave primaria es `id`, mientras que `recurso_id` es una clave foránea (FK) que referencia `recurso.id`.

Se establece una relación **1:N**, porque un recurso puede tener varios ejemplares, pero cada ejemplar pertenece a un único recurso.

**Ejemplo comprobado:**

- Recurso: `1` — Manual de SQL.
- Ejemplar: `1` — MAN-001, conservación buena.
- Ejemplar: `2` — MAN-002, conservación regular.

Ambos ejemplares pertenecen a la misma ficha del catálogo y están identificados individualmente.

## 2. Consulta SQL mediante JOIN

**Objetivo:** Obtener el título, identificador y código de cada ejemplar físico.

**Entrada:** Datos ficticios existentes en las tablas `recurso` y `ejemplar`.

**Consulta:**

```sql
SELECT
    r.titulo,
    e.id AS ejemplar_id,
    e.codigo
FROM recurso AS r
JOIN ejemplar AS e
    ON e.recurso_id = r.id
ORDER BY r.titulo, e.codigo;
```

**Resultado esperado:** 3 filas.

**Resultado observado:**

| Título | Ejemplar ID | Código |
|---|---|---|
| Calculadora científica | 3 | CAL-001 |
| Manual de SQL | 1 | MAN-001 |
| Manual de SQL | 2 | MAN-002 |

**Resultado:** Correcto. El JOIN devuelve los tres ejemplares previstos, relacionando cada unidad física con el título de su recurso.

## 3. Variación de la consulta

**Objetivo:** Filtrar únicamente los ejemplares asociados al recurso Manual de SQL.

**Modificación:** Se incorpora la condición `WHERE r.titulo = 'Manual de SQL'`.

**Consulta:**

```sql
SELECT
    r.titulo,
    e.id AS ejemplar_id,
    e.codigo
FROM recurso AS r
JOIN ejemplar AS e
    ON e.recurso_id = r.id
WHERE r.titulo = 'Manual de SQL'
ORDER BY e.codigo;
```

**Resultado esperado:** 2 filas.

**Resultado observado:**

| Título | Ejemplar ID | Código |
|---|---|---|
| Manual de SQL | 1 | MAN-001 |
| Manual de SQL | 2 | MAN-002 |

**Resultado:** Correcto. La consulta original devuelve tres filas y la variación devuelve dos.

La repetición del título no constituye una duplicación incorrecta. Existe una única ficha del recurso y dos ejemplares físicos independientes relacionados mediante la clave foránea `recurso_id`.

## 4. Interpretación de la disponibilidad

Según el modelo de referencia de *Datos y estados*, la disponibilidad requiere comprobar que el recurso esté publicado, que el ejemplar sea apto para su circulación y que no exista una reserva activa asociada.

La tabla `reserva_activa` relaciona un ejemplar ocupado con una operación. Su clave primaria sobre `ejemplar_id` impide registrar dos reservas activas simultáneas para una misma unidad.

La condición `ra.ejemplar_id IS NULL` aplicada después de un `LEFT JOIN` permite seleccionar ejemplares sin reserva activa.

Una operación histórica cerrada no impide un nuevo préstamo si la reserva se ha liberado y el ejemplar sigue siendo apto.

**Comprobación realizada:** Se consultó la existencia de las tablas `reserva_activa`, `operacion` y `operacion_item`, obteniendo cero filas.

Posteriormente se comprobó que los ejemplares CAL-001, MAN-001 y MAN-002 tienen registrado `estado_servicio = 'disponible'`.

**Limitación:** Las tablas de operaciones y reservas todavía no están implementadas en la base local. Por tanto, la lógica de reserva activa se documenta como interpretación del modelo, no como ejecución funcional. El estado registrado por sí solo no demuestra la ausencia de una reserva activa.

## 5. Resultados y aportación

| Prueba | Esperado | Observado |
|---|---|---|
| JOIN general | 3 filas | 3 filas |
| JOIN filtrado | 2 filas | 2 filas |
| Tablas de reservas | 0 filas | 0 filas |
| Consulta de estados | 3 filas | 3 filas |

Las cuatro consultas del archivo `sql/009_interpretacion_relacion_ejemplares.sql` se ejecutaron correctamente en PostgreSQL 17.11.

**Aportación personal:** Identificación de las claves primarias y foráneas, interpretación de la relación 1:N, ejecución de consultas SQL, introducción y comprobación del filtro e interpretación de la disponibilidad y sus limitaciones.

**Archivos relacionados:**

- `sql/005_catalogo_biblioteca.sql`
- `sql/007_datos_biblioteca.sql`
- `sql/009_interpretacion_relacion_ejemplares.sql`

**Revisión:** Pendiente de revisión por otro integrante del equipo.

**Conclusión:** Las consultas y la variación funcionan según lo esperado. Se confirma la separación entre ficha del catálogo y unidades físicas. La comprobación funcional de reservas queda pendiente de su implementación.