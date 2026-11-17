
-- =====================================================
-- T14 - Ampliar catalogo y comprobar duplicados
-- Datos repetibles para pruebas de Biblioteca
-- =====================================================

BEGIN;

DO $$
DECLARE
    v_calculadora_id integer;
    v_manual_2026_id integer;
    v_manual_2027_id integer;
    v_curso_id integer;
    v_categoria_id integer;
    v_codigo text;
    v_recurso_existente integer;
BEGIN

    -- 1. Verificar curso activo.
    SELECT id INTO v_curso_id
    FROM curso
    WHERE codigo = 'DAW1' AND activo = true;

    IF v_curso_id IS NULL THEN
        RAISE EXCEPTION 'El curso DAW1 no esta activo';
    END IF;

    -- 2. Localizar la calculadora existente.
    SELECT id INTO v_calculadora_id
    FROM recurso
    WHERE origen = 'centro'
      AND tipo = 'fisico'
      AND titulo ILIKE 'Calculadora cient%'
      AND edicion = '2026'
      AND curso_id = v_curso_id
    ORDER BY id
    LIMIT 1;

    IF v_calculadora_id IS NULL THEN
        RAISE EXCEPTION 'No existe la calculadora de ensayo';
    END IF;

    -- 3. Localizar el manual original y su categoria.
    SELECT id, categoria_id
    INTO v_manual_2026_id, v_categoria_id
    FROM recurso
    WHERE origen = 'centro'
      AND tipo = 'fisico'
      AND titulo = 'Manual de SQL'
      AND edicion = '2026'
      AND curso_id = v_curso_id
    ORDER BY id
    LIMIT 1;

    IF v_manual_2026_id IS NULL THEN
        RAISE EXCEPTION 'No existe el manual de 2026';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM categoria
        WHERE id = v_categoria_id
          AND activo = true
          AND ambito = 'biblioteca'
    ) THEN
        RAISE EXCEPTION 'Categoria fisica no disponible';
    END IF;

    -- 4. Añadir dos copias fisicas distintas.
    FOR v_codigo IN
        SELECT unnest(ARRAY[
            'T14-CAL-001',
            'T14-CAL-002'
        ])
    LOOP
        SELECT recurso_id INTO v_recurso_existente
        FROM ejemplar
        WHERE codigo = v_codigo;

        IF FOUND THEN
            IF v_recurso_existente <> v_calculadora_id THEN
                RAISE EXCEPTION
                    'Codigo % asociado a otro recurso',
                    v_codigo;
            END IF;
        ELSE
            INSERT INTO ejemplar (
                recurso_id,
                codigo,
                propietario_usuario_id,
                conservacion,
                estado_servicio
            )
            VALUES (
                v_calculadora_id,
                v_codigo,
                NULL,
                'Buen estado - ensayo T14',
                'habilitado'
            );
        END IF;
    END LOOP;

    -- 5. Crear una edicion nueva del manual.
    SELECT id INTO v_manual_2027_id
    FROM recurso
    WHERE origen = 'centro'
      AND tipo = 'fisico'
      AND titulo = 'Manual de SQL'
      AND edicion = '2027'
      AND curso_id = v_curso_id
    ORDER BY id
    LIMIT 1;

    IF v_manual_2027_id IS NULL THEN
        INSERT INTO recurso (
            origen,
            tipo,
            titulo,
            descripcion,
            curso_id,
            asignatura,
            edicion,
            isbn,
            categoria_id
        )
        VALUES (
            'centro',
            'fisico',
            'Manual de SQL',
            'Edicion revisada de ensayo T14',
            v_curso_id,
            'Bases de datos',
            '2027',
            NULL,
            v_categoria_id
        )
        RETURNING id INTO v_manual_2027_id;
    END IF;

    -- 6. Añadir un ejemplar del manual 2027.
    SELECT recurso_id INTO v_recurso_existente
    FROM ejemplar
    WHERE codigo = 'T14-SQL-2027-01';

    IF FOUND THEN
        IF v_recurso_existente <> v_manual_2027_id THEN
            RAISE EXCEPTION
                'Codigo T14-SQL-2027-01 asociado a otro recurso';
        END IF;
    ELSE
        INSERT INTO ejemplar (
            recurso_id,
            codigo,
            propietario_usuario_id,
            conservacion,
            estado_servicio
        )
        VALUES (
            v_manual_2027_id,
            'T14-SQL-2027-01',
            NULL,
            'Nuevo - ensayo T14',
            'habilitado'
        );
    END IF;

    RAISE NOTICE 'Datos T14 preparados correctamente';

END;
$$;

COMMIT;