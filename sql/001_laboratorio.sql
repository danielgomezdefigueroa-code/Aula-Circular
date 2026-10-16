-- Inicialización del laboratorio: ejecutar una vez en una base nueva.
-- No es idempotente: repetirlo falla si la tabla ya existe.
-- La aplicación se conecta como aula_app, propietario de aula_circular.
CREATE TABLE recurso_demo (
  -- Identificador automático y único.
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Rechaza NULL, títulos vacíos y longitudes fuera de 1 a 120.
  titulo text NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 120),
  -- Solo acepta las tres categorías previstas.
  tipo text NOT NULL CHECK (tipo IN ('fisico', 'digital', 'enlace'))
);

-- Datos sintéticos para practicar. El UPDATE local de un título no se exporta aquí.
INSERT INTO recurso_demo (titulo, tipo)
VALUES ('Calculadora científica de ejemplo', 'fisico'),
       ('Guía de prácticas de ejemplo', 'digital');
