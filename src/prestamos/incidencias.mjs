import { Router } from 'express';

const fallo = (codigo, mensaje) =>
  Object.assign(new Error(mensaje), { codigo });

async function conPrestamoEntregado(pool, identidad, id, ejecutar) {
  const c = await pool.connect();

  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout='3s'");

    const docente = (await c.query(
      'SELECT estado, auth_version FROM usuario WHERE id=$1 FOR SHARE',
      [identidad.id]
    )).rows[0];

    if (!docente || docente.auth_version !== identidad.authVersion) {
      throw fallo(401, 'SESION_CADUCADA');
    }

    const rol = await c.query(
      "SELECT 1 FROM usuario_rol WHERE usuario_id=$1 AND rol='docente' FOR SHARE",
      [identidad.id]
    );

    if (docente.estado !== 'activo' || !rol.rowCount) {
      throw fallo(403, 'PERMISO_INSUFICIENTE');
    }

    // Mismo orden que la devolución: ejemplar, anuncio, operación,
    // ítem, reserva e incidencia. Todos los pasos usan el mismo cliente.
    const referencias = await c.query(
      'SELECT ejemplar_id FROM operacion_item WHERE operacion_id=$1 ORDER BY ejemplar_id',
      [id]
    );

    if (!referencias.rowCount) {
      throw fallo(404, 'OPERACION_NO_DISPONIBLE');
    }

    const ids = referencias.rows.map(i => i.ejemplar_id);
    const ejemplares = await c.query(
      'SELECT * FROM ejemplar WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE',
      [ids]
    );

    const anuncios = await c.query(
      'SELECT * FROM anuncio WHERE ejemplar_id=ANY($1::integer[]) ORDER BY ejemplar_id FOR UPDATE',
      [ids]
    );

    const operacion = (await c.query(
      'SELECT * FROM operacion WHERE id=$1 FOR UPDATE', [id]
    )).rows[0];

    if (!operacion) throw fallo(404, 'OPERACION_NO_DISPONIBLE');

    if (operacion.tipo !== 'prestamo' ||
        operacion.estado !== 'prestada' ||
        !operacion.entregada_en ||
        !operacion.vencimiento ||
        operacion.cerrada_en) {
      throw fallo(409, 'PRESTAMO_NO_INCIDENCIABLE');
    }

    const items = await c.query(
      'SELECT * FROM operacion_item WHERE operacion_id=$1 ORDER BY ejemplar_id FOR UPDATE',
      [id]
    );

    const ejemplar = ejemplares.rows[0];
    const item = items.rows[0];

    if (ejemplares.rowCount !== 1 || items.rowCount !== 1 ||
        ejemplar.id !== item.ejemplar_id) {
      throw fallo(409, 'OPERACION_INCOHERENTE');
    }

    const reservas = await c.query(
      `SELECT ejemplar_id, operacion_id FROM reserva_activa
       WHERE operacion_id=$1 OR ejemplar_id=$2
       ORDER BY ejemplar_id FOR UPDATE`,
      [id, ejemplar.id]
    );

    if (reservas.rowCount !== 1 ||
        reservas.rows[0].operacion_id !== id ||
        reservas.rows[0].ejemplar_id !== ejemplar.id) {
      throw fallo(409, 'RESERVA_INCOHERENTE');
    }

    const abiertas = await c.query(
      `SELECT * FROM incidencia
       WHERE operacion_id=$1 AND estado='abierta'
       ORDER BY id FOR UPDATE`,
      [id]
    );

    const datos = await ejecutar(c, {
      operacion, ejemplar, item, anuncios: anuncios.rows, abiertas
    });

    await c.query('COMMIT');
    return datos;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});

    if (['23505', '55P03', '40P01'].includes(error.code)) {
      throw fallo(409, 'CONFLICTO_RECARGA_EL_ESTADO');
    }

    throw error;
  } finally {
    c.release();
  }
}

export function abrirIncidencia(pool, identidad, id, entrada) {
  return conPrestamoEntregado(pool, identidad, id, async (c, contexto) => {
    const { ejemplar, item, abiertas } = contexto;

    if (abiertas.rowCount) throw fallo(409, 'INCIDENCIA_PENDIENTE');

    const incidencia = (await c.query(
      `INSERT INTO incidencia
        (operacion_id, ejemplar_id, autor_id, tipo, descripcion)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, operacion_id, ejemplar_id, tipo, estado`,
      [id, ejemplar.id, identidad.id, entrada.tipo, entrada.descripcion.trim()]
    )).rows[0];

    await c.query(
      `INSERT INTO evento_operacion (operacion_id, actor_id, accion, motivo)
       VALUES ($1,$2,'abrir_incidencia',$3)`,
      [id, identidad.id, entrada.tipo]
    );

    const destinatarios = new Set(
      [item.origen_usuario_id, item.destino_usuario_id].filter(x => x !== null)
    );

    for (const usuarioId of destinatarios) {
      await c.query(
        'INSERT INTO aviso(destinatario_id,mensaje,operacion_id) VALUES($1,$2,$3)',
        [usuarioId, 'El docente ha registrado una incidencia en el préstamo.', id]
      );
    }

    return incidencia;
  });
}

export function resolverIncidenciaComoBaja(
  pool, identidad, id, incidenciaId, resolucion
) {
  return conPrestamoEntregado(pool, identidad, id, async (c, contexto) => {
    const { ejemplar, item, anuncios, abiertas } = contexto;

    if (abiertas.rowCount !== 1 ||
        abiertas.rows[0].id !== incidenciaId ||
        abiertas.rows[0].ejemplar_id !== ejemplar.id) {
      throw fallo(409, 'INCIDENCIA_NO_RESOLUBLE');
    }

    await c.query(
      "UPDATE ejemplar SET estado_servicio='retirado' WHERE id=$1",
      [ejemplar.id]
    );

    // Si hay un anuncio asociado, deja de ofrecer el ejemplar retirado.
    for (const anuncio of anuncios) {
      if (anuncio.estado_revision === 'retirado') continue;

      await c.query(
        `UPDATE anuncio
         SET estado_revision='retirado',
             version=version+1, actualizada_en=now()
         WHERE id=$1`,
        [anuncio.id]
      );

      await c.query(
        `INSERT INTO evento_anuncio
           (anuncio_id, actor_id, accion, estado_anterior, estado_nuevo)
         VALUES ($1,$2,'baja_por_incidencia',$3,'retirado')`,
        [anuncio.id, identidad.id, anuncio.estado_revision]
      );
    }

    const operacion = (await c.query(
      `UPDATE operacion
       SET estado='cerrada_por_incidencia', cerrada_en=now()
       WHERE id=$1
       RETURNING id, tipo, estado, entregada_en, cerrada_en`,
      [id]
    )).rows[0];

    const incidencia = (await c.query(
      `UPDATE incidencia
       SET estado='resuelta', resolucion=$2,
           resuelta_por=$3, resuelta_en=now()
       WHERE id=$1
       RETURNING id, operacion_id, ejemplar_id, estado, resuelta_en`,
      [incidenciaId, resolucion.trim(), identidad.id]
    )).rows[0];

    await c.query(
      'DELETE FROM reserva_activa WHERE operacion_id=$1 AND ejemplar_id=$2',
      [id, ejemplar.id]
    );

    await c.query(
      `INSERT INTO evento_operacion (operacion_id, actor_id, accion, motivo)
       VALUES ($1,$2,'baja_por_incidencia',$3)`,
      [id, identidad.id, resolucion.trim()]
    );

    const destinatarios = new Set(
      [item.origen_usuario_id, item.destino_usuario_id].filter(x => x !== null)
    );

    for (const usuarioId of destinatarios) {
      await c.query(
        'INSERT INTO aviso(destinatario_id,mensaje,operacion_id) VALUES($1,$2,$3)',
        [usuarioId, 'El préstamo se ha cerrado por baja del ejemplar.', id]
      );
    }

    return { operacion, incidencia };
  });
}

export function rutasIncidencias(pool, sesion, activa) {
  const r = Router();

  r.post('/gestion/operaciones/:id/incidencias', sesion, activa,
    async (req, res, next) => {
      try {
        if (!req.usuario.roles.includes('docente')) {
          throw fallo(403, 'PERMISO_INSUFICIENTE');
        }

        const id = Number(req.params.id);
        const b = req.body;

        if (!/^[1-9]\d*$/.test(req.params.id) ||
            !Number.isSafeInteger(id) || id > 2147483647 ||
            !b || typeof b !== 'object' || Array.isArray(b) ||
            Object.keys(b).length !== 2 ||
            !Object.hasOwn(b, 'tipo') || !Object.hasOwn(b, 'descripcion') ||
            !['dano', 'perdida'].includes(b.tipo) ||
            typeof b.descripcion !== 'string' ||
            !b.descripcion.trim() || b.descripcion.trim().length > 1000) {
          throw fallo(422, 'DATOS_INVALIDOS');
        }

        const identidad = {
          id: req.usuario.id,
          authVersion: req.session.authVersion
        };

        res.status(201).json({
          datos: await abrirIncidencia(pool, identidad, id, b)
        });
      } catch (error) {
        if (error.codigo) {
          return res.status(error.codigo).json({ error: error.message });
        }
        next(error);
      }
    }
  );
  r.post('/gestion/operaciones/:id/incidencias/:incidenciaId/baja',
    sesion, activa, async (req, res, next) => {
      try {
        if (!req.usuario.roles.includes('docente')) {
          throw fallo(403, 'PERMISO_INSUFICIENTE');
        }

        const idValido = valor => /^[1-9]\d*$/.test(valor) &&
          Number.isSafeInteger(Number(valor)) && Number(valor) <= 2147483647;

        const b = req.body;

        if (!idValido(req.params.id) || !idValido(req.params.incidenciaId) ||
            !b || typeof b !== 'object' || Array.isArray(b) ||
            Object.keys(b).length !== 1 || !Object.hasOwn(b, 'resolucion') ||
            typeof b.resolucion !== 'string' || !b.resolucion.trim() ||
            b.resolucion.trim().length > 1000) {
          throw fallo(422, 'DATOS_INVALIDOS');
        }

        const identidad = {
          id: req.usuario.id,
          authVersion: req.session.authVersion
        };

        res.json({
          datos: await resolverIncidenciaComoBaja(
            pool, identidad, Number(req.params.id),
            Number(req.params.incidenciaId), b.resolucion
          )
        });
      } catch (error) {
        if (error.codigo) {
          return res.status(error.codigo).json({ error: error.message });
        }
        next(error);
      }
    }
  );

  return r;
}