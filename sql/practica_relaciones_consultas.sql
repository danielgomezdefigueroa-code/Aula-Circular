-- Consulta inicial.
-- Esperado y observado: dos filas, ejemplares 101 y 102.
SELECT r.titulo, e.id AS ejemplar_id, e.codigo
FROM practica_relaciones.recurso AS r
JOIN practica_relaciones.ejemplar AS e
  ON e.recurso_id = r.id
ORDER BY e.id;

-- Variación: seleccionar una unidad concreta.
-- Esperado y observado: una fila, ejemplar 102.
SELECT r.titulo, e.id AS ejemplar_id, e.codigo
FROM practica_relaciones.recurso AS r
JOIN practica_relaciones.ejemplar AS e
  ON e.recurso_id = r.id
WHERE e.id = 102
ORDER BY e.id;