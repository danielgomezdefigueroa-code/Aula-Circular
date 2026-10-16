-- Tarea 2.2.2 · cuentas, cursos y roles (modelo de referencia de 06 · Datos).
-- Ejecutar una vez, después de 001_laboratorio.sql:  psql -d aula_circular -f sql/002_usuarios.sql
-- La tabla de sesiones la crea connect-pg-simple (createTableIfMissing) mientras dure el laboratorio.

CREATE TABLE curso (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL UNIQUE CHECK (length(trim(codigo)) BETWEEN 1 AND 20),
  nombre text NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 80),
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE usuario (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alias text NOT NULL CHECK (length(trim(alias)) BETWEEN 1 AND 40),
  correo text NOT NULL UNIQUE CHECK (correo = lower(trim(correo)) AND length(correo) <= 254),
  hash text NOT NULL,
  curso_solicitado_id integer NOT NULL REFERENCES curso(id),
  curso_confirmado_id integer REFERENCES curso(id),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'activo', 'suspendido')),
  auth_version integer NOT NULL DEFAULT 1,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario_rol (
  usuario_id integer NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  rol text NOT NULL CHECK (rol IN ('alumno', 'docente', 'admin')),
  PRIMARY KEY (usuario_id, rol)
);

INSERT INTO curso (codigo, nombre)
VALUES ('DAW-1', 'Desarrollo de Aplicaciones Web 1'),
       ('DAW-2', 'Desarrollo de Aplicaciones Web 2');

-- SOLO PARA ENSAYAR EN LOCAL, mientras no exista la ruta docente de validación:
-- UPDATE usuario SET estado = 'activo', curso_confirmado_id = curso_solicitado_id, auth_version = auth_version + 1
-- WHERE correo = 'ana@example.test';
