import {
  hoyMadrid,
  proponerVencimiento,
  vencimientoValido
} from './fechas.mjs';

// Devuelve resultados para que la ruta los convierta en respuestas HTTP.
export async function asignarSolicitud(pool, identidad, solicitudId, entrada) {
  const cliente = await pool.connect();
  let abierta = false;

  async function rechazar(codigo, error) {
    await cliente.query('ROLLBACK');
    abierta = false;
    return { codigo, cuerpo: { error } };
  }

  try {
    await cliente.query('BEGIN');
    abierta = true;
    await cliente.query("SET LOCAL lock_timeout = '5s'");

    // Primera lectura para conocer los objetos que se deben bloquear.
    const inicial = await cliente.query(
      'SELECT ejemplar_id, solicitante_id FROM solicitud WHERE id=$1',
      [solicitudId]
    );

    if (!inicial.rowCount) {
      return await rechazar(404, 'SOLICITUD_NO_ENCONTRADA');
    }

    const referencia = inicial.rows[0];

    // Mantiene estables ambas cuentas durante la asignación.
    const cuentas = await cliente.query(`
      SELECT id, estado, auth_version
      FROM usuario
      WHERE id = ANY($1::integer[])
      ORDER BY id
      FOR SHARE
    `, [[identidad.id, referencia.solicitante_id]]);

    const docente = cuentas.rows.find(c => c.id === identidad.id);
    const alumno = cuentas.rows.find(c => c.id === referencia.solicitante_id);

    if (!docente || docente.auth_version !== identidad.authVersion) {
      return await rechazar(401, 'SESION_NO_VALIDA');
    }

    if (docente.estado !== 'activo') {
      return await rechazar(403, 'CUENTA_NO_ACTIVA');
    }

    const permiso = await cliente.query(`
      SELECT rol FROM usuario_rol
      WHERE usuario_id=$1 AND rol='docente'
      FOR SHARE
    `, [identidad.id]);

    if (!permiso.rowCount) {
      return await rechazar(403, 'PERMISO_INSUFICIENTE');
    }

    const participante = await cliente.query(`
      SELECT rol FROM usuario_rol
      WHERE usuario_id=$1 AND rol='alumno'
      FOR SHARE
    `, [referencia.solicitante_id]);

    if (!alumno || alumno.estado !== 'activo' || !participante.rowCount) {
      return await rechazar(409, 'SOLICITANTE_NO_APTO');
    }

    // Dos asignaciones del mismo ejemplar deben pasar por este bloqueo.
    const unidades = await cliente.query(`
      SELECT id, recurso_id, propietario_usuario_id, estado_servicio
      FROM ejemplar
      WHERE id=$1
      FOR UPDATE
    `, [referencia.ejemplar_id]);

    if (!unidades.rowCount) {
      return await rechazar(404, 'EJEMPLAR_NO_ENCONTRADO');
    }

    const ejemplar = unidades.rows[0];

    const fichas = await cliente.query(`
      SELECT tipo, origen, estado_editorial
      FROM recurso
      WHERE id=$1
      FOR SHARE
    `, [ejemplar.recurso_id]);

    const ficha = fichas.rows[0];

    if (!ficha || ficha.tipo !== 'fisico' ||
        ficha.origen !== 'centro' ||
        ficha.estado_editorial !== 'publicado' ||
        ejemplar.propietario_usuario_id !== null) {
      return await rechazar(422, 'EJEMPLAR_NO_APTO');
    }

    const reserva = await cliente.query(
      'SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1',
      [ejemplar.id]
    );

    if (ejemplar.estado_servicio !== 'disponible' || reserva.rowCount) {
      return await rechazar(409, 'EJEMPLAR_NO_DISPONIBLE');
    }

    // Relee la solicitud después de obtener el bloqueo del ejemplar.
    const solicitudes = await cliente.query(`
      SELECT estado, ejemplar_id, solicitante_id
      FROM solicitud WHERE id=$1
      FOR UPDATE
    `, [solicitudId]);

    const solicitud = solicitudes.rows[0];

    if (!solicitud || solicitud.estado !== 'pendiente' ||
        solicitud.ejemplar_id !== ejemplar.id ||
        solicitud.solicitante_id !== alumno.id) {
      return await rechazar(409, 'SOLICITUD_NO_PENDIENTE');
    }

    // Se calcula al asignar, después de esperar los bloqueos.
    const hoy = hoyMadrid();
    const vencimiento = entrada.vencimiento ?? proponerVencimiento(hoy);

    if (!vencimientoValido(vencimiento, hoy)) {
      return await rechazar(422, 'VENCIMIENTO_INVALIDO');
    }

    const alta = await cliente.query(`
      INSERT INTO operacion (tipo, estado, docente_id, vencimiento)
      VALUES ('prestamo', 'reservada', $1, $2)
      RETURNING id, estado, vencimiento::text
    `, [identidad.id, vencimiento]);

    const operacion = alta.rows[0];

    await cliente.query(`
      INSERT INTO operacion_item
        (operacion_id, ejemplar_id, origen_usuario_id, destino_usuario_id)
      VALUES ($1, $2, NULL, $3)
    `, [operacion.id, ejemplar.id, alumno.id]);

    // La PK protege también frente a una segunda reserva del ejemplar.
    await cliente.query(`
      INSERT INTO reserva_activa (ejemplar_id, operacion_id)
      VALUES ($1, $2)
    `, [ejemplar.id, operacion.id]);

    await cliente.query(
      "UPDATE ejemplar SET estado_servicio='reservado' WHERE id=$1",
      [ejemplar.id]
    );

    await cliente.query(
      "UPDATE solicitud SET estado='asignada' WHERE id=$1",
      [solicitudId]
    );

    const rechazadas = await cliente.query(`
      UPDATE solicitud SET estado='rechazada'
      WHERE ejemplar_id=$1 AND estado='pendiente' AND id<>$2
      RETURNING id, solicitante_id
    `, [ejemplar.id, solicitudId]);

    await cliente.query(`
      INSERT INTO evento_operacion
        (operacion_id, actor_id, accion, motivo)
      VALUES ($1, $2, 'asignada', $3)
    `, [operacion.id, identidad.id, entrada.motivo]);

    await cliente.query(`
      INSERT INTO aviso
        (destinatario_id, solicitud_id, operacion_id, tipo)
      VALUES ($1, $2, $3, 'solicitud_asignada')
    `, [alumno.id, solicitudId, operacion.id]);

    for (const otra of rechazadas.rows) {
      await cliente.query(`
        INSERT INTO aviso
          (destinatario_id, solicitud_id, operacion_id, tipo)
        VALUES ($1, $2, $3, 'solicitud_rechazada')
      `, [otra.solicitante_id, otra.id, operacion.id]);
    }

    await cliente.query('COMMIT');
    abierta = false;

    return {
      codigo: 201,
      cuerpo: { datos: operacion, mensaje: 'Prestamo asignado' }
    };
  } catch (error) {
    if (abierta) {
      try {
        await cliente.query('ROLLBACK');
      } catch {
        // No oculta el error que provocó el fallo.
      }
    }

    if (['23505', '55P03', '40P01'].includes(error.code)) {
      return {
        codigo: 409,
        cuerpo: { error: 'CONFLICTO_ASIGNACION' }
      };
    }

    throw error;
  } finally {
    cliente.release();
  }
}