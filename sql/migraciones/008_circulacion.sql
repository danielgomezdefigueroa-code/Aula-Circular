ALTER TABLE operacion ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE intercambio_aceptacion (
 operacion_id integer NOT NULL REFERENCES operacion(id),
 usuario_id integer NOT NULL REFERENCES usuario(id),
 creada_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(operacion_id,usuario_id)
);
