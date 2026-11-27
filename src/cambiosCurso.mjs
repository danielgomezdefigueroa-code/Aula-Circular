import { Router } from 'express';

const idValido = id => Number.isInteger(id) && id > 0 && id <= 2147483647;

async function transaccion(pool, ejecutar) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await ejecutar(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

async function cuentasBloqueadas(cliente, ids) {
  const { rows } = await cliente.query(`
    SELECT u.id, u.estado, u.auth_version, u.curso_confirmado_id,
      ARRAY(SELECT rol FROM usuario_rol WHERE usuario_id = u.id) AS roles
    FROM usuario u WHERE u.id = ANY($1::integer[]) ORDER BY u.id FOR UPDATE OF u
  `, [ids]);
  return rows;
}

const vigente = (cuenta, req, rol) => cuenta?.estado === 'activo' &&
  cuenta.auth_version === req.session.authVersion && cuenta.roles.includes(rol);

async function cursoActivo(cliente, id) {
  const { rows } = await cliente.query('SELECT nombre FROM curso WHERE id = $1 AND activo FOR SHARE', [id]);
  return rows[0];
}

export function rutasCambiosCurso(pool, sesionNecesaria, activaNecesaria) {
  const rutas = Router();
  const autorizar = rol => [
    sesionNecesaria, activaNecesaria,
    (req, res, next) => req.usuario.roles.includes(rol)
      ? next() : res.status(403).json({ error: 'PERMISO_INSUFICIENTE' })
  ];

  rutas.get('/mi-espacio/cambio-curso', ...autorizar('alumno'), async (req, res) => {
    const { rows } = await pool.query(`
      SELECT x.id, d.nombre AS destino, x.curso_destino_id
      FROM cambio_curso x JOIN curso d ON d.id = x.curso_destino_id
      WHERE x.usuario_id = $1 AND x.confirmada_en IS NULL
    `, [req.usuario.id]);
    res.json({ datos: rows[0] ?? null });
  });

  rutas.post('/mi-espacio/cambio-curso', ...autorizar('alumno'), async (req, res) => {
    const cursoId = req.body?.cursoId;
    if (!idValido(cursoId) || Object.keys(req.body).length !== 1) {
      return res.status(422).json({ error: 'CURSO_INVALIDO' });
    }

    const [estado, cuerpo] = await transaccion(pool, async cliente => {
      const [alumno] = await cuentasBloqueadas(cliente, [req.usuario.id]);
      if (!vigente(alumno, req, 'alumno')) return [403, { error: 'PERMISO_INSUFICIENTE' }];
      if (!alumno.curso_confirmado_id || alumno.curso_confirmado_id === cursoId) {
        return [422, { error: 'CURSO_INVALIDO' }];
      }

      const { rows: [pendiente] } = await cliente.query(`
        SELECT id, curso_destino_id FROM cambio_curso
        WHERE usuario_id = $1 AND confirmada_en IS NULL
      `, [alumno.id]);
      if (pendiente) {
        return pendiente.curso_destino_id === cursoId
          ? [200, { datos: pendiente }] : [409, { error: 'CAMBIO_YA_PENDIENTE' }];
      }
      if (!await cursoActivo(cliente, cursoId)) return [422, { error: 'CURSO_INVALIDO' }];

      const { rows: [cambio] } = await cliente.query(`
        INSERT INTO cambio_curso (usuario_id, curso_origen_id, curso_destino_id)
        VALUES ($1, $2, $3) RETURNING id, curso_destino_id
      `, [alumno.id, alumno.curso_confirmado_id, cursoId]);
      return [201, { datos: cambio }];
    });
    res.status(estado).json(cuerpo);
  });

  rutas.get('/gestion/cambios-curso', ...autorizar('docente'), async (req, res) => {
    const pagina = Number(req.query.pagina ?? 1);
    if (!idValido(pagina) || pagina > 100000) {
      return res.status(422).json({ error: 'PAGINACION_INVALIDA' });
    }
    const { rows } = await pool.query(`
      SELECT x.id, u.alias, o.nombre AS origen, d.nombre AS destino,
        x.solicitada_en, x.confirmada_en, docente.alias AS confirmada_por,
        COALESCE(operaciones.datos, '[]'::json) AS operaciones
      FROM cambio_curso x
      JOIN usuario u ON u.id = x.usuario_id
      JOIN curso o ON o.id = x.curso_origen_id
      JOIN curso d ON d.id = x.curso_destino_id
      LEFT JOIN usuario docente ON docente.id = x.confirmada_por
      LEFT JOIN LATERAL (
        SELECT json_agg(row_to_json(a) ORDER BY a.id) AS datos
        FROM (
          SELECT op.id, op.tipo, op.estado, op.vencimiento
          FROM operacion op
          WHERE op.estado IN ('propuesta', 'reservada', 'prestada')
            AND EXISTS (
              SELECT 1 FROM operacion_item i WHERE i.operacion_id = op.id
              AND (i.origen_usuario_id = u.id OR i.destino_usuario_id = u.id)
            )
        ) a
      ) operaciones ON true
      ORDER BY (x.confirmada_en IS NOT NULL), x.id DESC LIMIT 21 OFFSET $1
    `, [(pagina - 1) * 20]);
    res.json({ datos: rows.slice(0, 20), siguiente: rows.length > 20 });
  });

  rutas.post('/gestion/cambios-curso/:id/confirmar', ...autorizar('docente'), async (req, res) => {
    const id = Number(req.params.id);
    if (!idValido(id)) return res.status(422).json({ error: 'ID_INVALIDO' });

    const [estado, cuerpo] = await transaccion(pool, async cliente => {
      const { rows: [referencia] } = await cliente.query('SELECT usuario_id FROM cambio_curso WHERE id = $1', [id]);
      if (!referencia) return [404, { error: 'CAMBIO_NO_ENCONTRADO' }];
      const cuentas = await cuentasBloqueadas(cliente, [req.usuario.id, referencia.usuario_id]);
      const actor = cuentas.find(cuenta => cuenta.id === req.usuario.id);
      const alumno = cuentas.find(cuenta => cuenta.id === referencia.usuario_id);
      if (!vigente(actor, req, 'docente') || actor.id === alumno?.id) {
        return [403, { error: 'PERMISO_INSUFICIENTE' }];
      }
      const { rows: [cambio] } = await cliente.query('SELECT * FROM cambio_curso WHERE id = $1', [id]);
      if (cambio.confirmada_en || alumno?.estado !== 'activo' || !alumno.roles.includes('alumno') ||
          alumno.curso_confirmado_id !== cambio.curso_origen_id) {
        return [409, { error: 'CAMBIO_NO_CONFIRMABLE' }];
      }
      const destino = await cursoActivo(cliente, cambio.curso_destino_id);
      if (!destino) return [409, { error: 'CURSO_NO_DISPONIBLE' }];

      // La misma sesión conserva su identidad y relee el curso en cada petición.
      await cliente.query('UPDATE usuario SET curso_confirmado_id = $1 WHERE id = $2',
        [cambio.curso_destino_id, alumno.id]);
      const { rows: [confirmacion] } = await cliente.query(`
        UPDATE cambio_curso SET confirmada_por = $1, confirmada_en = now()
        WHERE id = $2 RETURNING id, confirmada_por, confirmada_en
      `, [actor.id, id]);
      await cliente.query('INSERT INTO aviso (destinatario_id, mensaje, cambio_curso_id) VALUES ($1, $2, $3)',
        [alumno.id, 'El profesorado ha confirmado tu cambio de curso a ' + destino.nombre + '.', id]);
      return [200, { datos: confirmacion }];
    });
    res.status(estado).json(cuerpo);
  });

  return rutas;
}
