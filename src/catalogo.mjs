import { Router } from 'express';

function leerTexto(valor) {
  return typeof valor === 'string' ? valor.trim().slice(0, 80) : '';
}

function puedeConsultar(req, res, next) {
  return req.usuario.roles.some((rol) => rol === 'alumno' || rol === 'docente')
    ? next()
    : res.status(403).json({ error: 'PERMISO_INSUFICIENTE' });
}

/**
 * Rutas de lectura del catálogo de producto sobre el esquema actual.
 * No sustituyen al futuro módulo completo de Biblioteca: exponen los
 * recursos y documentos ya sembrados para que las páginas no usen los
 * datos retirados de public/local.
 */
export function rutasCatalogo(pool, sesionNecesaria, activaNecesaria) {
  const rutas = Router();

  rutas.get(
    '/biblioteca',
    sesionNecesaria,
    activaNecesaria,
    puedeConsultar,
    async (req, res) => {
      const texto = leerTexto(req.query.q);
      const resultado = await pool.query(
        `SELECT r.id,
                'biblioteca' AS seccion,
                r.titulo,
                r.tipo,
                r.edicion,
                r.asignatura,
                r.isbn,
                r.categoria_id AS "categoriaId",
                ca.nombre AS categoria,
                ca.activo AS categoria_activa,
                (SELECT COUNT(*)::int
                  FROM ejemplar e
                  WHERE e.recurso_id = r.id
                  ) AS total_ejemplares,
                (SELECT COUNT(*)::int
                  FROM ejemplar e
                  WHERE e.recurso_id = r.id
                    AND e.estado_servicio = 'habilitado'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM reserva_activa ra
                      WHERE ra.ejemplar_id = e.id
                    )
                ) AS ejemplares_disponibles,
                CASE
                  WHEN r.tipo = 'enlace' THEN r.descripcion
                  ELSE NULL
                END AS url_externa,
                COALESCE(NULLIF(r.descripcion, ''), 'Recurso del centro.') AS detalle,
                c.nombre AS curso,
                CASE
                  WHEN r.tipo = 'fisico' THEN 'prestamo'
                  WHEN r.tipo = 'digital' THEN 'consulta'
                  WHEN r.tipo = 'enlace' THEN 'enlace'
                END AS modalidad,
                CASE
                  WHEN r.tipo IN ('digital', 'enlace') THEN 'disponible'
                  WHEN EXISTS (
                    SELECT 1
                    FROM ejemplar e
                    WHERE e.recurso_id = r.id
                      AND e.estado_servicio = 'habilitado'
                      AND NOT EXISTS (
                        SELECT 1
                        FROM reserva_activa ra
                        WHERE ra.ejemplar_id = e.id
                      )
                  ) THEN 'disponible'
                  ELSE 'no disponible'
                END AS estado,
                (SELECT min(e.codigo) FROM ejemplar e WHERE e.recurso_id = r.id) AS codigo
         FROM recurso r
         LEFT JOIN curso c ON c.id = r.curso_id
         LEFT JOIN categoria ca ON ca.id = r.categoria_id
         WHERE r.origen = 'centro'
           AND ($1 = '' OR r.titulo ILIKE '%' || $1 || '%' OR r.descripcion ILIKE '%' || $1 || '%')
         ORDER BY LOWER(r.titulo), r.edicion, r.id
         LIMIT 100`,
        [texto]
      );
      res.json({ datos: resultado.rows });
    }
  );


  // T13 - Consulta individual de un recurso de Biblioteca.
  rutas.get(
    '/biblioteca/:id',
    sesionNecesaria,
    activaNecesaria,
    puedeConsultar,
    async (req, res) => {
      // 1. Validar el identificador antes de consultar la BD.
      const textoId = req.params.id;

      if (!/^[1-9]\d*$/.test(textoId)) {
        return res.status(400).json({
          error: 'ID_INVALIDO'
        });
      }

      const id = Number(textoId);

      if (!Number.isSafeInteger(id) || id > 2147483647) {
        return res.status(400).json({
          error: 'ID_INVALIDO'
        });
      }

      // 2. Buscar únicamente recursos del catálogo del centro.
      const resultado = await pool.query(
        `SELECT
           r.id,
           'biblioteca' AS seccion,
           r.titulo,
           r.tipo,
           r.descripcion,
           r.asignatura,
           r.edicion,
           r.isbn,
           r.curso_id AS "cursoId",
           r.categoria_id AS "categoriaId",
           ca.nombre AS categoria,
           ca.activo AS categoria_activa,
           c.nombre AS curso
         FROM recurso r
         LEFT JOIN curso c ON c.id = r.curso_id
         LEFT JOIN categoria ca ON ca.id = r.categoria_id
         WHERE r.id = $1
           AND r.origen = 'centro'`,
        [id]
      );

      // 3. Comprobar que el recurso existe.
      if (resultado.rowCount === 0) {
        return res.status(404).json({
          error: 'RECURSO_NO_ENCONTRADO'
        });
      }

      // 4. Consultar las copias por identificador único, no por título ni ISBN.
      // Se mantiene el historial de una categoría desactivada.
      const ejemplares = resultado.rows[0].tipo === 'fisico'
        ? (await pool.query(`SELECT e.id, e.codigo, e.estado_servicio,
             (e.estado_servicio = 'habilitado' AND NOT EXISTS (
               SELECT 1 FROM reserva_activa ra WHERE ra.ejemplar_id = e.id
             )) AS disponible
           FROM ejemplar e WHERE e.recurso_id = $1
           ORDER BY e.codigo, e.id`, [id])).rows
        : [];
      return res.status(200).json({
        datos: {...resultado.rows[0], ejemplares}
      });
    }
  );

  rutas.get(
    '/documentacion',
    sesionNecesaria,
    activaNecesaria,
    puedeConsultar,
    async (req, res) => {
      const texto = leerTexto(req.query.q);

const resultado = await pool.query(
  `SELECT d.id,
          'documentacion' AS seccion,
          'Documentos del centro' AS categoria,
          d.codigo,
          d.titulo,
          CONCAT_WS(
            ' · ',
            NULLIF(d.propietario, ''),
            NULLIF(d.procedencia, '')
          ) AS detalle,
          c.nombre AS curso,
          'documento' AS tipo,
          CASE
            WHEN a.almacenamiento_privado = true
              THEN 'descarga'
            ELSE 'consulta'
          END AS modalidad,
          d.estado_editorial AS estado,
          v.numero_version AS version,
          v.id AS version_id
   FROM documento d
   LEFT JOIN curso c
     ON c.id = d.curso_id
   JOIN documento_version v
      ON v.documento_id = d.id
    AND v.actual = true
    AND v.estado_version = 'vigente'
   LEFT JOIN archivo a
     ON a.id = v.archivo_id
   WHERE d.estado_editorial = 'publicado'
     AND (
       $1 = ''
       OR d.titulo ILIKE '%' || $1 || '%'
       OR d.codigo ILIKE '%' || $1 || '%'
     )
     AND (
       d.curso_id IS NULL
       OR d.curso_id = $2
       OR $3 = true
     )
   ORDER BY d.id
   LIMIT 100`,
  [
    texto,
    req.usuario.curso_confirmado_id,
    req.usuario.roles.includes('docente')
  ]
);

      res.json({ datos: resultado.rows });
    }
  );

  return rutas;
}
