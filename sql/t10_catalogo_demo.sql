
-- ============================================================
-- AULA CIRCULAR - T10
-- CATALOGO DE BIBLIOTECA Y LIBROS DE DEMOSTRACION
-- ============================================================
--
-- Datos ficticios para el entorno de desarrollo.
--
-- Incluye:
--   1. Recursos publicos de demostracion.
--   2. Comprobacion del esquema actual.
--   3. Inventario fisico de Biblioteca.
--   4. Libros y anuncios estudiantiles.
--
-- No inserta documentos ni archivos digitales.
-- La documentacion se publica mediante la API protegida.
--
-- Requisitos:
--   - Migraciones aplicadas.
--   - Base de datos local preparada.
--
-- Los INSERT evitan duplicar los registros de ejemplo.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. DEMO PÚBLICA DE /api/recursos-demo
-- ============================================================

CREATE TABLE IF NOT EXISTS recurso_demo (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo text NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 120),
  tipo text NOT NULL,
  CONSTRAINT recurso_demo_tipo_check
    CHECK (tipo IN ('fisico', 'digital', 'enlace', 'estudiantil'))
);

-- Si la tabla venía de la versión anterior, amplía su restricción.
ALTER TABLE recurso_demo
  DROP CONSTRAINT IF EXISTS recurso_demo_tipo_check;
ALTER TABLE recurso_demo
  ADD CONSTRAINT recurso_demo_tipo_check
  CHECK (tipo IN ('fisico', 'digital', 'enlace', 'estudiantil'));

INSERT INTO recurso_demo (titulo, tipo)
SELECT v.titulo, v.tipo
FROM (VALUES
  ('Calculadora científica de ejemplo', 'fisico'),
  ('Guía de prácticas de ejemplo', 'digital'),
  ('Recurso educativo web de ejemplo', 'enlace'),
  ('Libro aportado por el alumnado', 'estudiantil')
) AS v(titulo, tipo)
WHERE NOT EXISTS (
  SELECT 1 FROM recurso_demo d WHERE d.titulo = v.titulo
);

-- ============================================================
-- 2. COMPROBACIÓN DEL ESQUEMA
-- ============================================================

DO $$
BEGIN
  IF to_regclass('recurso') IS NULL
     OR to_regclass('ejemplar') IS NULL
     OR to_regclass('anuncio') IS NULL
     OR to_regclass('documento') IS NULL
     OR to_regclass('archivo') IS NULL
     OR to_regclass('documento_version') IS NULL THEN
    RAISE EXCEPTION
      'Faltan tablas. Ejecuta primero: npm.cmd run migrar';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('recurso')
      AND attname = 'origen' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('ejemplar')
      AND attname = 'estado_servicio' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('anuncio')
      AND attname = 'estado_revision' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION
      'El esquema no es el actual. No apliques el SQL histórico; usa las migraciones 002-005.';
  END IF;
END $$;

-- ============================================================
-- 3. INVENTARIO FÍSICO DEL CENTRO
-- ============================================================

INSERT INTO recurso
  (origen, tipo, titulo, descripcion, curso_id, asignatura, edicion, isbn)
SELECT
  'centro',
  'fisico',
  d.titulo,
  'Recurso ficticio del centro para el inventario de laboratorio.',
  (SELECT id FROM curso WHERE codigo = d.curso_codigo),
  'General',
  '2026',
  d.isbn
FROM (VALUES
  ('Calculadora científica', 'DAW1', NULL::text),
  ('Kit de electrónica básica', NULL::text, NULL::text),
  ('Manual de SQL', 'DAW1', NULL::text),
  ('Kit de dibujo técnico', 'DAW2', NULL::text),
  ('Introducción a PostgreSQL', 'DAW1', '9780000000011'),
  ('Guía práctica de desarrollo web', 'DAW2', '9780000000028')
) AS d(titulo, curso_codigo, isbn)
WHERE NOT EXISTS (
  SELECT 1 FROM recurso r
  WHERE r.origen = 'centro' AND r.titulo = d.titulo
);

INSERT INTO ejemplar
  (recurso_id, codigo, propietario_usuario_id, conservacion, estado_servicio)
SELECT
  r.id,
  d.codigo_ejemplar,
  NULL::integer,
  d.conservacion,
  'habilitado'
FROM (VALUES
  ('Calculadora científica', 'EJ-01', 'bueno'),
  ('Kit de electrónica básica', 'EJ-02', 'bueno'),
  ('Manual de SQL', 'EJ-03', 'muy bueno'),
  ('Kit de dibujo técnico', 'EJ-04', 'bueno'),
  ('Introducción a PostgreSQL', 'EJ-05', 'muy bueno'),
  ('Introducción a PostgreSQL', 'EJ-06', 'bueno')
) AS d(titulo, codigo_ejemplar, conservacion)
JOIN recurso r
  ON r.origen = 'centro' AND r.titulo = d.titulo
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================
-- 4. LIBROS APORTADOS POR EL ALUMNADO
-- ============================================================

INSERT INTO recurso
  (origen, tipo, titulo, descripcion, curso_id, asignatura, edicion, isbn)
SELECT
  'alumno',
  'fisico',
  d.titulo,
  'Libro ficticio aportado por el alumnado.',
  (SELECT id FROM curso WHERE codigo = d.curso_codigo),
  'General',
  '2026',
  NULL::text
FROM (VALUES
  ('Fundamentos de programación', 'DAW1'),
  ('Diseño de interfaces', 'DAW2'),
  ('Ejercicios de bases de datos', 'DAW1'),
  ('HTML y formularios', 'DAW2'),
  ('Fundamentos de JavaScript', 'DAW1'),
  ('Diseño web responsive', 'DAW2')
) AS d(titulo, curso_codigo)
WHERE NOT EXISTS (
  SELECT 1 FROM recurso r
  WHERE r.origen = 'alumno' AND r.titulo = d.titulo
);

INSERT INTO ejemplar
  (recurso_id, codigo, propietario_usuario_id, conservacion, estado_servicio)
SELECT
  r.id,
  d.codigo_ejemplar,
  NULL::integer,
  d.conservacion,
  'habilitado'
FROM (VALUES
  ('Fundamentos de programación', 'EJ-LA-01', 'bueno'),
  ('Diseño de interfaces', 'EJ-LA-02', 'muy bueno'),
  ('Ejercicios de bases de datos', 'EJ-LA-03', 'bueno'),
  ('HTML y formularios', 'EJ-LA-04', 'aceptable'),
  ('Fundamentos de JavaScript', 'EJ-LA-05', 'bueno'),
  ('Diseño web responsive', 'EJ-LA-06', 'muy bueno')
) AS d(titulo, codigo_ejemplar, conservacion)
JOIN recurso r
  ON r.origen = 'alumno' AND r.titulo = d.titulo
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO anuncio (ejemplar_id, modalidad, estado_revision, version)
SELECT e.id, d.modalidad, 'publicado', 1
FROM (VALUES
  ('EJ-LA-01', 'cesion'),
  ('EJ-LA-02', 'prestamo'),
  ('EJ-LA-03', 'intercambio'),
  ('EJ-LA-04', 'intercambio'),
  ('EJ-LA-05', 'prestamo'),
  ('EJ-LA-06', 'cesion')
) AS d(codigo_ejemplar, modalidad)
JOIN ejemplar e ON e.codigo = d.codigo_ejemplar
ON CONFLICT (ejemplar_id) DO NOTHING;

-- ============================================================
-- 5. PROPIETARIOS DE ENSAYO PARA T10
-- ============================================================
--
-- Solo se asignan propietarios si existen las cuentas
-- ficticias, estan activas y pertenecen al curso correcto.
--
-- No modifica ejemplares que ya tienen propietario.
-- No crea cuentas ni altera sus permisos.
-- ============================================================

WITH asignaciones (codigo_ejemplar, correo, codigo_curso) AS (
  VALUES
    ('EJ-LA-01', 'alumno.daw1.t10@example.test', 'DAW1'),
    ('EJ-LA-03', 'alumno.daw1.t10@example.test', 'DAW1'),
    ('EJ-LA-05', 'alumno.daw1.t10@example.test', 'DAW1'),

    ('EJ-LA-02', 'alumno.pendiente.t10@example.test', 'DAW2'),
    ('EJ-LA-04', 'alumno.pendiente.t10@example.test', 'DAW2'),
    ('EJ-LA-06', 'alumno.pendiente.t10@example.test', 'DAW2')
)
UPDATE ejemplar AS e
SET propietario_usuario_id = u.id
FROM asignaciones AS a
JOIN usuario AS u
  ON u.correo = a.correo
JOIN curso AS c
  ON c.id = u.curso_confirmado_id
 AND c.codigo = a.codigo_curso
JOIN usuario_rol AS ur
  ON ur.usuario_id = u.id
 AND ur.rol = 'alumno'
JOIN recurso AS r
  ON r.origen = 'alumno'
 AND r.curso_id = c.id
WHERE e.codigo = a.codigo_ejemplar
  AND e.recurso_id = r.id
  AND e.propietario_usuario_id IS NULL
  AND u.estado = 'activo';
  
-- ============================================================
COMMIT;
