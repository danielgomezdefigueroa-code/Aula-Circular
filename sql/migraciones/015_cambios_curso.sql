CREATE TABLE cambio_curso (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id integer NOT NULL REFERENCES usuario(id),
  curso_origen_id integer NOT NULL REFERENCES curso(id),
  curso_destino_id integer NOT NULL REFERENCES curso(id),
  solicitada_en timestamptz NOT NULL DEFAULT now(),
  confirmada_por integer REFERENCES usuario(id),
  confirmada_en timestamptz,
  CHECK (curso_origen_id <> curso_destino_id),
  CHECK ((confirmada_por IS NULL) = (confirmada_en IS NULL))
);

CREATE UNIQUE INDEX cambio_curso_pendiente
  ON cambio_curso(usuario_id) WHERE confirmada_en IS NULL;

ALTER TABLE aviso ADD COLUMN cambio_curso_id integer UNIQUE REFERENCES cambio_curso(id);
