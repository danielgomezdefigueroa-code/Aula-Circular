-- Sprint 4, plan 370: ampliar las operaciones existentes, no duplicarlas.
-- Aplicar con scripts/migrar.mjs despues de 006, en un entorno de ensayo.
-- El ejecutor ya proporciona BEGIN/COMMIT; este archivo no abre otra transaccion.

-- La operacion comun conserva estado e historial. Aqui fijamos el acuerdo exacto.
CREATE TABLE intercambio (
  operacion_id integer PRIMARY KEY REFERENCES operacion(id),
  proponente_id integer NOT NULL REFERENCES usuario(id),
  receptor_id integer NOT NULL REFERENCES usuario(id),
  ejemplar_ofrecido_id integer NOT NULL REFERENCES ejemplar(id),
  ejemplar_solicitado_id integer NOT NULL REFERENCES ejemplar(id),
  anuncio_ofrecido_id integer NOT NULL REFERENCES anuncio(id),
  anuncio_solicitado_id integer NOT NULL REFERENCES anuncio(id),
  version_ofrecida integer NOT NULL CHECK (version_ofrecida > 0),
  version_solicitada integer NOT NULL CHECK (version_solicitada > 0),
  CHECK (proponente_id <> receptor_id),
  CHECK (ejemplar_ofrecido_id <> ejemplar_solicitado_id),
  CHECK (anuncio_ofrecido_id <> anuncio_solicitado_id),
  FOREIGN KEY (operacion_id, ejemplar_ofrecido_id)
    REFERENCES operacion_item(operacion_id, ejemplar_id),
  FOREIGN KEY (operacion_id, ejemplar_solicitado_id)
    REFERENCES operacion_item(operacion_id, ejemplar_id)
);

-- Una aceptacion autenticada por participante; no se recibe usuarioId del cliente.
-- Las aceptaciones antiguas se conservan como historial si el acuerdo se cancela.
CREATE TABLE aceptacion_intercambio (
  operacion_id integer NOT NULL REFERENCES intercambio(operacion_id),
  usuario_id integer NOT NULL REFERENCES usuario(id),
  aceptada_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operacion_id, usuario_id)
);

-- Propiedad, modalidad, dos participantes, versiones y permisos se revalidaran
-- en el servicio transaccional. Estas claves no sustituyen esos controles.
