-- Sprint 2: almacenamiento persistente de sesiones.
-- Ejecutar una sola vez sobre la base de ensayo.
BEGIN;

CREATE TABLE public.sesion (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX sesion_expire_idx ON public.sesion (expire);

COMMIT;