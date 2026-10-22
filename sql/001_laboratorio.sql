-- ============================================================
-- AULA CIRCULAR · DATOS INICIALES DEL LABORATORIO
-- ============================================================
--
-- Archivo único de datos de demostración. Sustituye al antiguo
-- sql/historico/inventario_raisa_historico.sql y conserva su inventario,
-- sus anuncios estudiantiles y sus documentos.
--
-- El esquema lo crean las migraciones. Ejecutar antes:
--
--   npm.cmd run migrar
--
-- Eso aplica, en orden:
--
--   002_cuentas.sql
--   003_validacion_docente.sql
--   004_anuncios.sql
--   005_documentos.sql
--
-- Después, sobre la base ya migrada:
--
--   psql -f sql/001_laboratorio.sql
--
-- El script es idempotente: se puede repetir sin duplicar los datos.
-- No crea tablas de cuentas, anuncios ni documentos; solo la tabla
-- recurso_demo de la demo pública y los datos ficticios.

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
-- 5. DOCUMENTOS Y VERSIONES
-- ============================================================

INSERT INTO documento
  (codigo, titulo, propietario, procedencia, curso_id)
SELECT
  d.codigo,
  d.titulo,
  'Centro educativo',
  'Centro',
  (SELECT id FROM curso WHERE codigo = d.curso_codigo)
FROM (VALUES
  ('DOC-001', 'Guía de inicio del curso', 'DAW1'),
  ('DOC-002', 'Listado de material escolar', 'DAW2'),
  ('DOC-003', 'Plantilla de solicitud de material', NULL::text),
  ('DOC-004', 'Normas de uso de la biblioteca', NULL::text),
  ('DOC-005', 'Guía de recursos digitales', 'DAW2')
) AS d(codigo, titulo, curso_codigo)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO archivo (nombre, tipo_mime, ruta)
VALUES
  ('DOC-001_Guia_inicio_curso_v1.pdf', 'application/pdf',
   'documentos/DOC-001_Guia_inicio_curso_v1.pdf'),
  ('DOC-001_Guia_inicio_curso_v2.pdf', 'application/pdf',
   'documentos/DOC-001_Guia_inicio_curso_v2.pdf'),
  ('DOC-002_Listado_material_v1.pdf', 'application/pdf',
   'documentos/DOC-002_Listado_material_v1.pdf'),
  ('DOC-003_Solicitud_material_v1.pdf', 'application/pdf',
   'documentos/DOC-003_Solicitud_material_v1.pdf')
ON CONFLICT (ruta) DO NOTHING;

-- DOC-001 conserva la versión 1, pero la vigente es la 2.
INSERT INTO documento_version
  (documento_id, numero_version, fecha, archivo_id, actual)
SELECT d.id, 1, DATE '2026-10-07', a.id, false
FROM documento d
JOIN archivo a
  ON a.ruta = 'documentos/DOC-001_Guia_inicio_curso_v1.pdf'
WHERE d.codigo = 'DOC-001'
ON CONFLICT (documento_id, numero_version) DO NOTHING;

UPDATE documento_version v
SET actual = false
WHERE v.documento_id = (SELECT id FROM documento WHERE codigo = 'DOC-001')
  AND v.numero_version = 1;

INSERT INTO documento_version
  (documento_id, numero_version, fecha, archivo_id, actual)
SELECT d.id, 2, DATE '2026-10-07', a.id, true
FROM documento d
JOIN archivo a
  ON a.ruta = 'documentos/DOC-001_Guia_inicio_curso_v2.pdf'
WHERE d.codigo = 'DOC-001'
ON CONFLICT (documento_id, numero_version) DO NOTHING;

UPDATE documento_version v
SET actual = true
WHERE v.documento_id = (SELECT id FROM documento WHERE codigo = 'DOC-001')
  AND v.numero_version = 2
  AND NOT EXISTS (
    SELECT 1 FROM documento_version x
    WHERE x.documento_id = v.documento_id AND x.actual
  );

-- DOC-002 y DOC-003 tienen una única versión vigente.
INSERT INTO documento_version
  (documento_id, numero_version, fecha, archivo_id, actual)
SELECT d.id, 1, DATE '2026-10-07', a.id, true
FROM documento d
JOIN archivo a
  ON a.ruta = 'documentos/DOC-002_Listado_material_v1.pdf'
WHERE d.codigo = 'DOC-002'
ON CONFLICT (documento_id, numero_version) DO NOTHING;

INSERT INTO documento_version
  (documento_id, numero_version, fecha, archivo_id, actual)
SELECT d.id, 1, DATE '2026-10-07', a.id, true
FROM documento d
JOIN archivo a
  ON a.ruta = 'documentos/DOC-003_Solicitud_material_v1.pdf'
WHERE d.codigo = 'DOC-003'
ON CONFLICT (documento_id, numero_version) DO NOTHING;

COMMIT;
