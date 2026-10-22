-- Ejercicio didáctico de la tarea 2.3.1.
-- NO es una migración del producto: es una copia de ensayo con datos ficticios.
-- Ejecutar una sola vez en una base vacía, por ejemplo aula_circular_ensayo_231.
-- No contiene contraseñas ni datos reales.

BEGIN;

CREATE TABLE recurso (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo text NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 120),
  estado_editorial text NOT NULL DEFAULT 'publicado'
    CHECK (estado_editorial IN ('publicado', 'retirado'))
);

CREATE TABLE ejemplar (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recurso_id integer NOT NULL REFERENCES recurso(id),
  codigo text NOT NULL UNIQUE CHECK (length(trim(codigo)) BETWEEN 1 AND 40),
  estado_servicio text NOT NULL DEFAULT 'habilitado'
    CHECK (estado_servicio IN ('habilitado', 'retirado'))
);

CREATE TABLE operacion (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('prestamo', 'cesion', 'intercambio')),
  estado text NOT NULL CHECK (estado IN ('reservada', 'prestada', 'completada', 'cancelada'))
);

CREATE TABLE operacion_item (
  operacion_id integer NOT NULL REFERENCES operacion(id),
  ejemplar_id integer NOT NULL REFERENCES ejemplar(id),
  PRIMARY KEY (operacion_id, ejemplar_id)
);

CREATE TABLE reserva_activa (
  ejemplar_id integer PRIMARY KEY REFERENCES ejemplar(id),
  operacion_id integer NOT NULL,
  FOREIGN KEY (operacion_id, ejemplar_id)
    REFERENCES operacion_item(operacion_id, ejemplar_id)
);

-- RC03: un recurso de catálogo con dos ejemplares físicos.
INSERT INTO recurso (titulo) VALUES ('Manual de SQL');

INSERT INTO ejemplar (recurso_id, codigo)
VALUES (1, 'EJ03'), (1, 'EJ04');

-- EJ04 está ocupado por una operación con reserva vigente; EJ03 queda libre.
INSERT INTO operacion (tipo, estado) VALUES ('prestamo', 'prestada');
INSERT INTO operacion_item (operacion_id, ejemplar_id) VALUES (1, 2);
INSERT INTO reserva_activa (ejemplar_id, operacion_id) VALUES (2, 1);

-- EJ03 tiene una operación histórica cerrada, pero ninguna reserva vigente.
-- Esa diferencia es la que permite explicar que el historial no ocupa el ejemplar.
INSERT INTO operacion (tipo, estado) VALUES ('prestamo', 'completada');
INSERT INTO operacion_item (operacion_id, ejemplar_id) VALUES (2, 1);

-- Variación del paso 3: descomenta esta línea para añadir un tercer ejemplar.
-- Predice antes de ejecutar: el JOIN pasará de 2 a 3 filas y la disponibilidad de 1 a 2.
-- INSERT INTO ejemplar (recurso_id, codigo) VALUES (1, 'EJ09');

COMMIT;
