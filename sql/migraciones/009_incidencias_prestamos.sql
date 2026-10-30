-- ============================================================
-- AULA CIRCULAR
-- Área: Biblioteca y Documentos
-- Migración 009: incidencias de préstamos físicos.
-- No modifica las migraciones anteriores.
-- ============================================================

CREATE TABLE incidencia (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    operacion_id integer NOT NULL
        REFERENCES operacion(id),

    ejemplar_id integer NOT NULL
        REFERENCES ejemplar(id),

    autor_id integer NOT NULL
        REFERENCES usuario(id),

    tipo text NOT NULL
        CHECK (tipo IN ('dano', 'perdida')),

    descripcion text NOT NULL
        CHECK (length(trim(descripcion)) BETWEEN 1 AND 1000),

    estado text NOT NULL DEFAULT 'abierta'
        CHECK (estado IN ('abierta', 'resuelta')),

    resolucion text
        CHECK (
            resolucion IS NULL
            OR length(trim(resolucion)) BETWEEN 1 AND 1000
        ),

    creada_en timestamptz NOT NULL DEFAULT now(),

    resuelta_en timestamptz,

    FOREIGN KEY (operacion_id, ejemplar_id)
        REFERENCES operacion_item(operacion_id, ejemplar_id),

    CONSTRAINT incidencia_resolucion_coherente CHECK (
        (estado = 'abierta'
            AND resolucion IS NULL
            AND resuelta_en IS NULL)
        OR
        (estado = 'resuelta'
            AND resolucion IS NOT NULL
            AND resuelta_en IS NOT NULL)
    )
);

-- Evita dos incidencias abiertas para el mismo ejemplar
-- dentro de una misma operación.
CREATE UNIQUE INDEX incidencia_abierta_unica
ON incidencia (operacion_id, ejemplar_id)
WHERE estado = 'abierta';

CREATE INDEX incidencia_operacion_idx
ON incidencia (operacion_id);
