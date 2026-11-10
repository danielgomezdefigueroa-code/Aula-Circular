
-- T11 - Datos representativos del catalogo
-- Script repetible: no duplica los registros existentes.
-- No modifica prestamos, reservas ni documentos publicados.

BEGIN;

-- Completar hasta dos ejemplares de calculadora.
WITH calculadora AS (
    SELECT id
    FROM recurso
    WHERE origen = 'centro'
      AND tipo = 'fisico'
      AND titulo LIKE 'Calculadora cient%'
    ORDER BY id
    LIMIT 1
),
candidatos AS (
    SELECT
        c.id AS recurso_id,
        cod.codigo,
        ROW_NUMBER() OVER (ORDER BY cod.codigo) AS orden
    FROM calculadora c
    CROSS JOIN (
        VALUES ('CAL-T11-001'), ('CAL-T11-002')
    ) AS cod(codigo)
    WHERE NOT EXISTS (
        SELECT 1
        FROM ejemplar e
        WHERE e.codigo = cod.codigo
    )
)
INSERT INTO ejemplar (
    recurso_id, codigo, propietario_usuario_id,
    conservacion, estado_servicio
)
SELECT
    recurso_id, codigo, NULL,
    'Buen estado. Ejemplar de pruebas T11',
    'habilitado'
FROM candidatos c
WHERE orden <= GREATEST(
    0,
    2 - (
        SELECT COUNT(*)
        FROM ejemplar e
        WHERE e.recurso_id = c.recurso_id
    )
);

-- Manual digital de consulta.
INSERT INTO recurso (
    origen, tipo, titulo, descripcion,
    curso_id, asignatura, edicion
)
SELECT
    'centro',
    'digital',
    'Manual digital de SQL (T11)',
    'Material digital de consulta para primero de DAW.',
    c.id,
    'Bases de datos',
    'Edicion T11'
FROM curso c
WHERE c.codigo = 'DAW1'
AND NOT EXISTS (
    SELECT 1 FROM recurso
    WHERE titulo = 'Manual digital de SQL (T11)'
      AND origen = 'centro'
);

-- Enlace educativo.
INSERT INTO recurso (
    origen, tipo, titulo, descripcion,
    curso_id, asignatura, edicion
)
SELECT
    'centro',
    'enlace',
    'Referencia JavaScript MDN (T11)',
    'https://developer.mozilla.org/es/docs/Web/JavaScript',
    c.id,
    'Desarrollo web',
    'Recurso web T11'
FROM curso c
WHERE c.codigo = 'DAW1'
AND NOT EXISTS (
    SELECT 1 FROM recurso
    WHERE titulo = 'Referencia JavaScript MDN (T11)'
      AND origen = 'centro'
);

COMMIT;
