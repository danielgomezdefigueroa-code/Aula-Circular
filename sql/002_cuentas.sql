CREATE TABLE curso (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true
);
CREATE TABLE usuario (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alias text NOT NULL CHECK (length(trim(alias)) BETWEEN 2 AND 60),
  correo text NOT NULL UNIQUE CHECK (correo = lower(trim(correo))),
  hash text NOT NULL,
  curso_solicitado_id integer NOT NULL REFERENCES curso(id),
  curso_confirmado_id integer REFERENCES curso(id),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','activo','suspendido')),
  auth_version integer NOT NULL DEFAULT 1,
  validado_por integer REFERENCES usuario(id),
  validado_en timestamptz,
  creada_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE usuario_rol (
  usuario_id integer NOT NULL REFERENCES usuario(id),
  rol text NOT NULL CHECK (rol IN ('alumno','docente','admin')),
  PRIMARY KEY (usuario_id,rol)
);
-- Estructura del almacén connect-pg-simple; no se crea automáticamente al arrancar.
CREATE TABLE sesion (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX sesion_expire ON sesion(expire);
INSERT INTO curso(codigo,nombre) VALUES ('DAW1','1º DAW'),('DAW2','2º DAW');
