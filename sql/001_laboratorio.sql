-- ============================================================
-- TABLA DE RECURSOS DE AULA CIRCULAR
-- ============================================================

-- Creamos la tabla que almacena los recursos del catálogo.
CREATE TABLE recurso_demo (

  -- Identificador único generado automáticamente por PostgreSQL.
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Título del recurso.
  -- Debe tener entre 1 y 120 caracteres.
  titulo text NOT NULL
    CHECK (length(trim(titulo)) BETWEEN 1 AND 120),

  -- Tipo o categoría principal del recurso.
  -- Solo se permiten las categorías acordadas.
  -- Introducimos aquí la categoría estudiantil que pide en la tarea del sprint 1 del equipo de Biblioteca y Documentos.
  tipo text NOT NULL
    CHECK (
      tipo IN (
        'fisico',
        'digital',
        'enlace',
        'estudiantil'
      )
    )
);


-- ============================================================
-- DATOS FICTICIOS DE PRUEBA
-- ============================================================

-- Insertamos recursos de ejemplo para poder comprobar
-- posteriormente que la clasificación funciona correctamente.
INSERT INTO recurso_demo (titulo, tipo)
VALUES
  -- Recurso físico del centro.
  ('Calculadora científica de ejemplo', 'fisico'),

  -- Recurso disponible en formato digital.
  ('Guía de prácticas de ejemplo', 'digital'),

  -- Recurso cuyo acceso se realiza mediante un enlace web.
  ('Recurso educativo web de ejemplo', 'enlace'),

  -- Material relacionado con el alumnado.
  ('Libro aportado por el alumnado', 'estudiantil');

  -- ============================================================
-- CURSOS FICTICIOS PARA EL INVENTARIO
-- ============================================================

CREATE TABLE IF NOT EXISTS curso (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL
);

INSERT INTO curso (codigo, nombre)
VALUES
    ('CUR-01', '1.º ESO'),
    ('CUR-02', '2.º ESO')
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================
-- RECURSOS DEL INVENTARIO
-- ============================================================
 -- V1 370h.
 /**
CREATE TABLE IF NOT EXISTS recurso (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    titulo VARCHAR(150) NOT NULL,
    modalidad VARCHAR(30) NOT NULL,
    propietario VARCHAR(100) NOT NULL,
    procedencia VARCHAR(50) NOT NULL,
    curso_id INTEGER REFERENCES curso(id)
);
*/
  -- V2 500h, realizado por Raisa 370h por tener tiempo suficiente

CREATE TABLE IF NOT EXISTS recurso (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    titulo VARCHAR(150) NOT NULL,
    modalidad VARCHAR(30) NOT NULL,
    propietario VARCHAR(100) NOT NULL,
    procedencia VARCHAR(50) NOT NULL,
    curso_id INTEGER REFERENCES curso(id),
    isbn VARCHAR(20)
);

-- ============================================================
-- EJEMPLARES FÍSICOS
-- ============================================================

CREATE TABLE IF NOT EXISTS ejemplar (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    recurso_id INTEGER NOT NULL REFERENCES recurso(id),
    conservacion VARCHAR(30) NOT NULL,
    estado VARCHAR(30) NOT NULL
);


-- ============================================================
-- INVENTARIO: 4 RECURSOS FÍSICOS DEL CENTRO
-- ============================================================

INSERT INTO recurso
    (codigo, titulo, modalidad, propietario, procedencia, curso_id)
VALUES
    (
        'RC-01',
        'Calculadora científica',
        'prestamo',
        'Centro educativo',
        'Biblioteca',
        (SELECT id FROM curso WHERE codigo = 'CUR-01')
    ),
    (
        'RC-02',
        'Kit de electrónica básica',
        'prestamo',
        'Centro educativo',
        'Biblioteca',
        NULL
    ),
    (
        'RC-03',
        'Manual de SQL',
        'prestamo',
        'Centro educativo',
        'Biblioteca',
        (SELECT id FROM curso WHERE codigo = 'CUR-01')
    ),
    (
        'RC-04',
        'Kit de dibujo técnico',
        'prestamo',
        'Centro educativo',
        'Biblioteca',
        (SELECT id FROM curso WHERE codigo = 'CUR-02')
    )
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================
-- EJEMPLARES DE LOS RECURSOS FÍSICOS
-- ============================================================

INSERT INTO ejemplar
    (codigo, recurso_id, conservacion, estado)
VALUES
    (
        'EJ-01',
        (SELECT id FROM recurso WHERE codigo = 'RC-01'),
        'bueno',
        'disponible'
    ),
    (
        'EJ-02',
        (SELECT id FROM recurso WHERE codigo = 'RC-02'),
        'bueno',
        'disponible'
    ),
    (
        'EJ-03',
        (SELECT id FROM recurso WHERE codigo = 'RC-03'),
        'muy bueno',
        'disponible'
    ),
    (
        'EJ-04',
        (SELECT id FROM recurso WHERE codigo = 'RC-04'),
        'bueno',
        'disponible'
    )
ON CONFLICT (codigo) DO NOTHING;


-- ============================================================
-- ANUNCIOS DE LIBROS APORTADOS POR EL ALUMNADO
-- ============================================================

CREATE TABLE IF NOT EXISTS anuncio (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    titulo VARCHAR(150) NOT NULL,
    propietario VARCHAR(100) NOT NULL,
    modalidad VARCHAR(30) NOT NULL,
    curso_id INTEGER REFERENCES curso(id),
    conservacion VARCHAR(30) NOT NULL,
    procedencia VARCHAR(50) NOT NULL DEFAULT 'Estudiantil',
    estado VARCHAR(30) NOT NULL DEFAULT 'disponible'
);

-- ============================================================
-- INVENTARIO: 4 ANUNCIOS ESTUDIANTILES
-- ============================================================

INSERT INTO anuncio
    (codigo, titulo, propietario, modalidad, curso_id,
     conservacion, procedencia, estado)
VALUES
    (
        'LA-01',
        'Fundamentos de programación',
        'AL-01',
        'cesion',
        (SELECT id FROM curso WHERE codigo = 'CUR-01'),
        'bueno',
        'Estudiantil',
        'disponible'
    ),
    (
        'LA-02',
        'Diseño de interfaces',
        'AL-02',
        'prestamo',
        (SELECT id FROM curso WHERE codigo = 'CUR-02'),
        'muy bueno',
        'Estudiantil',
        'disponible'
    ),
    (
        'LA-03',
        'Ejercicios de bases de datos',
        'AL-01',
        'intercambio',
        (SELECT id FROM curso WHERE codigo = 'CUR-01'),
        'bueno',
        'Estudiantil',
        'disponible'
    ),
    (
        'LA-04',
        'HTML y formularios',
        'AL-02',
        'intercambio',
        (SELECT id FROM curso WHERE codigo = 'CUR-02'),
        'aceptable',
        'Estudiantil',
        'disponible'
    )
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================
-- DOCUMENTOS, VERSIONES Y ARCHIVOS
-- ============================================================

CREATE TABLE IF NOT EXISTS documento (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    titulo VARCHAR(150) NOT NULL,
    propietario VARCHAR(100) NOT NULL DEFAULT 'Centro educativo',
    procedencia VARCHAR(50) NOT NULL DEFAULT 'Centro',
    curso_id INTEGER REFERENCES curso(id)
);

CREATE TABLE IF NOT EXISTS archivo (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    tipo_mime VARCHAR(100) NOT NULL,
    ruta VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS documento_version (
    id SERIAL PRIMARY KEY,
    documento_id INTEGER NOT NULL REFERENCES documento(id),
    numero_version INTEGER NOT NULL,
    fecha DATE NOT NULL,
    archivo_id INTEGER NOT NULL REFERENCES archivo(id),
    actual BOOLEAN NOT NULL DEFAULT TRUE,

    UNIQUE (documento_id, numero_version)
);

-- ============================================================
-- INVENTARIO: 4 RECURSOS DIGITALES / DOCUMENTALES
-- ============================================================

-- ============================================================
-- INVENTARIO: DOCUMENTOS ORIGINALES DEL CENTRO
-- ============================================================

INSERT INTO documento
    (codigo, titulo, propietario, procedencia, curso_id)
VALUES
    (
        'RD-01',
        'Apuntes originales de consulta SQL',
        'Centro educativo',
        'Centro',
        NULL
    ),
    (
        'DOC-001',
        'Guía de inicio del curso',
        'Centro educativo',
        'Centro',
        (SELECT id FROM curso WHERE codigo = 'CUR-01')
    ),
    (
        'DOC-002',
        'Listado de material escolar',
        'Centro educativo',
        'Centro',
        (SELECT id FROM curso WHERE codigo = 'CUR-02')
    ),
    (
        'DOC-003',
        'Plantilla de solicitud de material',
        'Centro educativo',
        'Centro',
        NULL
    )
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO archivo
    (nombre, tipo_mime, ruta)
VALUES
    (
        'apuntes_consulta_sql.pdf',
        'application/pdf',
        'documentos/apuntes_consulta_sql.pdf'
    ),
    (
        'DOC-001_Guia_inicio_curso_v1.pdf',
        'application/pdf',
        'documentos/DOC-001_Guia_inicio_curso_v1.pdf'
    ),
    (
        'DOC-002_Listado_material_v1.pdf',
        'application/pdf',
        'documentos/DOC-002_Listado_material_v1.pdf'
    ),
    (
        'DOC-003_Solicitud_material_v1.pdf',
        'application/pdf',
        'documentos/DOC-003_Solicitud_material_v1.pdf'
    )
ON CONFLICT (ruta) DO NOTHING;
-- ============================================================
-- VERSIONES DE LOS DOCUMENTOS
-- ============================================================

INSERT INTO documento_version
    (documento_id, numero_version, fecha, archivo_id, actual)
VALUES
    (
        (SELECT id FROM documento WHERE codigo = 'RD-01'),
        1,
        '2026-10-07',
        (SELECT id FROM archivo
         WHERE ruta = 'documentos/apuntes_consulta_sql.pdf'),
        TRUE
    ),
    (
        (SELECT id FROM documento WHERE codigo = 'DOC-001'),
        1,
        '2026-10-07',
        (SELECT id FROM archivo
         WHERE ruta = 'documentos/DOC-001_Guia_inicio_curso_v1.pdf'),
        TRUE
    ),
    (
        (SELECT id FROM documento WHERE codigo = 'DOC-002'),
        1,
        '2026-10-07',
        (SELECT id FROM archivo
         WHERE ruta = 'documentos/DOC-002_Listado_material_v1.pdf'),
        TRUE
    ),
    (
        (SELECT id FROM documento WHERE codigo = 'DOC-003'),
        1,
        '2026-10-07',
        (SELECT id FROM archivo
         WHERE ruta = 'documentos/DOC-003_Solicitud_material_v1.pdf'),
        TRUE
    )
ON CONFLICT (documento_id, numero_version) DO NOTHING;

-- ============================================================
-- AMPLIACIÓN DEL INVENTARIO 500h: 6 REGISTROS // Realizado por Raisa 370h por tener tiempo suficiente
-- ============================================================

-- 1 y 2. Recursos de Biblioteca
INSERT INTO recurso
    (codigo, titulo, modalidad, propietario, procedencia, curso_id, isbn)
VALUES
    (
        'RC-05',
        'Introducción a PostgreSQL',
        'prestamo',
        'Centro educativo',
        'Biblioteca',
        (SELECT id FROM curso WHERE codigo = 'CUR-01'),
        '9780000000011'
    ),
    (
        'RC-06',
        'Guía práctica de desarrollo web',
        'prestamo',
        'Centro educativo',
        'Biblioteca',
        (SELECT id FROM curso WHERE codigo = 'CUR-02'),
        '9780000000028'
    )
ON CONFLICT (codigo) DO NOTHING;


-- 3 y 4. Aportaciones estudiantiles
INSERT INTO anuncio
    (codigo, titulo, propietario, modalidad, curso_id,
     conservacion, procedencia, estado)
VALUES
    (
        'LA-05',
        'Fundamentos de JavaScript',
        'AL-03',
        'prestamo',
        (SELECT id FROM curso WHERE codigo = 'CUR-01'),
        'bueno',
        'Estudiantil',
        'disponible'
    ),
    (
        'LA-06',
        'Diseño web responsive',
        'AL-04',
        'cesion',
        (SELECT id FROM curso WHERE codigo = 'CUR-02'),
        'muy bueno',
        'Estudiantil',
        'disponible'
    )
ON CONFLICT (codigo) DO NOTHING;


-- 5 y 6. Documentos digitales
INSERT INTO documento
    (codigo, titulo, propietario, procedencia, curso_id)
VALUES
    (
        'DOC-004',
        'Normas de uso de la biblioteca',
        'Centro educativo',
        'Centro',
        NULL
    ),
    (
        'DOC-005',
        'Guía de recursos digitales',
        'Centro educativo',
        'Centro',
        (SELECT id FROM curso WHERE codigo = 'CUR-02')
    )
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================
-- CASO DE CALIDAD: MISMO ISBN, EJEMPLARES DIFERENTES
-- ============================================================

INSERT INTO ejemplar
    (codigo, recurso_id, conservacion, estado)
VALUES
    (
        'EJ-05',
        (SELECT id FROM recurso WHERE codigo = 'RC-05'),
        'muy bueno',
        'disponible'
    ),
    (
        'EJ-06',
        (SELECT id FROM recurso WHERE codigo = 'RC-05'),
        'bueno',
        'disponible'
    )
ON CONFLICT (codigo) DO NOTHING;


-- ============================================================
-- CASO DE CALIDAD: SEGUNDA VERSIÓN DE UN DOCUMENTO
-- ============================================================

-- Archivo correspondiente a la versión 2
INSERT INTO archivo
    (nombre, tipo_mime, ruta)
VALUES
    (
        'DOC-001_Guia_inicio_curso_v2.pdf',
        'application/pdf',
        'documentos/DOC-001_Guia_inicio_curso_v2.pdf'
    )
ON CONFLICT (ruta) DO NOTHING;


-- La versión 1 se conserva, pero deja de ser la actual
UPDATE documento_version
SET actual = FALSE
WHERE documento_id = (
    SELECT id
    FROM documento
    WHERE codigo = 'DOC-001'
)
AND numero_version = 1;


-- Se registra la versión 2 como versión actual
INSERT INTO documento_version
    (documento_id, numero_version, fecha, archivo_id, actual)
VALUES
    (
        (SELECT id
         FROM documento
         WHERE codigo = 'DOC-001'),
        2,
        '2026-10-07',
        (SELECT id
         FROM archivo
         WHERE ruta = 'documentos/DOC-001_Guia_inicio_curso_v2.pdf'),
        TRUE
    )
ON CONFLICT (documento_id, numero_version) DO NOTHING;