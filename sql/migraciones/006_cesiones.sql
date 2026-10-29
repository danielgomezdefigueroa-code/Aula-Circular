CREATE TABLE solicitud (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ejemplar_id integer NOT NULL REFERENCES ejemplar(id),
 solicitante_id integer NOT NULL REFERENCES usuario(id),
 estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','adjudicada','rechazada','cancelada')),
 creada_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX una_solicitud_pendiente ON solicitud(solicitante_id,ejemplar_id) WHERE estado='pendiente';
CREATE TABLE aviso (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 destinatario_id integer NOT NULL REFERENCES usuario(id),
 mensaje text NOT NULL,
 operacion_id integer REFERENCES operacion(id),
 creado_en timestamptz NOT NULL DEFAULT now()
);
