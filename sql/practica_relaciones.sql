-- Ejercicio aislado de relaciones. Ejecutar una sola vez.
BEGIN;

CREATE SCHEMA practica_relaciones;

CREATE TABLE practica_relaciones.recurso (
  id integer PRIMARY KEY,
  titulo text NOT NULL
);

CREATE TABLE practica_relaciones.ejemplar (
  id integer PRIMARY KEY,
  codigo text NOT NULL UNIQUE,
  recurso_id integer NOT NULL
    REFERENCES practica_relaciones.recurso(id)
);

INSERT INTO practica_relaciones.recurso (id, titulo)
VALUES (1, 'Manual de bases de datos');

INSERT INTO practica_relaciones.ejemplar (id, codigo, recurso_id)
VALUES
  (101, 'MAN-001', 1),
  (102, 'MAN-002', 1);

COMMIT;