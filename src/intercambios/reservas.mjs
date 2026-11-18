// Reserva docente: una operación, dos ejemplares y una sola transacción.
const fallo = (codigo, mensaje) =>
  Object.assign(new Error(mensaje), { codigo });

export async function reservarIntercambio(pool, identidad, id) {
  const c = await pool.connect();

  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout = '3s'");

    // Referencias iniciales. Los datos decisivos se releen bajo bloqueo.
    const ref = (
      await c.query(
        'SELECT * FROM intercambio WHERE operacion_id=$1',
        [id]
      )
    ).rows[0];

    if (!ref) throw fallo(404, 'INTERCAMBIO_NO_DISPONIBLE');

    // Bloqueamos las cuentas antes que los ejemplares.
    const idsUsuarios = [
      ...new Set([
        identidad.id,
        ref.proponente_id,
        ref.receptor_id
      ])
    ].sort((a, b) => a - b);

    const usuarios = await c.query(
      `SELECT id, estado, auth_version
       FROM usuario
       WHERE id=ANY($1::integer[])
       ORDER BY id
       FOR SHARE`,
      [idsUsuarios]
    );

    const docente = usuarios.rows.find(u => u.id === identidad.id);

    if (!docente || docente.auth_version !== identidad.authVersion) {
      throw fallo(401, 'SESION_CADUCADA');
    }

    // Protegemos también los roles consultados durante la operación.
    const roles = await c.query(
      `SELECT usuario_id, rol
       FROM usuario_rol
       WHERE usuario_id=ANY($1::integer[])
       ORDER BY usuario_id, rol
       FOR SHARE`,
      [idsUsuarios]
    );

    const tieneRol = (usuarioId, rol) =>
      roles.rows.some(r => r.usuario_id === usuarioId && r.rol === rol);

    if (docente.estado !== 'activo' ||
        !tieneRol(identidad.id, 'docente')) {
      throw fallo(403, 'PERMISO_INSUFICIENTE');
    }

    for (const usuarioId of [ref.proponente_id, ref.receptor_id]) {
      const usuario = usuarios.rows.find(u => u.id === usuarioId);

      if (!usuario || usuario.estado !== 'activo' ||
          !tieneRol(usuarioId, 'alumno')) {
        throw fallo(409, 'PARTICIPANTES_NO_ACTIVOS');
      }
    }

    const idsEjemplares = [
      ref.ejemplar_ofrecido_id,
      ref.ejemplar_solicitado_id
    ].sort((a, b) => a - b);

    // Convención compartida: ejemplares, anuncios y después operación.
    const ejemplares = await c.query(
      `SELECT *
       FROM ejemplar
       WHERE id=ANY($1::integer[])
       ORDER BY id
       FOR UPDATE`,
      [idsEjemplares]
    );

    const anuncios = await c.query(
      `SELECT *
       FROM anuncio
       WHERE ejemplar_id=ANY($1::integer[])
       ORDER BY ejemplar_id
       FOR UPDATE`,
      [idsEjemplares]
    );

    const op = (
      await c.query(
        'SELECT * FROM operacion WHERE id=$1 FOR UPDATE',
        [id]
      )
    ).rows[0];

    if (!op || op.tipo !== 'intercambio' ||
        op.estado !== 'propuesta') {
      throw fallo(409, 'PROPUESTA_NO_VIGENTE');
    }

    if (ejemplares.rowCount !== 2 || anuncios.rowCount !== 2) {
      throw fallo(409, 'PAREJA_NO_DISPONIBLE');
    }

    const ofrecido = ejemplares.rows.find(
      e => e.id === ref.ejemplar_ofrecido_id
    );
    const solicitado = ejemplares.rows.find(
      e => e.id === ref.ejemplar_solicitado_id
    );
    const anuncioA = anuncios.rows.find(
      a => a.ejemplar_id === ofrecido.id
    );
    const anuncioB = anuncios.rows.find(
      a => a.ejemplar_id === solicitado.id
    );

    if (ofrecido.propietario_usuario_id !== ref.proponente_id ||
        solicitado.propietario_usuario_id !== ref.receptor_id ||
        anuncioA.id !== ref.anuncio_ofrecido_id ||
        anuncioB.id !== ref.anuncio_solicitado_id ||
        anuncioA.version !== ref.version_ofrecida ||
        anuncioB.version !== ref.version_solicitada) {
      throw fallo(409, 'ACUERDO_DESACTUALIZADO');
    }

    if (anuncios.rows.some(a => a.modalidad !== 'intercambio')) {
      throw fallo(422, 'MODALIDAD_NO_ADMITIDA');
    }

    if (ejemplares.rows.some(e => e.estado_servicio !== 'habilitado') ||
        anuncios.rows.some(a => a.estado_revision !== 'publicado')) {
      throw fallo(409, 'ANUNCIO_NO_DISPONIBLE');
    }

    const idsRecursos = [
      ...new Set(ejemplares.rows.map(e => e.recurso_id))
    ].sort((a, b) => a - b);

    const recursos = await c.query(
      `SELECT id, tipo, origen
       FROM recurso
       WHERE id=ANY($1::integer[])
       ORDER BY id
       FOR SHARE`,
      [idsRecursos]
    );

    if (recursos.rowCount !== idsRecursos.length ||
        recursos.rows.some(r => r.tipo !== 'fisico' ||
                                r.origen !== 'alumno')) {
      throw fallo(422, 'EJEMPLAR_NO_APTO');
    }

    const aceptaciones = await c.query(
      `SELECT usuario_id
       FROM aceptacion_intercambio
       WHERE operacion_id=$1
       ORDER BY usuario_id
       FOR SHARE`,
      [id]
    );

    if (aceptaciones.rowCount !== 2 ||
        ![ref.proponente_id, ref.receptor_id].every(usuarioId =>
          aceptaciones.rows.some(a => a.usuario_id === usuarioId))) {
      throw fallo(409, 'ACEPTACIONES_PENDIENTES');
    }

    // Los dos ítems deben conservar origen y destinatario cruzados.
    const items = await c.query(
      `SELECT *
       FROM operacion_item
       WHERE operacion_id=$1
       ORDER BY ejemplar_id
       FOR UPDATE`,
      [id]
    );

    const itemCorrecto = (ejemplarId, origen, destino) =>
      items.rows.some(i =>
        i.ejemplar_id === ejemplarId &&
        i.origen_usuario_id === origen &&
        i.destino_usuario_id === destino
      );

    if (items.rowCount !== 2 ||
        !itemCorrecto(ofrecido.id, ref.proponente_id, ref.receptor_id) ||
        !itemCorrecto(solicitado.id, ref.receptor_id, ref.proponente_id)) {
      throw fallo(409, 'ITEMS_INCOHERENTES');
    }

    const ocupados = await c.query(
      `SELECT 1
       FROM reserva_activa
       WHERE ejemplar_id=ANY($1::integer[])
       UNION ALL
       SELECT 1
       FROM operacion_item i
       JOIN operacion o ON o.id=i.operacion_id
       WHERE i.ejemplar_id=ANY($1::integer[])
         AND o.estado IN ('reservada','prestada')`,
      [idsEjemplares]
    );

    if (ocupados.rowCount) throw fallo(409, 'EJEMPLAR_OCUPADO');

    // Ambas reservas se guardan juntas y pertenecen a la misma operación.
    await c.query(
      `INSERT INTO reserva_activa(ejemplar_id,operacion_id)
       VALUES($1,$3),($2,$3)`,
      [ofrecido.id, solicitado.id, id]
    );

    const actual = (
      await c.query(
        `UPDATE operacion
         SET estado='reservada', docente_id=$2
         WHERE id=$1
         RETURNING id, tipo, estado, docente_id`,
        [id, identidad.id]
      )
    ).rows[0];

    await c.query(
      `INSERT INTO evento_operacion(operacion_id,actor_id,accion)
       VALUES($1,$2,'reservar_intercambio')`,
      [id, identidad.id]
    );

    for (const usuarioId of [ref.proponente_id, ref.receptor_id]) {
      await c.query(
        `INSERT INTO aviso(destinatario_id,mensaje,operacion_id)
         VALUES($1,$2,$3)`,
        [usuarioId, 'Intercambio reservado por el docente.', id]
      );
    }

    await c.query('COMMIT');

    return {
      ...actual,
      ejemplares: idsEjemplares,
      reservas: 2
    };
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