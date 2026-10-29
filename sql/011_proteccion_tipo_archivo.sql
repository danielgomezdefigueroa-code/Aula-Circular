-- ============================================================
-- AULA CIRCULAR
-- Publicar archivos y documentos por curso
-- Área: Biblioteca y Documentos
-- Impedir cambios de tipo incompatibles
-- cuando un recurso tiene archivos digitales.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION impedir_cambio_tipo_con_archivos()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.tipo <> 'digital'
       AND EXISTS (
           SELECT 1
           FROM archivo_digital
           WHERE recurso_id = NEW.id
       )
    THEN
        RAISE EXCEPTION
            'El recurso % tiene archivos y debe seguir siendo digital',
            NEW.id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_impedir_cambio_tipo_con_archivos
BEFORE UPDATE OF tipo
ON recurso
FOR EACH ROW
EXECUTE FUNCTION impedir_cambio_tipo_con_archivos();

COMMIT;