CREATE TABLE evento_cuenta (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id integer NOT NULL REFERENCES usuario(id),
  actor_id integer NOT NULL REFERENCES usuario(id),
  accion text NOT NULL CHECK (accion='validar_pertenencia'),
  curso_id integer NOT NULL REFERENCES curso(id),
  creada_en timestamptz NOT NULL DEFAULT now()
);
