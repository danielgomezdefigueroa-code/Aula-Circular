-- ============================================================
-- AULA CIRCULAR
-- Publicar archivos y documentos por curso
-- Área: Biblioteca y Documentos
--
-- Dependencias:
-- 005_catalogo_biblioteca.sql
-- 008_metadatos_digitales.sql
--
-- Registra archivos privados y sus versiones.
-- No guarda rutas absolutas ni contenido binario.
-- ============================================================

BEGIN;

CREATE TABLE archivo_digital (

    -- Identificador opaco generado por Node.js.
    id uuid PRIMARY KEY,

    -- Recurso del catálogo al que pertenece.
    recurso_id integer NOT NULL
        REFERENCES recurso(id) ON DELETE RESTRICT,

    -- Nombre generado por el servidor.
    nombre_interno text NOT NULL UNIQUE
        CHECK (
            nombre_interno ~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$'
        ),

    -- Versión del archivo.
    version_documento text NOT NULL
        CHECK (
            length(trim(version_documento)) BETWEEN 1 AND 30
        ),

    -- Formato validado del contenido.
    formato text NOT NULL
        CHECK (formato IN ('PDF', 'JPG', 'PNG')),

    -- Tamaño en bytes.
    tamano_bytes bigint NOT NULL
        CHECK (
            tamano_bytes > 0
            AND tamano_bytes <= 10485760
        ),

    -- Número de páginas para PDF.
    paginas integer
        CHECK (paginas BETWEEN 1 AND 200),

    -- Dimensiones para imágenes.
    ancho integer CHECK (ancho > 0),
    alto integer CHECK (alto > 0),

    creado_en timestamptz NOT NULL DEFAULT now(),

    -- Evita duplicar versiones de un recurso.
    CONSTRAINT archivo_version_unica
        UNIQUE (recurso_id, version_documento),

    -- Coherencia entre formato y metadatos.
    CONSTRAINT archivo_formato_valido CHECK (
        (
            formato = 'PDF'
            AND paginas IS NOT NULL
            AND ancho IS NULL
            AND alto IS NULL
            AND tamano_bytes <= 10485760
            AND nombre_interno LIKE '%.pdf'
        )
        OR
        (
            formato IN ('JPG', 'PNG')
            AND paginas IS NULL
            AND ancho IS NOT NULL
            AND alto IS NOT NULL
            AND ancho::bigint * alto <= 12000000
            AND tamano_bytes <= 5242880
            AND (
                (formato = 'JPG' AND nombre_interno LIKE '%.jpg')
                OR
                (formato = 'PNG' AND nombre_interno LIKE '%.png')
            )
        )
    )
);

-- Facilita localizar las versiones de un recurso.
CREATE INDEX idx_archivo_digital_recurso
ON archivo_digital(recurso_id);

-- Solo recursos digitales del catálogo.
CREATE OR REPLACE FUNCTION validar_archivo_digital()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    tipo_recurso text;
BEGIN
    SELECT tipo
    INTO tipo_recurso
    FROM recurso
    WHERE id = NEW.recurso_id
    FOR UPDATE;

    IF tipo_recurso IS DISTINCT FROM 'digital' THEN
        RAISE EXCEPTION
            'El recurso % no es digital',
            NEW.recurso_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_archivo_digital
BEFORE INSERT OR UPDATE OF recurso_id
ON archivo_digital
FOR EACH ROW
EXECUTE FUNCTION validar_archivo_digital();

COMMIT;
