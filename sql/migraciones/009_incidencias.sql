-- Estructura común para devolución e incidencias; no modifica migraciones previas.
CREATE TABLE incidencia (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operacion_id integer NOT NULL,
  ejemplar_id integer NOT NULL,
  autor_id integer NOT NULL REFERENCES usuario(id),
  tipo text NOT NULL CHECK (tipo IN ('dano','perdida')),
  descripcion text NOT NULL CHECK (length(trim(descripcion)) BETWEEN 1 AND 1000),
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','resuelta')),
  resolucion text,
  resuelta_por integer REFERENCES usuario(id),
  creada_en timestamptz NOT NULL DEFAULT now(),
  resuelta_en timestamptz,
  FOREIGN KEY (operacion_id,ejemplar_id)
    REFERENCES operacion_item(operacion_id,ejemplar_id),
  CHECK ((estado='abierta' AND resolucion IS NULL AND resuelta_por IS NULL AND resuelta_en IS NULL)
    OR (estado='resuelta' AND length(trim(resolucion)) BETWEEN 1 AND 1000
        AND resolucion IS NOT NULL AND resuelta_por IS NOT NULL AND resuelta_en IS NOT NULL))
);
CREATE UNIQUE INDEX una_incidencia_abierta_por_item
  ON incidencia(operacion_id,ejemplar_id) WHERE estado='abierta';
