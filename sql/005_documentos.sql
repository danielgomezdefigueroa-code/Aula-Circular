-- ============================================================
-- AULA CIRCULAR · DOCUMENTOS Y VERSIONES
-- ============================================================
--
-- Base del modelo de documentación institucional. Porta las tablas
-- que solo existían en sql/historico/inventario_raisa_historico.sql:
-- documento, archivo y documento_version.
--
-- Esta migración no crea rutas HTTP ni sirve archivos. Los archivos
-- reales deben guardarse fuera de public/ y descargarse mediante una
-- ruta autorizada, como indica la documentación del proyecto.
--
-- Una versión antigua no se sobrescribe: se crea otra fila y se
-- cambia cuál es la vigente. El índice parcial impide que un mismo
-- documento tenga dos versiones marcadas como actuales.

CREATE TABLE documento (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL UNIQUE
    CHECK (length(trim(codigo)) BETWEEN 1 AND 20),
  titulo text NOT NULL
    CHECK (length(trim(titulo)) BETWEEN 1 AND 150),
  propietario text NOT NULL DEFAULT 'Centro educativo'
    CHECK (length(trim(propietario)) BETWEEN 1 AND 100),
  procedencia text NOT NULL DEFAULT 'Centro'
    CHECK (length(trim(procedencia)) BETWEEN 1 AND 50),
  curso_id integer REFERENCES curso(id),
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE archivo (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre text NOT NULL
    CHECK (length(trim(nombre)) BETWEEN 1 AND 150),
  tipo_mime text NOT NULL
    CHECK (tipo_mime ~ '^[a-z]+/[a-z0-9.+-]+$'),
  -- Ruta interna relativa; nunca una URL pública ni una ruta absoluta.
  ruta text NOT NULL UNIQUE
    CHECK (ruta !~ '(^|/)\.\.(/|$)' AND ruta !~ '^/'),
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documento_version (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  documento_id integer NOT NULL REFERENCES documento(id),
  numero_version integer NOT NULL CHECK (numero_version > 0),
  fecha date NOT NULL,
  archivo_id integer NOT NULL REFERENCES archivo(id),
  actual boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (documento_id, numero_version)
);

-- Como máximo una versión actual por documento. No obliga a que
-- exista una: un documento sin versión publicada puede existir.
CREATE UNIQUE INDEX documento_version_actual
  ON documento_version (documento_id)
  WHERE actual;

CREATE INDEX documento_curso ON documento (curso_id);
CREATE INDEX documento_version_documento ON documento_version (documento_id);
