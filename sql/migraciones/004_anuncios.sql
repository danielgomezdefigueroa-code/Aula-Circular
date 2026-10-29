CREATE TABLE recurso (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origen text NOT NULL CHECK (origen IN ('centro','alumno')),
  tipo text NOT NULL CHECK (tipo IN ('fisico','digital','enlace')),
  titulo text NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 120),
  descripcion text NOT NULL DEFAULT '' CHECK (length(descripcion)<=2000),
  curso_id integer REFERENCES curso(id),
  asignatura text NOT NULL CHECK (length(trim(asignatura)) BETWEEN 1 AND 100),
  edicion text NOT NULL CHECK (length(trim(edicion)) BETWEEN 1 AND 100),
  isbn text CHECK (isbn IS NULL OR isbn ~ '^[0-9Xx -]{10,25}$')
);
CREATE TABLE ejemplar (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recurso_id integer NOT NULL REFERENCES recurso(id),
  codigo text NOT NULL UNIQUE,
  propietario_usuario_id integer REFERENCES usuario(id),
  conservacion text NOT NULL CHECK (length(trim(conservacion)) BETWEEN 1 AND 500),
  estado_servicio text NOT NULL DEFAULT 'habilitado' CHECK (estado_servicio IN ('habilitado','retirado'))
);
CREATE TABLE anuncio (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejemplar_id integer NOT NULL UNIQUE REFERENCES ejemplar(id),
  modalidad text NOT NULL CHECK (modalidad IN ('cesion','prestamo','intercambio')),
  estado_revision text NOT NULL DEFAULT 'borrador' CHECK (estado_revision IN ('borrador','pendiente','publicado','rechazado','retirado')),
  motivo text NOT NULL DEFAULT '' CHECK (length(motivo)<=1000),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  creada_en timestamptz NOT NULL DEFAULT now(),
  actualizada_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evento_anuncio (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anuncio_id integer NOT NULL REFERENCES anuncio(id),
  actor_id integer NOT NULL REFERENCES usuario(id),
  accion text NOT NULL,
  estado_anterior text,
  estado_nuevo text NOT NULL,
  motivo text NOT NULL DEFAULT '',
  creada_en timestamptz NOT NULL DEFAULT now()
);
-- Base de integridad para el futuro módulo de operaciones; aún no hay rutas de adjudicación.
CREATE TABLE operacion (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('prestamo','cesion','intercambio')),
  estado text NOT NULL CHECK (estado IN ('propuesta','reservada','prestada','completada','cancelada','cerrada_por_incidencia')),
  docente_id integer REFERENCES usuario(id),
  creada_en timestamptz NOT NULL DEFAULT now(),
  vencimiento timestamptz,
  entregada_en timestamptz,
  cerrada_en timestamptz
);
CREATE TABLE operacion_item (
  operacion_id integer NOT NULL REFERENCES operacion(id),
  ejemplar_id integer NOT NULL REFERENCES ejemplar(id),
  origen_usuario_id integer REFERENCES usuario(id),
  destino_usuario_id integer NOT NULL REFERENCES usuario(id),
  PRIMARY KEY(operacion_id,ejemplar_id)
);
CREATE TABLE reserva_activa (
  ejemplar_id integer PRIMARY KEY REFERENCES ejemplar(id),
  operacion_id integer NOT NULL,
  FOREIGN KEY(operacion_id,ejemplar_id) REFERENCES operacion_item(operacion_id,ejemplar_id)
);
CREATE TABLE evento_operacion (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operacion_id integer NOT NULL REFERENCES operacion(id),
  actor_id integer NOT NULL REFERENCES usuario(id),
  accion text NOT NULL,
  motivo text NOT NULL DEFAULT '',
  creada_en timestamptz NOT NULL DEFAULT now()
);
