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
                COALESCE(NULLIF(r.descripcion, ''), 'Recurso del centro.') AS detalle,
                c.nombre AS curso,
                'prestamo' AS modalidad,
                CASE
                  WHEN r.tipo IN ('digital', 'enlace') THEN 'disponible'
                  WHEN EXISTS (
                    SELECT 1 FROM ejemplar e
                    WHERE e.recurso_id = r.id AND e.estado_servicio = 'habilitado'
                  ) THEN 'disponible'
                  ELSE 'no disponible'
                END AS estado,
                (SELECT min(e.codigo) FROM ejemplar e WHERE e.recurso_id = r.id) AS codigo
         FROM recurso r
         LEFT JOIN curso c ON c.id = r.curso_id
         WHERE r.origen = 'centro'
           AND ($1 = '' OR r.titulo ILIKE '%' || $1 || '%' OR r.descripcion ILIKE '%' || $1 || '%')
         ORDER BY r.id
         LIMIT 100`,
        [texto]
      );
      res.json({ datos: resultado.rows });
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
          v.numero_version AS version
   FROM documento d
   LEFT JOIN curso c
     ON c.id = d.curso_id
   LEFT JOIN documento_version v
     ON v.documento_id = d.id
    AND v.actual = true
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
