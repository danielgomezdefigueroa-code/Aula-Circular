
-- ============================================================
-- AULA CIRCULAR
-- ÁREA: Biblioteca y Documentos
-- Almacenar información descriptiva de los recursos
-- digitales sin implementar todavía el almacenamiento
-- ni la descarga protegida de archivos.
--
-- DEPENDENCIA:
-- Dependencia histórica: sql/historico/005_catalogo_biblioteca.sql.
--
-- IMPORTANTE:
-- No se almacenan archivos, rutas privadas ni tokens.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. CREAR TABLA DE METADATOS DIGITALES
--
-- Cada recurso digital puede tener un único registro
-- de metadatos en esta fase del proyecto.
--
-- La clave primaria recurso_id es también una clave
-- foránea hacia la tabla recurso.
--
-- De este modo se establece una relación 1:1.
-- ------------------------------------------------------------

CREATE TABLE metadato_digital (

    -- Identificador del recurso digital asociado.
    -- Es clave primaria para evitar duplicados.
    recurso_id integer PRIMARY KEY
        REFERENCES recurso(id) ON DELETE CASCADE,

    -- Formato declarado del documento.
    formato text NOT NULL
        CHECK (formato IN ('PDF', 'DOCX', 'TXT', 'ODT')),

    -- Versión descriptiva del documento.
    -- La gestión de versiones de archivos se realizará
    -- en la tarea específica de archivos.
    version_documento text NOT NULL
        CHECK (length(trim(version_documento)) BETWEEN 1 AND 30),

    -- Indica si existe un archivo protegido integrado.
    -- Por defecto es false, porque esta fase solo
    -- prepara metadatos descriptivos.
    descarga_disponible boolean NOT NULL DEFAULT false,

    -- Fecha de registro de los metadatos.
    creado_en timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- VALIDACIÓN: METADATOS EXCLUSIVOS DE RECURSOS DIGITALES
-- Impedir que los recursos físicos o de tipo enlace
-- reciban metadatos reservados para documentos digitales.
--
-- La función también bloquea la fila del recurso durante
-- la validación para evitar cambios simultáneos.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION validar_metadato_digital()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    tipo_recurso text;
BEGIN

    -- Consultamos el tipo del recurso asociado.
    SELECT tipo
    INTO tipo_recurso
    FROM recurso
    WHERE id = NEW.recurso_id
    FOR UPDATE;

    -- Rechazamos los metadatos si el recurso no es digital.
    IF tipo_recurso IS NOT NULL
       AND tipo_recurso <> 'digital' THEN

        RAISE EXCEPTION
            'El recurso % es de tipo % y no admite metadatos digitales',
            NEW.recurso_id,
            tipo_recurso;
    END IF;

    -- Permitimos la operación cuando el recurso es digital.
    -- Si el recurso no existe, actuará la clave foránea.
    RETURN NEW;

END;
$$;

-- ------------------------------------------------------------
-- TRIGGER: VALIDACIÓN ANTES DE INSERTAR O REASIGNAR
--
-- Comprueba que el recurso asociado sea digital.
-- ------------------------------------------------------------

CREATE TRIGGER trg_validar_metadato_digital
BEFORE INSERT OR UPDATE OF recurso_id
ON metadato_digital
FOR EACH ROW
EXECUTE FUNCTION validar_metadato_digital();


-- ------------------------------------------------------------
-- VALIDACIÓN: IMPEDIR CAMBIOS DE TIPO INCOMPATIBLES
--
-- Un recurso digital que ya tenga metadatos no podrá
-- convertirse en físico o enlace mientras conserve
-- su registro de metadatos.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION impedir_cambio_tipo_con_metadatos()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    -- Comprobamos si se intenta cambiar el tipo digital
    -- por otro diferente mientras existen metadatos.
    IF NEW.tipo <> 'digital'
       AND EXISTS (
           SELECT 1
           FROM metadato_digital
           WHERE recurso_id = NEW.id
       )
    THEN
        RAISE EXCEPTION
            'El recurso % tiene metadatos digitales y no puede cambiar al tipo %',
            NEW.id,
            NEW.tipo;
    END IF;

    RETURN NEW;

END;
$$;

-- ------------------------------------------------------------
-- TRIGGER: PROTECCIÓN DE CAMBIOS EN RECURSO
-- ------------------------------------------------------------

CREATE TRIGGER trg_impedir_cambio_tipo_con_metadatos
BEFORE UPDATE OF tipo
ON recurso
FOR EACH ROW
EXECUTE FUNCTION impedir_cambio_tipo_con_metadatos();

-- ------------------------------------------------------------
-- 2. REGISTRAR METADATOS DE LA GUÍA DIGITAL
--
-- El recurso con ID 3 corresponde a la guía ficticia
-- de inicio del curso, creada durante el punto 1.
--
-- No se proporciona URL de descarga porque todavía
-- no existe una integración con archivos protegidos.
-- ------------------------------------------------------------

INSERT INTO metadato_digital (
    recurso_id,
    formato,
    version_documento,
    descarga_disponible
)
SELECT
    id,
    'PDF',
    'v1',
    false
FROM recurso
WHERE id = 3
  AND tipo = 'digital';

-- ------------------------------------------------------------
-- 3. CONFIRMAR LOS CAMBIOS
-- ------------------------------------------------------------

COMMIT;
