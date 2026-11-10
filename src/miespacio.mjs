import { Router } from 'express';

const idValido = valor => Number.isSafeInteger(valor) && valor > 0;
const limiteValido = valor => idValido(valor) && valor <= 20;

import { crearTarjetaAnuncio, erroresAValidacion, formatoRespuestaAnuncio, crearRespuestaEstados, leerParamsSeguros, validarIdParametro, construirSeleccionAnuncio } from './anuncios.mjs';

function limpiar(filas) {
  return filas.map(crearTarjetaAnuncio);
}

function recuento(filas) {
  return {
    total: filas[0]?.total ?? 0,
    pendientes: filas[0]?.pendientes ?? 0,
    requieren_accion: filas[0]?.requieren_accion ?? 0
  };
}

// Resumen de Mi espacio. El propietario sale siempre de la sesión:
// no se admite usuarioId, propietarioId ni ningún selector equivalente.
export function rutasMiEspacio(pool, sesionNecesaria, activaNecesaria) {
  const rutas = Router();

  rutas.get('/mi-espacio/panel', sesionNecesaria, activaNecesaria, async (req, res) => {
    const limite = Number(req.query.limite ?? 20);
    if (Object.keys(req.query).some(campo => campo !== 'limite') || !limiteValido(limite)) {
      return res.status(422).json({ error: 'PARAMETROS_INVALIDOS' });
    }

    const usuarioId = req.usuario.id;

    const [publicaciones, solicitudes, prestamos, avisos] = await Promise.all([
      pool.query(`
        SELECT a.id, a.ejemplar_id, a.modalidad, a.estado_revision, a.motivo, a.version,
          a.creada_en, a.actualizada_en, r.titulo, c.nombre AS curso, e.codigo,
          (a.estado_revision IN ('borrador', 'rechazado')) AS requiere_accion,
          (a.estado_revision IN ('borrador', 'pendiente', 'rechazado')) AS pendiente,
          count(*) OVER ()::integer AS total,
          count(*) FILTER (WHERE a.estado_revision IN ('borrador', 'pendiente', 'rechazado'))
            OVER ()::integer AS pendientes,
          count(*) FILTER (WHERE a.estado_revision IN ('borrador', 'rechazado'))
            OVER ()::integer AS requieren_accion
        FROM anuncio a
        JOIN ejemplar e ON e.id = a.ejemplar_id
        JOIN recurso r ON r.id = e.recurso_id
        JOIN curso c ON c.id = r.curso_id
        WHERE e.propietario_usuario_id = $1
        ORDER BY requiere_accion DESC, pendiente DESC, a.actualizada_en DESC, a.id DESC
        LIMIT $2
      `, [usuarioId, limite]),

      pool.query(`
        SELECT s.id, s.ejemplar_id, s.estado, s.creada_en, r.titulo, c.nombre AS curso,
          e.codigo, a.modalidad,
          (s.estado = 'pendiente') AS requiere_accion,
          (s.estado = 'pendiente') AS pendiente,
          count(*) OVER ()::integer AS total,
          count(*) FILTER (WHERE s.estado = 'pendiente') OVER ()::integer AS pendientes,
          count(*) FILTER (WHERE s.estado = 'pendiente') OVER ()::integer AS requieren_accion
        FROM solicitud s
        JOIN ejemplar e ON e.id = s.ejemplar_id
        JOIN recurso r ON r.id = e.recurso_id
        JOIN curso c ON c.id = r.curso_id
        LEFT JOIN anuncio a ON a.ejemplar_id = e.id
        WHERE s.solicitante_id = $1
        ORDER BY requiere_accion DESC, pendiente DESC, s.creada_en DESC, s.id DESC
        LIMIT $2
      `, [usuarioId, limite]),

      pool.query(`
        WITH base AS (
          SELECT o.id, o.tipo, o.estado, o.creada_en, o.vencimiento, o.entregada_en, o.cerrada_en,
            (o.tipo = 'intercambio' AND o.estado = 'propuesta' AND EXISTS (
              SELECT 1 FROM intercambio i
              WHERE i.operacion_id = o.id AND i.receptor_id = $1
            ) AND NOT EXISTS (
              SELECT 1 FROM aceptacion_intercambio a
              WHERE a.operacion_id = o.id AND a.usuario_id = $1
            )) AS requiere_accion,
            (o.estado IN ('propuesta', 'reservada', 'prestada')) AS pendiente,
            (SELECT count(*)::int FROM aceptacion_intercambio a
             WHERE a.operacion_id = o.id) AS aceptaciones,
            CASE
              WHEN o.tipo = 'intercambio' THEN 'intercambio'
              WHEN EXISTS (
                SELECT 1 FROM operacion_item i
                WHERE i.operacion_id = o.id AND i.origen_usuario_id = $1
              ) THEN 'origen'
              ELSE 'destino'
            END AS rol,
            COALESCE((
              SELECT string_agg(r.titulo, ' · ' ORDER BY i.ejemplar_id)
              FROM operacion_item i
              JOIN ejemplar e ON e.id = i.ejemplar_id
              JOIN recurso r ON r.id = e.recurso_id
              WHERE i.operacion_id = o.id
            ), '') AS titulos,
            COALESCE((
              SELECT array_agg(i.ejemplar_id ORDER BY i.ejemplar_id)
              FROM operacion_item i
              WHERE i.operacion_id = o.id
            ), ARRAY[]::integer[]) AS ejemplares
          FROM operacion o
          WHERE EXISTS (
            SELECT 1 FROM operacion_item i
            WHERE i.operacion_id = o.id
              AND (i.origen_usuario_id = $1 OR i.destino_usuario_id = $1)
          )
        )
        SELECT base.*, count(*) OVER ()::integer AS total,
          count(*) FILTER (WHERE pendiente) OVER ()::integer AS pendientes,
          count(*) FILTER (WHERE requiere_accion) OVER ()::integer AS requieren_accion
        FROM base
        ORDER BY requiere_accion DESC, pendiente DESC, creada_en DESC, id DESC
        LIMIT $2
      `, [usuarioId, limite]),

      pool.query(`
        SELECT a.id, a.mensaje, a.creado_en, a.leido,
          count(*) OVER ()::integer AS total
      FROM aviso a
      WHERE a.destinatario_id = $1
      ORDER BY a.creado_en DESC, a.id DESC
      LIMIT $2
    `, [usuarioId, limite])
    ]);

    res.json({
      datos: {
        publicaciones: limpiar(publicaciones.rows),
        solicitudes: limpiar(solicitudes.rows),
        prestamos: limpiar(prestamos.rows),
        avisos: limpiar(avisos.rows.map(a => ({ ...a, leido: a.leido === true })))
      },
      totales: {
        publicaciones: recuento(publicaciones.rows),
        solicitudes: recuento(solicitudes.rows),
        prestamos: recuento(prestamos.rows),
        avisos: recuento(avisos.rows)
      }
    });
  });

  return rutas;
}
