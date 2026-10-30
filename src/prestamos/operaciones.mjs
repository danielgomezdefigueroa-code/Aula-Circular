
const fallo = (codigo, mensaje) =>
  Object.assign(new Error(mensaje), { codigo });

async function transaccion(pool, accion) {
  const cliente = await pool.connect();

  try {
    await cliente.query('BEGIN');
    await cliente.query("SET LOCAL lock_timeout = '3s'");

    const resultado = await accion(cliente);

    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});

    if (['23505', '55P03', '40P01'].includes(error.code)) {
      throw fallo(409, 'CONFLICTO_RECARGA_EL_ESTADO');
    }

    throw error;
  } finally {
    cliente.release();
  }
}

async function comprobarDocente(cliente, identidad) {
  const resultado = await cliente.query(
    `SELECT u.id
     FROM usuario u
     JOIN usuario_rol ur ON ur.usuario_id = u.id
     WHERE u.id = $1
       AND u.estado = 'activo'
       AND u.auth_version = $2
       AND ur.rol = 'docente'
     FOR SHARE OF u`,
    [identidad.id, identidad.authVersion]
  );

  if (!resultado.rowCount) {
    throw fallo(403, 'PERMISO_INSUFICIENTE');
  }
}

async function bloquearOperacion(cliente, operacionId) {
  const referencia = await cliente.query(
    `SELECT ejemplar_id
     FROM operacion_item
     WHERE operacion_id = $1`,
    [operacionId]
  );

  if (referencia.rowCount !== 1) {
    throw fallo(409, 'OPERACION_INCOHERENTE');
  }

  const ejemplarId = referencia.rows[0].ejemplar_id;

  // Mantener el orden de bloqueos utilizado por otros módulos.
  await cliente.query(
    'SELECT id FROM ejemplar WHERE id = $1 FOR UPDATE',
    [ejemplarId]
  );

  const resultado = await cliente.query(
    'SELECT * FROM operacion WHERE id = $1 FOR UPDATE',
    [operacionId]
  );

  if (!resultado.rowCount || resultado.rows[0].tipo !== 'prestamo') {
    throw fallo(404, 'PRESTAMO_NO_DISPONIBLE');
  }

  return { operacion: resultado.rows[0], ejemplarId };
}

async function comprobarReserva(cliente, operacionId, ejemplarId) {
  const resultado = await cliente.query(
    `SELECT 1
     FROM reserva_activa
     WHERE operacion_id = $1
       AND ejemplar_id = $2`,
    [operacionId, ejemplarId]
  );

  if (resultado.rowCount !== 1) {
    throw fallo(409, 'RESERVA_INCOHERENTE');
  }
}

async function registrarEvento(cliente, operacionId, actorId, accion, motivo = '') {
  await cliente.query(
    `INSERT INTO evento_operacion
       (operacion_id, actor_id, accion, motivo)
     VALUES ($1, $2, $3, $4)`,
    [operacionId, actorId, accion, motivo]
  );
}


async function avisarParticipante(cliente, operacionId, mensaje) {
  const participantes = await cliente.query(
    `SELECT DISTINCT destino_usuario_id AS usuario_id
     FROM operacion_item
     WHERE operacion_id = $1`,
    [operacionId]
  );

  for (const participante of participantes.rows) {
    await cliente.query(
      `INSERT INTO aviso
         (destinatario_id, mensaje, operacion_id)
       VALUES ($1, $2, $3)`,
      [participante.usuario_id, mensaje, operacionId]
    );
  }
}


export async function cancelarPrestamo(pool, identidad, operacionId, motivo) {
  return transaccion(pool, async cliente => {
    await comprobarDocente(cliente, identidad);

    const { operacion, ejemplarId } =
      await bloquearOperacion(cliente, operacionId);

    if (operacion.estado !== 'reservada') {
      throw fallo(409, 'OPERACION_NO_CANCELABLE');
    }

    await comprobarReserva(cliente, operacionId, ejemplarId);

    const resultado = await cliente.query(
      `UPDATE operacion
       SET estado = 'cancelada',
           cerrada_en = now()
       WHERE id = $1
       RETURNING *`,
      [operacionId]
    );

    
const reservaEliminada = await cliente.query(
  `DELETE FROM reserva_activa
   WHERE operacion_id = $1
     AND ejemplar_id = $2
   RETURNING ejemplar_id`,
  [operacionId, ejemplarId]
);

if (reservaEliminada.rowCount !== 1) {
  throw fallo(409, 'RESERVA_INCOHERENTE');
}


    await registrarEvento(
      cliente,
      operacionId,
      identidad.id,
      'cancelar_prestamo',
      motivo
    );

    await avisarParticipante(cliente, operacionId, 'Préstamo cancelado');

    return resultado.rows[0];
  });
}

export async function entregarPrestamo(pool, identidad, operacionId) {
  return transaccion(pool, async cliente => {
    await comprobarDocente(cliente, identidad);

    const { operacion, ejemplarId } =
      await bloquearOperacion(cliente, operacionId);

    if (operacion.estado !== 'reservada') {
      throw fallo(409, 'OPERACION_NO_RESERVADA');
    }

    
if (!operacion.vencimiento) {
  throw fallo(409, 'VENCIMIENTO_NECESARIO');
}

const vencimiento = new Date(operacion.vencimiento);

if (
  Number.isNaN(vencimiento.getTime()) ||
  vencimiento.getTime() <= Date.now()
) {
  throw fallo(409, 'VENCIMIENTO_NO_VALIDO');
}


    await comprobarReserva(cliente, operacionId, ejemplarId);

    const resultado = await cliente.query(
      `UPDATE operacion
       SET estado = 'prestada',
           entregada_en = now()
       WHERE id = $1
       RETURNING *`,
      [operacionId]
    );

    await registrarEvento(
      cliente, operacionId, identidad.id, 'entregar_prestamo'
    );

    await avisarParticipante(cliente, operacionId, 'Préstamo entregado');

    return resultado.rows[0];
  });
}

export async function devolverPrestamo(pool, identidad, operacionId, conservacion) {
  return transaccion(pool, async cliente => {
    await comprobarDocente(cliente, identidad);

    const { operacion, ejemplarId } =
      await bloquearOperacion(cliente, operacionId);

    if (operacion.estado !== 'prestada') {
      throw fallo(409, 'PRESTAMO_NO_DEVOLVIBLE');
    }

    await comprobarReserva(cliente, operacionId, ejemplarId);
    if (
  typeof conservacion !== 'string' ||
  conservacion.trim().length < 1 ||
  conservacion.trim().length > 500
) {
  throw fallo(422, 'CONSERVACION_NO_VALIDA');
}

    const incidencias = await cliente.query(
      `SELECT 1 FROM incidencia
       WHERE operacion_id = $1
         AND estado = 'abierta'`,
      [operacionId]
    );

    if (incidencias.rowCount) {
      throw fallo(409, 'INCIDENCIA_PENDIENTE');
    }

    await cliente.query(
  `UPDATE ejemplar
   SET conservacion = $1
   WHERE id = $2`,
  [conservacion.trim(), ejemplarId]
);

    const resultado = await cliente.query(
      `UPDATE operacion
       SET estado = 'completada',
           cerrada_en = now()
       WHERE id = $1
       RETURNING *`,
      [operacionId]
    );

    
    const reservaEliminada = await cliente.query(
     `DELETE FROM reserva_activa
     WHERE operacion_id = $1
     AND ejemplar_id = $2
        RETURNING ejemplar_id`,
    [operacionId, ejemplarId]
    );

if (reservaEliminada.rowCount !== 1) {
  throw fallo(409, 'RESERVA_INCOHERENTE');
}


    await registrarEvento(
      cliente, operacionId, identidad.id, 'devolver_prestamo'
    );

    await avisarParticipante(cliente, operacionId, 'Préstamo devuelto correctamente');

    return resultado.rows[0];
  });
}


export async function registrarIncidencia(
  pool, identidad, operacionId, tipo, descripcion
) {
  return transaccion(pool, async cliente => {
    await comprobarDocente(cliente, identidad);

    const { operacion, ejemplarId } =
      await bloquearOperacion(cliente, operacionId);

    if (operacion.estado !== 'prestada') {
      throw fallo(409, 'PRESTAMO_NO_ENTREGADO');
    }

    if (!['dano', 'perdida'].includes(tipo) ||
        typeof descripcion !== 'string' ||
        !descripcion.trim() ||
        descripcion.trim().length > 1000) {
      throw fallo(422, 'INCIDENCIA_NO_VALIDA');
    }

    await comprobarReserva(cliente, operacionId, ejemplarId);

    const incidencia = await cliente.query(
      `INSERT INTO incidencia
         (operacion_id, ejemplar_id, autor_id, tipo, descripcion)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [operacionId, ejemplarId, identidad.id, tipo, descripcion.trim()]
    );

    await registrarEvento(
      cliente, operacionId, identidad.id, 'registrar_incidencia', tipo
    );

    await avisarParticipante(cliente, operacionId, 'Incidencia registrada en el préstamo');

    return incidencia.rows[0];
  });
}


export async function cerrarPorIncidencia(
  pool, identidad, operacionId, resolucion
) {
  return transaccion(pool, async cliente => {
    await comprobarDocente(cliente, identidad);

    const { operacion, ejemplarId } =
      await bloquearOperacion(cliente, operacionId);

    if (operacion.estado !== 'prestada') {
      throw fallo(409, 'PRESTAMO_NO_CERRABLE');
    }

    if (typeof resolucion !== 'string' ||
        !resolucion.trim() ||
        resolucion.trim().length > 1000) {
      throw fallo(422, 'RESOLUCION_NO_VALIDA');
    }

    await comprobarReserva(cliente, operacionId, ejemplarId);

    const incidencia = await cliente.query(
      `SELECT id FROM incidencia
       WHERE operacion_id = $1
         AND ejemplar_id = $2
         AND estado = 'abierta'
       FOR UPDATE`,
      [operacionId, ejemplarId]
    );

    if (incidencia.rowCount !== 1) {
      throw fallo(409, 'INCIDENCIA_NO_DISPONIBLE');
    }

    await cliente.query(
      `UPDATE incidencia
       SET estado = 'resuelta',
           resolucion = $1,
           resuelta_en = now()
       WHERE id = $2`,
      [resolucion.trim(), incidencia.rows[0].id]
    );

    await cliente.query(
      `UPDATE ejemplar
       SET estado_servicio = 'retirado'
       WHERE id = $1`,
      [ejemplarId]
    );

    const actual = await cliente.query(
      `UPDATE operacion
       SET estado = 'cerrada_por_incidencia',
           cerrada_en = now()
       WHERE id = $1
       RETURNING *`,
      [operacionId]
    );

    const eliminada = await cliente.query(
      `DELETE FROM reserva_activa
       WHERE operacion_id = $1
         AND ejemplar_id = $2
       RETURNING ejemplar_id`,
      [operacionId, ejemplarId]
    );

    if (eliminada.rowCount !== 1) {
      throw fallo(409, 'RESERVA_INCOHERENTE');
    }

    await registrarEvento(
      cliente, operacionId, identidad.id,
      'cerrar_por_incidencia', resolucion.trim()
    );

    await avisarParticipante(cliente, operacionId, 'Préstamo cerrado por incidencia');

    return actual.rows[0];
  });
}


export async function solicitarPrestamo(pool, identidad, ejemplarId) {
  return transaccion(pool, async cliente => {
    const alumno = await cliente.query(
      `SELECT u.id
       FROM usuario u
       JOIN usuario_rol ur ON ur.usuario_id = u.id
       WHERE u.id = $1
         AND u.estado = 'activo'
         AND u.auth_version = $2
         AND ur.rol = 'alumno'
       FOR SHARE OF u`,
      [identidad.id, identidad.authVersion]
    );

    if (!alumno.rowCount) {
      throw fallo(403, 'PERMISO_INSUFICIENTE');
    }

    const resultado = await cliente.query(
      `SELECT e.id
       FROM ejemplar e
       JOIN recurso r ON r.id = e.recurso_id
       WHERE e.id = $1
         AND e.estado_servicio = 'habilitado'
         AND e.propietario_usuario_id IS NULL
         AND r.origen = 'centro'
         AND r.tipo = 'fisico'
       FOR UPDATE OF e`,
      [ejemplarId]
    );

    if (!resultado.rowCount) {
      throw fallo(409, 'EJEMPLAR_NO_DISPONIBLE');
    }

    const ocupado = await cliente.query(
      `SELECT 1
       FROM reserva_activa
       WHERE ejemplar_id = $1`,
      [ejemplarId]
    );

    if (ocupado.rowCount) {
      throw fallo(409, 'EJEMPLAR_OCUPADO');
    }

    const solicitud = await cliente.query(
      `INSERT INTO solicitud
         (ejemplar_id, solicitante_id)
       VALUES ($1, $2)
       RETURNING *`,
      [ejemplarId, identidad.id]
    );

    return solicitud.rows[0];
  });
}


export async function adjudicarPrestamo(
  pool, identidad, solicitudId, motivo, vencimiento
) {
  return transaccion(pool, async cliente => {
    await comprobarDocente(cliente, identidad);

    if (!Number.isSafeInteger(solicitudId) || solicitudId <= 0) {
      throw fallo(422, 'SOLICITUD_NO_VALIDA');
    }

    if (typeof motivo !== 'string' ||
        !motivo.trim() || motivo.trim().length > 1000) {
      throw fallo(422, 'MOTIVO_NECESARIO');
    }

    const fecha = new Date(vencimiento);

    if (typeof vencimiento !== 'string' ||
        !Number.isFinite(fecha.getTime()) ||
        fecha.getTime() <= Date.now()) {
      throw fallo(422, 'VENCIMIENTO_NO_VALIDO');
    }

    const referencia = await cliente.query(
      'SELECT ejemplar_id FROM solicitud WHERE id=$1',
      [solicitudId]
    );

    if (!referencia.rowCount) {
      throw fallo(404, 'SOLICITUD_NO_DISPONIBLE');
    }

    const ejemplarId = referencia.rows[0].ejemplar_id;

    const ejemplar = await cliente.query(
      `SELECT e.id
       FROM ejemplar e
       JOIN recurso r ON r.id=e.recurso_id
       WHERE e.id=$1
         AND e.estado_servicio='habilitado'
         AND e.propietario_usuario_id IS NULL
         AND r.origen='centro'
         AND r.tipo='fisico'
       FOR UPDATE OF e`,
      [ejemplarId]
    );

    if (!ejemplar.rowCount) {
      throw fallo(409, 'EJEMPLAR_NO_DISPONIBLE');
    }

    const solicitud = await cliente.query(
      'SELECT * FROM solicitud WHERE id=$1 FOR UPDATE',
      [solicitudId]
    );

    const s = solicitud.rows[0];

    if (!s || s.estado !== 'pendiente' ||
        s.ejemplar_id !== ejemplarId) {
      throw fallo(409, 'SOLICITUD_NO_ASIGNABLE');
    }

    const alumno = await cliente.query(
      `SELECT u.id FROM usuario u
       JOIN usuario_rol ur ON ur.usuario_id=u.id
       WHERE u.id=$1 AND u.estado='activo'
         AND ur.rol='alumno'
       FOR SHARE OF u`,
      [s.solicitante_id]
    );

    if (!alumno.rowCount) {
      throw fallo(409, 'PARTICIPANTE_NO_ACTIVO');
    }

    const ocupado = await cliente.query(
      `SELECT 1 FROM reserva_activa
       WHERE ejemplar_id=$1`,
      [ejemplarId]
    );

    if (ocupado.rowCount) {
      throw fallo(409, 'EJEMPLAR_OCUPADO');
    }

    const activa = await cliente.query(
      `SELECT 1
       FROM operacion_item i
       JOIN operacion o ON o.id=i.operacion_id
       WHERE i.ejemplar_id=$1
         AND o.estado IN ('reservada','prestada')`,
      [ejemplarId]
    );

    if (activa.rowCount) {
      throw fallo(409, 'EJEMPLAR_OCUPADO');
    }

    const operacion = await cliente.query(
      `INSERT INTO operacion
         (tipo,estado,docente_id,vencimiento)
       VALUES ('prestamo','reservada',$1,$2)
       RETURNING *`,
      [identidad.id, fecha]
    );

    const op = operacion.rows[0];

    await cliente.query(
      `INSERT INTO operacion_item
         (operacion_id,ejemplar_id,origen_usuario_id,destino_usuario_id)
       VALUES ($1,$2,NULL,$3)`,
      [op.id, ejemplarId, s.solicitante_id]
    );

    await cliente.query(
      `INSERT INTO reserva_activa(ejemplar_id,operacion_id)
       VALUES ($1,$2)`,
      [ejemplarId, op.id]
    );

    const solicitudes = await cliente.query(
      `UPDATE solicitud
       SET estado=CASE
         WHEN id=$1 THEN 'adjudicada'
         ELSE 'rechazada'
       END
       WHERE ejemplar_id=$2 AND estado='pendiente'
       RETURNING id,solicitante_id,estado`,
      [solicitudId, ejemplarId]
    );

    await registrarEvento(
      cliente, op.id, identidad.id,
      'adjudicar_prestamo', motivo.trim()
    );

    for (const s of solicitudes.rows) {
      await cliente.query(
        `INSERT INTO aviso
           (destinatario_id,mensaje,operacion_id)
         VALUES ($1,$2,$3)`,
        [s.solicitante_id,
         'Solicitud de préstamo ' + s.estado,
         op.id]
      );
    }

    return op;
  });
}
