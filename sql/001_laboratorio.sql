CREATE TABLE recurso_demo (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo text NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 120),
  tipo text NOT NULL CHECK (tipo IN ('fisico', 'digital', 'enlace'))
);

INSERT INTO recurso_demo (titulo, tipo)
VALUES ('Calculadora científica de ejemplo', 'fisico'),
       ('Guía de prácticas de ejemplo', 'digital');
