// Solicitudes de prestamos del centro. Pedir no crea una reserva.
export function entradaSolicitudValida(datos) {
  return datos !== null && typeof datos === 'object' && !Array.isArray(datos) &&
    Object.keys(datos).length === 1 &&
    Number.isSafeInteger(datos.ejemplarId) && datos.ejemplarId > 0;
}

export async function crearSolicitud(pool, identidad, ejemplarId) {
  const cliente = await pool.connect();
  let abierta = false;
  const rechazar = async (codigo, error) => {
    await cliente.query('ROLLBACK');
    abierta = false;
    return { codigo, cuerpo: { error } };
  };
  try {
    await cliente.query('BEGIN');
    abierta = true;
    // Releemos la identidad de la sesion dentro de la transaccion.
    const cuenta = await cliente.query(
      'SELECT estado, auth_version FROM usuario WHERE id = $1 FOR SHARE', [identidad.id]
    );
    if (!cuenta.rowCount || cuenta.rows[0].auth_version !== identidad.authVersion) {
      return await rechazar(401, 'SESION_NO_VALIDA');
    }
    if (cuenta.rows[0].estado !== 'activo') return await rechazar(403, 'CUENTA_NO_ACTIVA');
    const permiso = await cliente.query(
      "SELECT rol FROM usuario_rol WHERE usuario_id = $1 AND rol = 'alumno' FOR SHARE", [identidad.id]
    );
    if (!permiso.rowCount) return await rechazar(403, 'PERMISO_INSUFICIENTE');

    // Conservamos estables la ficha y el ejemplar mientras guardamos la solicitud.
    const resultado = await cliente.query(`
      SELECT e.propietario_usuario_id, e.estado_servicio, r.tipo,
             r.origen, r.estado_editorial
      FROM ejemplar e JOIN recurso r ON r.id = e.recurso_id
      WHERE e.id = $1 FOR SHARE OF e, r
    `, [ejemplarId]);
    if (!resultado.rowCount) return await rechazar(404, 'EJEMPLAR_NO_ENCONTRADO');
    const ejemplar = resultado.rows[0];
    if (ejemplar.propietario_usuario_id === identidad.id) {
      return await rechazar(422, 'NO_PUEDES_SOLICITAR_LO_PROPIO');
    }
    // Esta tarea cubre Biblioteca: los prestamos entre alumnos se integraran despues.
    if (ejemplar.propietario_usuario_id !== null || ejemplar.origen !== 'centro' ||
        ejemplar.tipo !== 'fisico' || ejemplar.estado_editorial !== 'publicado') {
      return await rechazar(422, 'EJEMPLAR_NO_APTO');
    }
    const reserva = await cliente.query('SELECT 1 FROM reserva_activa WHERE ejemplar_id = $1', [ejemplarId]);
    if (ejemplar.estado_servicio !== 'disponible' || reserva.rowCount) {
      return await rechazar(409, 'EJEMPLAR_NO_DISPONIBLE');
    }
    const alta = await cliente.query(`
      INSERT INTO solicitud (ejemplar_id, solicitante_id)
      VALUES ($1, $2) RETURNING id, estado
    `, [ejemplarId, identidad.id]);
    await cliente.query('COMMIT');
    abierta = false;
    return { codigo: 201, cuerpo: { datos: alta.rows[0], mensaje: 'Solicitud enviada' } };
  } catch (error) {
    if (abierta) {
      try { await cliente.query('ROLLBACK'); } catch { /* Conservamos el error original. */ }
      abierta = false;
    }
    if (error.code === '23505' && error.constraint === 'una_solicitud_pendiente') {
      const existente = await cliente.query(
        "SELECT id FROM solicitud WHERE ejemplar_id = $1 AND solicitante_id = $2 AND estado = 'pendiente'",
        [ejemplarId, identidad.id]
      );
      return { codigo: 409, cuerpo: { error: 'SOLICITUD_YA_PENDIENTE', solicitudId: existente.rows[0]?.id ?? null } };
    }
    throw error;
  } finally {
    cliente.release();
  }
}
