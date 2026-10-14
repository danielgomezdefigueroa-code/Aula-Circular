-- Sprint 2: base de cuentas. No borra ni modifica recurso_demo del Sprint 1.
-- Ejecutar una sola vez en una base de ensayo. Si ya existe una tabla, revisar.
BEGIN;

CREATE TABLE curso (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE usuario (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alias text NOT NULL CHECK (length(trim(alias)) BETWEEN 2 AND 80),
  correo text NOT NULL UNIQUE CHECK (correo = lower(trim(correo))),
  hash text NOT NULL,
  curso_solicitado_id integer NOT NULL REFERENCES curso(id),
  curso_confirmado_id integer REFERENCES curso(id),
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'activo', 'suspendido')),
  auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  validado_por integer REFERENCES usuario(id),
  validado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (estado = 'pendiente' OR
    (curso_confirmado_id IS NOT NULL AND validado_por IS NOT NULL AND validado_en IS NOT NULL))
);

-- Una cuenta puede tener varios roles explícitos. Admin no implica docente.
CREATE TABLE usuario_rol (
  usuario_id integer NOT NULL REFERENCES usuario(id),
  rol text NOT NULL CHECK (rol IN ('alumno', 'docente', 'admin')),
  PRIMARY KEY (usuario_id, rol)
);

-- Solo cursos ficticios. Las contraseñas se crearán localmente, nunca en SQL/Git.
INSERT INTO curso (codigo, nombre) VALUES
  ('DAW-1', 'Primero DAW - ejemplo'),
  ('DAW-2', 'Segundo DAW - ejemplo');

COMMIT;
