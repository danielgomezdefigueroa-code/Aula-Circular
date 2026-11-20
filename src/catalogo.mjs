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
                CONCAT_WS(' · ', NULLIF(d.propietario, ''), NULLIF(d.procedencia, '')) AS detalle,
                c.nombre AS curso,
                'documento' AS tipo,
                'descarga' AS modalidad,
                'publicado' AS estado,
                v.numero_version AS version
         FROM documento d
         LEFT JOIN curso c ON c.id = d.curso_id
         LEFT JOIN documento_version v
           ON v.documento_id = d.id AND v.actual
         WHERE ($1 = '' OR d.titulo ILIKE '%' || $1 || '%' OR d.codigo ILIKE '%' || $1 || '%')
         ORDER BY d.id
         LIMIT 100`,
        [texto]
      );
      res.json({ datos: resultado.rows });
    }
  );
	    // Ejercicio didáctico: consulta por ID con validación y ausencia controlada.
  // Solo se habilita en desarrollo y mantiene los controles de acceso.
  if (process.env.NODE_ENV === 'development') {
    rutas.get(
      '/ensayo/recursos/:id',
      sesionNecesaria,
      activaNecesaria,
      puedeConsultar,
      async (req, res) => {
        const texto = req.params.id;
        const id = Number(texto);

        if (
          !/^[1-9]\d*$/.test(texto) ||
          !Number.isSafeInteger(id) ||
          id > 2147483647
        ) {
          return res.status(422).json({
            error: 'DATOS_INVALIDOS'
          });
        }

        const resultado = await pool.query(
          `SELECT id, titulo, tipo
           FROM recurso
           WHERE id = $1 AND origen = 'centro'`,
          [id]
        );
		// Una consulta sin filas es una ausencia esperada, no un fallo interno.
        if (resultado.rowCount === 0) {
          return res.status(404).json({
            error: 'RECURSO_NO_DISPONIBLE'
          });
        }

        const recurso = resultado.rows[0];

        res.json({
          datos: {
            id: recurso.id,
            titulo: recurso.titulo,
            tipo: recurso.tipo
          }
        });
      }
    );
  }
  return rutas;
}
