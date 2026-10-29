CREATE TABLE categoria (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 codigo text NOT NULL UNIQUE,
 nombre text NOT NULL,
 activo boolean NOT NULL DEFAULT true
);
CREATE TABLE evento_administracion (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id integer NOT NULL REFERENCES usuario(id),
 entidad text NOT NULL,
 entidad_id integer NOT NULL,
 antes jsonb NOT NULL,
 despues jsonb NOT NULL,
 creada_en timestamptz NOT NULL DEFAULT now()
);
