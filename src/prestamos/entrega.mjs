import { hoyMadrid, vencimientoValido } from './fechas.mjs';

export async function entregarPrestamo(pool, identidad, operacionId, entrada) {
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

    // Esta fase admite un único ejemplar por préstamo.
    const inicial = await cliente.query(`
      SELECT ejemplar_id, destino_usuario_id
      FROM operacion_item
      WHERE operacion_id=$1
      ORDER BY ejemplar_id
    `, [operacionId]);

    if (!inicial.rowCount) {
      return await rechazar(404, 'OPERACION_NO_ENCONTRADA');
    }
    if (inicial.rowCount !== 1) {
      return await rechazar(409, 'OPERACION_INCOHERENTE');
    }

    const referencia = inicial.rows[0];

    // Mantiene estables las cuentas durante la entrega.
    const cuentas = await cliente.query(`
      SELECT id, estado, auth_version
      FROM usuario
      WHERE id=ANY($1::integer[])
      ORDER BY id
      FOR SHARE
    `, [[identidad.id, referencia.destino_usuario_id]]);

    const docente = cuentas.rows.find(c => c.id === identidad.id);
    const alumno = cuentas.rows.find(
      c => c.id === referencia.destino_usuario_id
    );

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

    // Mismo orden que la asignación: primero bloquear el ejemplar.
    const unidades = await cliente.query(`
      SELECT id, estado_servicio
      FROM ejemplar WHERE id=$1
      FOR UPDATE
    `, [referencia.ejemplar_id]);

    const operaciones = await cliente.query(`
      SELECT id, tipo, estado
      FROM operacion WHERE id=$1
      FOR UPDATE
    `, [operacionId]);

    if (!operaciones.rowCount) {
      return await rechazar(404, 'OPERACION_NO_ENCONTRADA');
    }

    const operacion = operaciones.rows[0];

    // Se comprueba antes de escribir: repetir no duplica efectos.
    if (operacion.estado === 'prestada') {
      return await rechazar(409, 'PRESTAMO_YA_ENTREGADO');
    }
    if (operacion.tipo !== 'prestamo' ||
        operacion.estado !== 'reservada') {
      return await rechazar(409, 'OPERACION_NO_ENTREGABLE');
    }

    if (!alumno || alumno.estado !== 'activo') {
      return await rechazar(409, 'DESTINATARIO_NO_ACTIVO');
    }

    const items = await cliente.query(`
      SELECT ejemplar_id, destino_usuario_id, origen_usuario_id
      FROM operacion_item WHERE operacion_id=$1
      ORDER BY ejemplar_id
      FOR UPDATE
    `, [operacionId]);

    if (items.rowCount !== 1 ||
        items.rows[0].ejemplar_id !== referencia.ejemplar_id ||
        items.rows[0].destino_usuario_id !== alumno.id ||
        items.rows[0].origen_usuario_id !== null) {
      return await rechazar(409, 'OPERACION_INCOHERENTE');
    }

    const reservas = await cliente.query(`
      SELECT operacion_id FROM reserva_activa
      WHERE ejemplar_id=$1
      FOR UPDATE
    `, [referencia.ejemplar_id]);

    if (!unidades.rowCount ||
        unidades.rows[0].estado_servicio !== 'reservado' ||
        !reservas.rowCount ||
        reservas.rows[0].operacion_id !== operacionId) {
      return await rechazar(409, 'RESERVA_INCOHERENTE');
    }

    // Fecha explícita al confirmar la entrega; se revisa tras los bloqueos.
    if (!vencimientoValido(entrada.vencimiento, hoyMadrid())) {
      return await rechazar(422, 'VENCIMIENTO_INVALIDO');
    }

    const resultado = await cliente.query(`
      UPDATE operacion
      SET estado='prestada',
          vencimiento=$1,
          entregada_en=clock_timestamp()
      WHERE id=$2
      RETURNING id, estado, vencimiento::text, entregada_en
    `, [entrada.vencimiento, operacionId]);

    await cliente.query(
      "UPDATE ejemplar SET estado_servicio='prestado' WHERE id=$1",
      [referencia.ejemplar_id]
    );

    await cliente.query(`
      INSERT INTO evento_operacion (operacion_id, actor_id, accion)
      VALUES ($1, $2, 'entregada')
    `, [operacionId, identidad.id]);

    await cliente.query(`
      INSERT INTO aviso (destinatario_id, operacion_id, tipo)
      VALUES ($1, $2, 'prestamo_entregado')
    `, [alumno.id, operacionId]);

    // La reserva permanece: la entrega no devuelve el ejemplar.
    await cliente.query('COMMIT');
    abierta = false;

    return {
      codigo: 200,
      cuerpo: {
        datos: resultado.rows[0],
        mensaje: 'Entrega registrada'
      }
    };
  } catch (error) {
    if (abierta) {
      try {
        await cliente.query('ROLLBACK');
      } catch {
        // Conserva el error original.
      }
    }

    if (['23505', '55P03', '40P01'].includes(error.code)) {
      return {
        codigo: 409,
        cuerpo: { error: 'CONFLICTO_ENTREGA' }
      };
    }

    throw error;
  } finally {
    cliente.release();
  }
}