-- ============================================================
-- AULA CIRCULAR
-- ÁREA: Biblioteca y Documentos
-- Insertar datos ficticios para comprobar la separación
-- entre las fichas del catálogo y sus ejemplares físicos.
--
-- DATOS DE ENSAYO:
-- 1. Manual de SQL: dos ejemplares físicos.
-- 2. Calculadora científica: un ejemplar físico.
-- 3. Guía de inicio: recurso digital sin ejemplares.
-- 4. Documentación PostgreSQL: enlace sin ejemplares.
--
-- REQUISITOS:
-- Haber aplicado las migraciones 002, 005 y 006.
--
-- IMPORTANTE:
-- Este archivo está pensado para ejecutarse una sola vez
-- sobre la base de datos de ensayo.
-- ============================================================
BEGIN;
-- ------------------------------------------------------------
-- 1. CREACIÓN DE CATEGORÍAS
--
-- Las categorías permiten clasificar los materiales
-- dentro de las distintas secciones de Aula Circular.
-- ------------------------------------------------------------

INSERT INTO categoria (nombre, ambito)
VALUES
    ('Material de estudio', 'biblioteca'),
    ('Documentos del centro', 'documentacion'),
    ('Enlaces educativos', 'documentacion');


-- ------------------------------------------------------------
-- 2. CREACIÓN DE RECURSOS
--
-- Cada fila representa una ficha general del catálogo.
--
-- El número de ejemplares físicos no se almacena
-- duplicando la ficha del recurso.
--
-- Los recursos digitales y los enlaces no tienen
-- ejemplares físicos asociados.
-- ------------------------------------------------------------

INSERT INTO recurso (
    titulo,
    descripcion,
    tipo,
    origen,
    categoria_id,
    estado_editorial,
    url
)
VALUES

-- Recurso físico: manual que tendrá dos ejemplares.
(
    'Manual de SQL',
    'Manual ficticio para practicar consultas y bases de datos.',
    'fisico',
    'centro',
    (
        SELECT id
        FROM categoria
        WHERE nombre = 'Material de estudio'
    ),
    'publicado',
    NULL
),

-- Recurso físico: calculadora con un ejemplar.
(
    'Calculadora científica',
    'Calculadora para actividades académicas.',
    'fisico',
    'centro',
    (
        SELECT id
        FROM categoria
        WHERE nombre = 'Material de estudio'
    ),
    'publicado',
    NULL
),

-- Recurso digital: documento sin ejemplares físicos.
(
    'Guía de inicio del curso',
    'Documento digital de orientación para el alumnado.',
    'digital',
    'centro',
    (
        SELECT id
        FROM categoria
        WHERE nombre = 'Documentos del centro'
    ),
    'publicado',
    NULL
),

-- Recurso de tipo enlace: dirección HTTPS.
(
    'Documentación oficial de PostgreSQL',
    'Enlace externo a la documentación de PostgreSQL.',
    'enlace',
    'externo',
    (
        SELECT id
        FROM categoria
        WHERE nombre = 'Enlaces educativos'
    ),
    'publicado',
    'https://www.postgresql.org/docs/'
);


-- ------------------------------------------------------------
-- 3. ASOCIACIÓN DE RECURSOS CON CURSOS
--
-- La tabla recurso_curso permite relacionar un mismo
-- material con uno o varios cursos.
--
-- Estas asociaciones servirán posteriormente para
-- implementar los filtros de la API.
-- ------------------------------------------------------------

INSERT INTO recurso_curso (recurso_id, curso_id)
SELECT r.id, c.id
FROM recurso AS r
CROSS JOIN curso AS c
WHERE
    (r.titulo = 'Manual de SQL'
        AND c.codigo IN ('DAW-1', 'DAW-2'))
    OR
    (r.titulo = 'Calculadora científica'
        AND c.codigo = 'DAW-1')
    OR
    (r.titulo = 'Guía de inicio del curso'
        AND c.codigo = 'DAW-1')
    OR
    (r.titulo = 'Documentación oficial de PostgreSQL'
        AND c.codigo = 'DAW-2');


-- ------------------------------------------------------------
-- 4. CREACIÓN DE EJEMPLARES FÍSICOS
--
-- Cada ejemplar tiene un código único y pertenece a
-- una ficha de recurso mediante recurso_id.
--
-- Un mismo manual tendrá dos unidades diferentes:
--   MAN-001
--   MAN-002
--
-- La calculadora tendrá una unidad:
--   CAL-001
--
-- No insertamos ejemplares para recursos digitales
-- ni enlaces, porque no se prestan como objetos físicos.
-- ------------------------------------------------------------

INSERT INTO ejemplar (
    recurso_id,
    codigo,
    propietario_usuario_id,
    conservacion,
    estado_servicio
)
VALUES

-- Primer ejemplar del Manual de SQL.
(
    (
        SELECT id
        FROM recurso
        WHERE titulo = 'Manual de SQL'
    ),
    'MAN-001',
    NULL,
    'bueno',
    'disponible'
),

-- Segundo ejemplar del mismo Manual de SQL.
(
    (
        SELECT id
        FROM recurso
        WHERE titulo = 'Manual de SQL'
    ),
    'MAN-002',
    NULL,
    'regular',
    'disponible'
),

-- Ejemplar físico de la calculadora científica.
(
    (
        SELECT id
        FROM recurso
        WHERE titulo = 'Calculadora científica'
    ),
    'CAL-001',
    NULL,
    'nuevo',
    'disponible'
);


-- ------------------------------------------------------------
-- 5. CONFIRMACIÓN DE LA TRANSACCIÓN
--
-- Si todas las inserciones son correctas, PostgreSQL
-- guarda los datos de prueba.
-- ------------------------------------------------------------

COMMIT;
