-- ============================================================
-- AULA CIRCULAR
-- TAREA: Biblioteca y Documentos
-- Un mismo recurso puede disponer de varios ejemplares.
-- Los recursos digitales y enlaces no necesitan ejemplares
-- físicos ni fechas de devolución.
--
-- BASE DE DATOS:
-- aula_circular_sprint2_ensayo
-- ============================================================
BEGIN;

-- 1. Categorías del catálogo
CREATE TABLE categoria (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre text NOT NULL UNIQUE,
    ambito text NOT NULL
        CHECK (ambito IN ('biblioteca', 'libros', 'documentacion')),
    activo boolean NOT NULL DEFAULT true
);

-- 2. Fichas de recursos del catálogo
CREATE TABLE recurso (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    titulo text NOT NULL
        CHECK (length(trim(titulo)) BETWEEN 1 AND 120),
    descripcion text,
    tipo text NOT NULL
        CHECK (tipo IN ('fisico', 'digital', 'enlace')),
    origen text NOT NULL
        CHECK (origen IN ('centro', 'alumno', 'externo')),
    categoria_id integer NOT NULL REFERENCES categoria(id),
    estado_editorial text NOT NULL DEFAULT 'publicado'
        CHECK (estado_editorial IN ('borrador', 'publicado', 'retirado')),
    url text,
    creado_en timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT recurso_url_por_tipo CHECK (
        (tipo = 'enlace' AND url ~ '^https://')
        OR
        (tipo IN ('fisico', 'digital') AND url IS NULL)
    )
);

-- 3. Relación de recursos con cursos
CREATE TABLE recurso_curso (
    recurso_id integer NOT NULL
        REFERENCES recurso(id) ON DELETE CASCADE,
    curso_id integer NOT NULL
        REFERENCES curso(id),
    PRIMARY KEY (recurso_id, curso_id)
);

-- 4. Unidades físicas de cada recurso
CREATE TABLE ejemplar (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recurso_id integer NOT NULL
        REFERENCES recurso(id),
    codigo text NOT NULL UNIQUE,
    propietario_usuario_id integer
        REFERENCES usuario(id),
    conservacion text NOT NULL DEFAULT 'bueno'
        CHECK (conservacion IN ('nuevo', 'bueno', 'regular', 'deteriorado')),
    estado_servicio text NOT NULL DEFAULT 'disponible'
        CHECK (estado_servicio IN ('disponible', 'reservado', 'prestado', 'retirado'))
);

COMMIT;
