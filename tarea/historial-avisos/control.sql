-- $1: ID del actor ficticio que se contrasta; no procede del navegador.
-- Cuenta operaciones, no eventos ni ítems. Solo consulta; sin escrituras.
SELECT o.tipo, o.estado, count(*)::integer AS total
FROM operacion o
WHERE EXISTS (
  SELECT 1 FROM operacion_item i
  WHERE i.operacion_id=o.id
    AND (i.origen_usuario_id=$1 OR i.destino_usuario_id=$1)
)
GROUP BY o.tipo,o.estado
ORDER BY o.tipo,o.estado;
