-- Sprint 3, plan 370: estructura para solicitudes y prestamos.
-- Aplicar UNA VEZ, solo en la base de ensayo del Sprint 3.
-- Requiere usuario (002) y ejemplar (005). No modifica sus tablas ni datos.
-- La validacion de cuenta, propiedad, modalidad y permisos corresponde al servidor.
BEGIN;

DO $$
BEGIN
  IF current_database() <> 'aula_circular_sprint3_ensayo' THEN
    RAISE EXCEPTION 'Usa exclusivamente aula_circular_sprint3_ensayo';
  END IF;
END;
$$;

-- 1. Pedir no reserva. Dos alumnos pueden pedir el mismo ejemplar.
CREATE TABLE solicitud (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejemplar_id integer NOT NULL REFERENCES ejemplar(id),
  solicitante_id integer NOT NULL REFERENCES usuario(id),
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'asignada', 'rechazada', 'cancelada')),
  creada_en timestamptz NOT NULL DEFAULT now()
);

-- Un alumno no debe duplicar su propia solicitud pendiente.
CREATE UNIQUE INDEX una_solicitud_pendiente
  ON solicitud (solicitante_id, ejemplar_id)
  WHERE estado = 'pendiente';

-- 2. La asignacion docente crea una operacion reservada.
-- El vencimiento es una fecha de calendario, no una hora del navegador.
CREATE TABLE operacion (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo text NOT NULL DEFAULT 'prestamo' CHECK (tipo = 'prestamo'),
  estado text NOT NULL DEFAULT 'reservada'
    CHECK (estado IN ('reservada', 'prestada', 'completada', 'cancelada', 'cerrada_por_incidencia')),
  docente_id integer NOT NULL REFERENCES usuario(id),
  vencimiento date NOT NULL,
  creada_en timestamptz NOT NULL DEFAULT now(),
  entregada_en timestamptz,
  cerrada_en timestamptz,
  CHECK (entregada_en IS NULL OR
    vencimiento >= (entregada_en AT TIME ZONE 'Europe/Madrid')::date),
  CHECK (estado NOT IN ('prestada', 'completada', 'cerrada_por_incidencia') OR entregada_en IS NOT NULL),
  CHECK (estado NOT IN ('completada', 'cancelada', 'cerrada_por_incidencia') OR cerrada_en IS NOT NULL)
);

-- 3. Conserva que ejemplar y participantes pertenecen a la operacion.
-- Origen nulo significa que el ejemplar pertenece al centro.
CREATE TABLE operacion_item (
  operacion_id integer NOT NULL REFERENCES operacion(id),
  ejemplar_id integer NOT NULL REFERENCES ejemplar(id),
  origen_usuario_id integer REFERENCES usuario(id),
  destino_usuario_id integer NOT NULL REFERENCES usuario(id),
  PRIMARY KEY (operacion_id, ejemplar_id)
);

-- 4. Una sola reserva activa por ejemplar, vinculada a su operacion real.
CREATE TABLE reserva_activa (
  ejemplar_id integer PRIMARY KEY REFERENCES ejemplar(id),
  operacion_id integer NOT NULL,
  FOREIGN KEY (operacion_id, ejemplar_id)
    REFERENCES operacion_item (operacion_id, ejemplar_id)
);

-- 5. El historial permite comprobar asignacion y entrega sin duplicarlas.
CREATE TABLE evento_operacion (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operacion_id integer NOT NULL REFERENCES operacion(id),
  actor_id integer NOT NULL REFERENCES usuario(id),
  accion text NOT NULL CHECK (accion IN ('asignada', 'entregada', 'devuelta', 'cancelada', 'cerrada_por_incidencia')),
  fecha timestamptz NOT NULL DEFAULT now(),
  motivo text CHECK (length(motivo) <= 200),
  UNIQUE (operacion_id, accion)
);

-- 6. Los avisos acompanian a las solicitudes y operaciones.
CREATE TABLE aviso (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  destinatario_id integer NOT NULL REFERENCES usuario(id),
  solicitud_id integer REFERENCES solicitud(id),
  operacion_id integer REFERENCES operacion(id),
  tipo text NOT NULL CHECK (tipo IN ('solicitud_asignada', 'solicitud_rechazada', 'prestamo_entregado')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  leido_en timestamptz,
  CHECK (solicitud_id IS NOT NULL OR operacion_id IS NOT NULL)
);

COMMIT;
