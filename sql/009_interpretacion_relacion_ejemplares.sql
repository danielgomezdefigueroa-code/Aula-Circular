-- ============================================================
-- AULA CIRCULAR
-- Área: Biblioteca y Documentos
-- Base de ensayo: aula_circular_sprint2_ensayo
-- ============================================================

-- 1. CONSULTA GENERAL
-- Relaciona recurso.id con ejemplar.recurso_id.
-- Esperado: 3 filas (CAL-001, MAN-001 y MAN-002).
-- Observado: 3 filas.

SELECT
    r.titulo,
    e.id AS ejemplar_id,
    e.codigo
FROM recurso AS r
JOIN ejemplar AS e
    ON e.recurso_id = r.id
ORDER BY r.titulo, e.codigo;


-- 2. VARIACIÓN: FILTRO POR TÍTULO
-- Solo muestra los ejemplares de Manual de SQL.
-- Esperado: 2 filas.
-- Observado: 2 filas (MAN-001 y MAN-002).

SELECT
    r.titulo,
    e.id AS ejemplar_id,
    e.codigo
FROM recurso AS r
JOIN ejemplar AS e
    ON e.recurso_id = r.id
WHERE r.titulo = 'Manual de SQL'
ORDER BY e.codigo;


-- 3. COMPROBACIÓN DE TABLAS DE RESERVAS
-- Esperado: ninguna tabla en la implementación actual.
-- Observado: 0 filas.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
      'reserva_activa',
      'operacion',
      'operacion_item'
  )
ORDER BY table_name;


-- 4. CONSULTA DE ESTADOS ACTUALES
-- Muestra el estado registrado en cada ejemplar.
-- No demuestra por sí sola ausencia de reserva activa.

SELECT
    r.titulo,
    e.codigo,
    e.estado_servicio
FROM recurso AS r
JOIN ejemplar AS e
    ON e.recurso_id = r.id
ORDER BY r.titulo, e.codigo;

-- NOTA:
-- La consulta de disponibilidad con reserva_activa se interpreta a partir de la guía Datos y estados.
-- No se ejecuta aquí porque reserva_activa todavía no existe en esta base de datos.
