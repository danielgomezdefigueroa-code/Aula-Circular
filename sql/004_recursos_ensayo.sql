-- Recursos ficticios para comprobar el catálogo protegido de Sprint2.
BEGIN;

CREATE TABLE recurso_demo (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo text NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 120),
  tipo text NOT NULL CHECK (tipo IN ('fisico', 'digital', 'enlace'))
);

INSERT INTO recurso_demo (titulo, tipo)
VALUES ('Calculadora de ensayo', 'fisico'),
       ('Guia de ensayo', 'digital');

COMMIT;