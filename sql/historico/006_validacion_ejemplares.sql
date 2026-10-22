
-- ============================================================
-- AULA CIRCULAR
-- ÁREA: Biblioteca y Documentos
-- Garantizar que únicamente los recursos de tipo "fisico"
-- puedan tener ejemplares asociados.
--
-- Un recurso digital o un enlace no es una unidad física
-- prestable por lo que no debe tener ejemplares.
--
-- DEPENDENCIA:
-- Dependencia histórica: sql/historico/005_catalogo_biblioteca.sql.
-- ============================================================
BEGIN;
-- ------------------------------------------------------------
-- 1. FUNCIÓN DE VALIDACIÓN
--
-- Se ejecutará antes de insertar o modificar un ejemplar.
-- Comprueba el tipo del recurso al que se quiere asociar.
--
-- Si el recurso no es físico, se rechaza la operación.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validar_ejemplar_fisico()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    -- Tipo del recurso al que pertenece el ejemplar.
    tipo_recurso text;
BEGIN

    -- Buscamos el recurso correspondiente y bloqueamos su fila
    -- para evitar cambios simultáneos mientras se valida.
    SELECT tipo
    INTO tipo_recurso
    FROM recurso
    WHERE id = NEW.recurso_id
    FOR UPDATE;

    -- Si el recurso existe pero no es físico, rechazamos
    -- la creación o modificación del ejemplar.
    IF tipo_recurso IS NOT NULL AND tipo_recurso <> 'fisico' THEN
        RAISE EXCEPTION
            'No se pueden asociar ejemplares al recurso %, porque su tipo es %',
            NEW.recurso_id, tipo_recurso;
    END IF;

    -- Si el recurso es físico, permitimos la operación.
    -- Si no existe, la clave foránea rechazará la operación.
    RETURN NEW;

END;
$$;

-- ------------------------------------------------------------
-- 2. TRIGGER SOBRE LA TABLA EJEMPLAR
--
-- Ejecuta la función antes de insertar un ejemplar o
-- modificar el recurso al que está asociado.
-- ------------------------------------------------------------

CREATE TRIGGER trg_validar_ejemplar_fisico
BEFORE INSERT OR UPDATE OF recurso_id
ON ejemplar
FOR EACH ROW
EXECUTE FUNCTION validar_ejemplar_fisico();

-- ------------------------------------------------------------
-- 3. PROTECCIÓN CONTRA CAMBIOS DE TIPO
--
-- También debemos impedir que un recurso físico con
-- ejemplares se convierta posteriormente en digital
-- o enlace, dejando datos incompatibles.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION impedir_cambio_tipo_con_ejemplares()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    -- Si se intenta convertir un recurso físico en otro
    -- tipo, comprobamos si todavía tiene ejemplares.
    IF NEW.tipo <> 'fisico'
       AND EXISTS (
           SELECT 1
           FROM ejemplar
           WHERE recurso_id = NEW.id
       )
    THEN
        RAISE EXCEPTION
            'El recurso % tiene ejemplares y no puede cambiar al tipo %',
            NEW.id, NEW.tipo;
    END IF;

    -- Permitimos el cambio si no rompe la relación.
    RETURN NEW;

END;
$$;

-- ------------------------------------------------------------
-- 4. TRIGGER SOBRE LA TABLA RECURSO
--
-- Comprueba los cambios de tipo antes de guardarlos.
-- ------------------------------------------------------------

CREATE TRIGGER trg_impedir_cambio_tipo_con_ejemplares
BEFORE UPDATE OF tipo
ON recurso
FOR EACH ROW
EXECUTE FUNCTION impedir_cambio_tipo_con_ejemplares();

COMMIT;
