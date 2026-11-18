const fallo = (codigo, mensaje) =>
  Object.assign(new Error(mensaje), { codigo });

// Se utiliza únicamente para operaciones de intercambio.
export async function gestionarIntercambio(
  pool, identidad, id, accion, motivo = ''
) {
  if (!['entregar', 'cancelar'].includes(accion)) {
    throw fallo(422, 'ACCION_INVALIDA');
  }

  if (accion === 'cancelar' &&
      (typeof motivo !== 'string' ||
       !motivo.trim() || motivo.length > 1000)) {
    throw fallo(422, 'MOTIVO_NECESARIO');
  }

  const c = await pool.connect();

  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout = '3s'");

    const ref = (
      await c.query(
        'SELECT * FROM intercambio WHERE operacion_id=$1',
        [id]
      )
    ).rows[0];

    if (!ref) throw fallo(404, 'INTERCAMBIO_NO_DISPONIBLE');

    const idsUsuarios = [...new Set([
      identidad.id, ref.proponente_id, ref.receptor_id
    ])].sort((a, b) => a - b);

    const usuarios = await c.query(
      `SELECT id, estado, auth_version FROM usuario
       WHERE id=ANY($1::integer[])
       ORDER BY id FOR SHARE`,
      [idsUsuarios]
    );

    const roles = await c.query(
      `SELECT usuario_id, rol FROM usuario_rol
       WHERE usuario_id=ANY($1::integer[])
       ORDER BY usuario_id, rol FOR SHARE`,
      [idsUsuarios]
    );

    const tieneRol = (usuarioId, rol) =>
      roles.rows.some(r => r.usuario_id === usuarioId && r.rol === rol);

    const docente = usuarios.rows.find(u => u.id === identidad.id);

    if (!docente || docente.auth_version !== identidad.authVersion) {
      throw fallo(401, 'SESION_CADUCADA');
    }

    if (docente.estado !== 'activo' ||
        !tieneRol(identidad.id, 'docente')) {
      throw fallo(403, 'PERMISO_INSUFICIENTE');
    }

    const ids = [
      ref.ejemplar_ofrecido_id, ref.ejemplar_solicitado_id
    ].sort((a, b) => a - b);

    // Mismo orden de bloqueo que reserva y edición de anuncios.
    const ejemplares = await c.query(
      `SELECT * FROM ejemplar WHERE id=ANY($1::integer[])
       ORDER BY id FOR UPDATE`,
      [ids]
    );

    const anuncios = await c.query(
      `SELECT * FROM anuncio WHERE ejemplar_id=ANY($1::integer[])
       ORDER BY ejemplar_id FOR UPDATE`,
      [ids]
    );

    const op = (
      await c.query(
        'SELECT * FROM operacion WHERE id=$1 FOR UPDATE',
        [id]
      )
    ).rows[0];

    if (!op || op.tipo !== 'intercambio') {
      throw fallo(404, 'INTERCAMBIO_NO_DISPONIBLE');
    }

    // Repetir una entrega confirmada devuelve el estado existente.
    // No vuelve a escribir eventos, avisos ni estados.
    if (accion === 'entregar' && op.estado === 'completada') {
      await c.query('COMMIT');
      return op;
    }

    if (op.estado !== 'reservada') {
      throw fallo(409, 'OPERACION_NO_RESERVADA');
    }

    if (ejemplares.rowCount !== 2 || anuncios.rowCount !== 2) {
      throw fallo(409, 'PAREJA_INCOHERENTE');
    }

    const items = await c.query(
      `SELECT * FROM operacion_item WHERE operacion_id=$1
       ORDER BY ejemplar_id FOR UPDATE`,
      [id]
    );

    const itemCorrecto = (ejemplarId, origen, destino) =>
      items.rows.some(i =>
        i.ejemplar_id === ejemplarId &&
        i.origen_usuario_id === origen &&
        i.destino_usuario_id === destino
      );

    if (items.rowCount !== 2 ||
        !itemCorrecto(
          ref.ejemplar_ofrecido_id, ref.proponente_id, ref.receptor_id
        ) ||
        !itemCorrecto(
          ref.ejemplar_solicitado_id, ref.receptor_id, ref.proponente_id
        )) {
      throw fallo(409, 'ITEMS_INCOHERENTES');
    }

    const reservas = await c.query(
      `SELECT ejemplar_id FROM reserva_activa
       WHERE operacion_id=$1 ORDER BY ejemplar_id FOR UPDATE`,
      [id]
    );

    if (reservas.rowCount !== 2 ||
        !ids.every(ejemplarId =>
          reservas.rows.some(r => r.ejemplar_id === ejemplarId))) {
      throw fallo(409, 'RESERVAS_INCOHERENTES');
    }

    if (accion === 'entregar') {
      for (const usuarioId of [ref.proponente_id, ref.receptor_id]) {
        const usuario = usuarios.rows.find(u => u.id === usuarioId);

        if (!usuario || usuario.estado !== 'activo' ||
            !tieneRol(usuarioId, 'alumno')) {
          throw fallo(409, 'PARTICIPANTES_NO_ACTIVOS');
        }
      }

      const parejas = [
        [ref.ejemplar_ofrecido_id, ref.proponente_id,
          ref.anuncio_ofrecido_id, ref.version_ofrecida],
        [ref.ejemplar_solicitado_id, ref.receptor_id,
          ref.anuncio_solicitado_id, ref.version_solicitada]
      ];

      for (const [ejemplarId, propietario, anuncioId, version] of parejas) {
        const e = ejemplares.rows.find(x => x.id === ejemplarId);
        const a = anuncios.rows.find(x => x.ejemplar_id === ejemplarId);

        if (e.propietario_usuario_id !== propietario ||
            e.estado_servicio !== 'habilitado' ||
            a.id !== anuncioId || a.version !== version ||
            a.modalidad !== 'intercambio' ||
            a.estado_revision !== 'publicado') {
          throw fallo(409, 'ACUERDO_DESACTUALIZADO');
        }
      }

      const recursos = await c.query(
        `SELECT id, tipo, origen FROM recurso
         WHERE id=ANY($1::integer[]) ORDER BY id FOR SHARE`,
        [[...new Set(ejemplares.rows.map(e => e.recurso_id))]]
      );

      if (recursos.rows.some(r =>
        r.tipo !== 'fisico' || r.origen !== 'alumno')) {
        throw fallo(409, 'EJEMPLAR_NO_APTO');
      }

      const aceptaciones = await c.query(
        `SELECT usuario_id FROM aceptacion_intercambio
         WHERE operacion_id=$1 ORDER BY usuario_id FOR SHARE`,
        [id]
      );

      if (aceptaciones.rowCount !== 2 ||
          ![ref.proponente_id, ref.receptor_id].every(usuarioId =>
            aceptaciones.rows.some(a => a.usuario_id === usuarioId))) {
        throw fallo(409, 'ACEPTACIONES_INCOHERENTES');
      }

      await c.query(
        `UPDATE ejemplar SET estado_servicio='retirado'
         WHERE id=ANY($1::integer[])`,
        [ids]
      );

      await c.query(
        `UPDATE anuncio
         SET estado_revision='retirado',
             version=version+1, actualizada_en=now()
         WHERE ejemplar_id=ANY($1::integer[])`,
        [ids]
      );

      for (const anuncio of anuncios.rows) {
        await c.query(
          `INSERT INTO evento_anuncio
           (anuncio_id,actor_id,accion,estado_anterior,estado_nuevo)
           VALUES($1,$2,'intercambio_completado',$3,'retirado')`,
          [anuncio.id, identidad.id, anuncio.estado_revision]
        );
      }
    }

    // Cancelar permite liberar material aunque un participante
    // se haya suspendido: no autoriza una entrega a esa cuenta.
    const estado = accion === 'entregar' ? 'completada' : 'cancelada';

    const actual = (
      await c.query(
        `UPDATE operacion
         SET estado=$2, cerrada_en=now(),
             entregada_en=CASE WHEN $2='completada'
               THEN now() ELSE entregada_en END
         WHERE id=$1 RETURNING *`,
        [id, estado]
      )
    ).rows[0];

    await c.query(
      'DELETE FROM reserva_activa WHERE operacion_id=$1',
      [id]
    );

    await c.query(
      `INSERT INTO evento_operacion
       (operacion_id,actor_id,accion,motivo)
       VALUES($1,$2,$3,$4)`,
      [id, identidad.id, accion, accion === 'cancelar' ? motivo.trim() : '']
    );

    for (const usuarioId of [ref.proponente_id, ref.receptor_id]) {
      await c.query(
        `INSERT INTO aviso(destinatario_id,mensaje,operacion_id)
         VALUES($1,$2,$3)`,
        [usuarioId, `Intercambio ${estado}.`, id]
      );
    }

    await c.query('COMMIT');
    return actual;
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