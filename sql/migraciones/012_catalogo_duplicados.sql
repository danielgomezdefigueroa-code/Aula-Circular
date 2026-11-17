
-- T14 - Catalogo, categorias y validacion de ejemplares.
-- No elimina recursos, ejemplares ni operaciones anteriores.

CREATE TABLE categoria (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre text NOT NULL UNIQUE,
    ambito text NOT NULL
        CHECK (ambito IN ('biblioteca', 'libros')),
    activo boolean NOT NULL DEFAULT true
);

INSERT INTO categoria (nombre, ambito)
VALUES
    ('Material físico', 'biblioteca'),
    ('Material digital', 'biblioteca'),
    ('Enlaces educativos', 'biblioteca'),
    ('Libros de estudiantes', 'libros');

-- Relacionar los recursos existentes con su categoria.
ALTER TABLE recurso
ADD COLUMN categoria_id integer REFERENCES categoria(id);

UPDATE recurso AS r
SET categoria_id = c.id
FROM categoria AS c
WHERE c.nombre = CASE
    WHEN r.origen = 'alumno'
        THEN 'Libros de estudiantes'
    WHEN r.tipo = 'fisico'
        THEN 'Material físico'
    WHEN r.tipo = 'digital'
        THEN 'Material digital'
    ELSE 'Enlaces educativos'
END;

ALTER TABLE recurso
ALTER COLUMN categoria_id SET NOT NULL;

-- Validar la categoria en nuevas altas y cambios.
-- Los recursos antiguos mantienen su referencia
-- aunque posteriormente se desactive su categoria.
CREATE FUNCTION validar_categoria_recurso()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    nombre_predeterminado text;
    categoria_activa boolean;
    categoria_ambito text;
BEGIN
    -- Compatibilidad con las altas existentes de anuncios.
    IF TG_OP = 'INSERT' AND NEW.categoria_id IS NULL THEN
        nombre_predeterminado := CASE
            WHEN NEW.origen = 'alumno'
                THEN 'Libros de estudiantes'
            WHEN NEW.tipo = 'fisico'
                THEN 'Material físico'
            WHEN NEW.tipo = 'digital'
                THEN 'Material digital'
            ELSE 'Enlaces educativos'
        END;

        SELECT id INTO NEW.categoria_id
        FROM categoria
        WHERE nombre = nombre_predeterminado;
    END IF;

    SELECT activo, ambito
    INTO categoria_activa, categoria_ambito
    FROM categoria
    WHERE id = NEW.categoria_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CATEGORIA_INVALIDA'
            USING ERRCODE = '23514';
    END IF;

    IF (NEW.origen = 'alumno'
        AND categoria_ambito <> 'libros')
      OR (NEW.origen = 'centro'
        AND categoria_ambito <> 'biblioteca')
    THEN
        RAISE EXCEPTION 'CATEGORIA_INCOMPATIBLE'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NOT categoria_activa THEN
            RAISE EXCEPTION 'CATEGORIA_INACTIVA'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF (
            NEW.categoria_id IS DISTINCT FROM OLD.categoria_id
            OR NEW.tipo IS DISTINCT FROM OLD.tipo
            OR NEW.origen IS DISTINCT FROM OLD.origen
        ) AND NOT categoria_activa THEN
            RAISE EXCEPTION 'CATEGORIA_INACTIVA'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_categoria_recurso
BEFORE INSERT OR UPDATE OF categoria_id, tipo, origen
ON recurso
FOR EACH ROW
EXECUTE FUNCTION validar_categoria_recurso();

-- Solo se pueden asociar ejemplares a recursos fisicos.
CREATE FUNCTION validar_tipo_ejemplar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    tipo_recurso text;
BEGIN
    SELECT tipo INTO tipo_recurso
    FROM recurso
    WHERE id = NEW.recurso_id
    FOR SHARE;

    IF tipo_recurso IS NOT NULL
       AND tipo_recurso <> 'fisico' THEN
        RAISE EXCEPTION 'RECURSO_NO_FISICO'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_tipo_ejemplar
BEFORE INSERT OR UPDATE OF recurso_id
ON ejemplar
FOR EACH ROW
EXECUTE FUNCTION validar_tipo_ejemplar();

-- Impedir cambiar un recurso con ejemplares a digital o enlace.
CREATE FUNCTION impedir_tipo_incompatible()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.tipo <> 'fisico'
       AND EXISTS (
           SELECT 1
           FROM ejemplar
           WHERE recurso_id = NEW.id
       ) THEN
        RAISE EXCEPTION 'RECURSO_CON_EJEMPLARES'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_impedir_tipo_incompatible
BEFORE UPDATE OF tipo
ON recurso
FOR EACH ROW
EXECUTE FUNCTION impedir_tipo_incompatible();

-- No permitir asignar cursos inactivos en altas y cambios.
CREATE FUNCTION validar_curso_recurso()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.curso_id IS NOT NULL THEN
        PERFORM id
        FROM curso
        WHERE id = NEW.curso_id AND activo = true
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'CURSO_INVALIDO_O_INACTIVO'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_curso_recurso
BEFORE INSERT OR UPDATE OF curso_id
ON recurso
FOR EACH ROW
EXECUTE FUNCTION validar_curso_recurso();

-- Ya existe UNIQUE(codigo). Añadimos longitud valida.
ALTER TABLE ejemplar
ADD CONSTRAINT ejemplar_codigo_longitud
CHECK (length(trim(codigo)) BETWEEN 1 AND 40);
