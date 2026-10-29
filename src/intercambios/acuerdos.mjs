// Propuestas y aceptaciones. Las reservas y la entrega las continuara Fede.
const fallo = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });

async function transaccion(pool, identidad, accion) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout = '3s'");
    const usuario = (await c.query(
      'SELECT estado, auth_version FROM usuario WHERE id=$1 FOR SHARE', [identidad.id]
    )).rows[0];
    if (!usuario || usuario.auth_version !== identidad.authVersion) throw fallo(401, 'SESION_CADUCADA');
    if (usuario.estado !== 'activo' || !(await c.query(
      "SELECT 1 FROM usuario_rol WHERE usuario_id=$1 AND rol='alumno'", [identidad.id]
    )).rowCount) throw fallo(403, 'PERMISO_INSUFICIENTE');
    const datos = await accion(c);
    await c.query('COMMIT');
    return datos;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    if (['23505', '55P03', '40P01'].includes(error.code)) throw fallo(409, 'CONFLICTO_RECARGA_EL_ESTADO');
    throw error;
  } finally { c.release(); }
}

async function participantesActivos(c, ids) {
  const usuarios = await c.query(`SELECT id, estado,
    EXISTS(SELECT 1 FROM usuario_rol r WHERE r.usuario_id=u.id AND rol='alumno') AS alumno
    FROM usuario u WHERE id=ANY($1::integer[]) ORDER BY id FOR SHARE`, [ids]);
  if (ids.length !== 2 || ids[0] === ids[1] || usuarios.rowCount !== 2 ||
      usuarios.rows.some(u => u.estado !== 'activo' || !u.alumno)) {
    throw fallo(409, 'PARTICIPANTES_NO_ACTIVOS');
  }
}

async function bloquearPareja(c, ids) {
  // Misma convencion que anuncios: ejemplares ordenados, anuncios y luego operacion.
  const ejemplares = await c.query(`SELECT e.*, r.tipo, r.origen
    FROM ejemplar e JOIN recurso r ON r.id=e.recurso_id
    WHERE e.id=ANY($1::integer[]) ORDER BY e.id FOR UPDATE OF e`, [ids]);
  if (ejemplares.rowCount !== 2) throw fallo(404, 'EJEMPLARES_NO_DISPONIBLES');
  const anuncios = await c.query(`SELECT * FROM anuncio
    WHERE ejemplar_id=ANY($1::integer[]) ORDER BY ejemplar_id FOR UPDATE`, [ids]);
  if (anuncios.rowCount !== 2) throw fallo(404, 'ANUNCIOS_NO_DISPONIBLES');
  return ids.map(id => ({ ...ejemplares.rows.find(e => e.id === id),
    anuncio: anuncios.rows.find(a => a.ejemplar_id === id) }));
}

async function comprobarDisponibilidad(c, pareja) {
  if (pareja.some(e => e.tipo !== 'fisico' || e.origen !== 'alumno' || !e.propietario_usuario_id)) {
    throw fallo(422, 'EJEMPLAR_NO_APTO');
  }
  if (pareja.some(e => e.anuncio.modalidad !== 'intercambio')) throw fallo(422, 'MODALIDAD_NO_ADMITIDA');
  if (pareja.some(e => e.estado_servicio !== 'habilitado' || e.anuncio.estado_revision !== 'publicado')) {
    throw fallo(409, 'ANUNCIO_NO_DISPONIBLE');
  }
  const ocupados = await c.query(`SELECT 1 FROM reserva_activa WHERE ejemplar_id=ANY($1::integer[])
    UNION ALL SELECT 1 FROM operacion_item i JOIN operacion o ON o.id=i.operacion_id
    WHERE i.ejemplar_id=ANY($1::integer[]) AND o.estado IN ('reservada','prestada')`,
  [pareja.map(e => e.id)]);
  if (ocupados.rowCount) throw fallo(409, 'EJEMPLAR_OCUPADO');
}

async function resumen(c, id) {
  return (await c.query(`SELECT o.id, o.estado,
    i.ejemplar_ofrecido_id AS "ejemplarOfrecidoId", i.ejemplar_solicitado_id AS "ejemplarSolicitadoId",
    i.version_ofrecida AS "versionOfrecida", i.version_solicitada AS "versionSolicitada",
    (SELECT count(*)::int FROM aceptacion_intercambio a WHERE a.operacion_id=o.id) AS aceptaciones
    FROM intercambio i JOIN operacion o ON o.id=i.operacion_id WHERE o.id=$1`, [id])).rows[0];
}

export function proponerIntercambio(pool, identidad, entrada) {
  return transaccion(pool, identidad, async c => {
    const ids = [entrada.ejemplarOfrecidoId, entrada.ejemplarSolicitadoId];
    // Leemos propietarios antes de bloquear y comprobamos otra vez tras el bloqueo.
    const referencias = await c.query('SELECT id, propietario_usuario_id FROM ejemplar WHERE id=ANY($1::integer[])', [ids]);
    if (referencias.rowCount !== 2) throw fallo(404, 'EJEMPLARES_NO_DISPONIBLES');
    const ofrecido = referencias.rows.find(e => e.id === ids[0]);
    const solicitado = referencias.rows.find(e => e.id === ids[1]);
    if (ofrecido.propietario_usuario_id !== identidad.id) throw fallo(403, 'PROPIEDAD_NECESARIA');
    if (!solicitado.propietario_usuario_id || solicitado.propietario_usuario_id === identidad.id) {
      throw fallo(422, 'PARTICIPANTES_DISTINTOS_NECESARIOS');
    }
    await participantesActivos(c, [identidad.id, solicitado.propietario_usuario_id]);
    const [a, b] = await bloquearPareja(c, ids);
    if (a.propietario_usuario_id !== identidad.id || b.propietario_usuario_id !== solicitado.propietario_usuario_id) {
      throw fallo(409, 'PROPIEDAD_DESACTUALIZADA');
    }
    await comprobarDisponibilidad(c, [a, b]);
    if ((await c.query(`SELECT 1 FROM intercambio i JOIN operacion o ON o.id=i.operacion_id
      WHERE i.proponente_id=$1 AND i.ejemplar_ofrecido_id=$2 AND i.ejemplar_solicitado_id=$3
      AND o.estado='propuesta'`, [identidad.id, a.id, b.id])).rowCount) {
      throw fallo(409, 'PROPUESTA_YA_EXISTENTE');
    }
    const operacion = (await c.query("INSERT INTO operacion(tipo,estado) VALUES('intercambio','propuesta') RETURNING id")).rows[0];
    await c.query(`INSERT INTO operacion_item
      (operacion_id,ejemplar_id,origen_usuario_id,destino_usuario_id)
      VALUES ($1,$2,$3,$4),($1,$5,$4,$3)`,
    [operacion.id, a.id, identidad.id, b.propietario_usuario_id, b.id]);
    await c.query(`INSERT INTO intercambio
      (operacion_id,proponente_id,receptor_id,ejemplar_ofrecido_id,ejemplar_solicitado_id,
       anuncio_ofrecido_id,anuncio_solicitado_id,version_ofrecida,version_solicitada)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [operacion.id, identidad.id, b.propietario_usuario_id, a.id, b.id,
      a.anuncio.id, b.anuncio.id, a.anuncio.version, b.anuncio.version]);
    await c.query('INSERT INTO aceptacion_intercambio(operacion_id,usuario_id) VALUES($1,$2)', [operacion.id, identidad.id]);
    await c.query(`INSERT INTO evento_operacion(operacion_id,actor_id,accion)
      VALUES($1,$2,'proponer_intercambio')`, [operacion.id, identidad.id]);
    await c.query('INSERT INTO aviso(destinatario_id,mensaje,operacion_id) VALUES($1,$2,$3)',
      [b.propietario_usuario_id, 'Nueva propuesta de intercambio pendiente de tu aceptacion.', operacion.id]);
    return resumen(c, operacion.id);
  });
}

export function aceptarIntercambio(pool, identidad, id, entrada) {
  return transaccion(pool, identidad, async c => {
    const ref = (await c.query('SELECT * FROM intercambio WHERE operacion_id=$1', [id])).rows[0];
    if (!ref) throw fallo(404, 'INTERCAMBIO_NO_DISPONIBLE');
    if (ref.receptor_id !== identidad.id) throw fallo(403, 'SOLO_RECEPTOR_PUEDE_ACEPTAR');
    if (entrada.ejemplarOfrecidoId !== ref.ejemplar_ofrecido_id ||
        entrada.ejemplarSolicitadoId !== ref.ejemplar_solicitado_id ||
        entrada.versionOfrecida !== ref.version_ofrecida || entrada.versionSolicitada !== ref.version_solicitada) {
      throw fallo(409, 'ACUERDO_DESACTUALIZADO');
    }
    await participantesActivos(c, [ref.proponente_id, ref.receptor_id]);
    const [a, b] = await bloquearPareja(c, [ref.ejemplar_ofrecido_id, ref.ejemplar_solicitado_id]);
    const operacion = (await c.query('SELECT estado FROM operacion WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (operacion.estado !== 'propuesta') throw fallo(409, 'PROPUESTA_NO_VIGENTE');
    if (a.propietario_usuario_id !== ref.proponente_id || b.propietario_usuario_id !== ref.receptor_id ||
        a.anuncio.id !== ref.anuncio_ofrecido_id || b.anuncio.id !== ref.anuncio_solicitado_id ||
        a.anuncio.version !== ref.version_ofrecida || b.anuncio.version !== ref.version_solicitada) {
      throw fallo(409, 'ACUERDO_DESACTUALIZADO');
    }
    await comprobarDisponibilidad(c, [a, b]);
    const alta = await c.query(`INSERT INTO aceptacion_intercambio(operacion_id,usuario_id)
      VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING usuario_id`, [id, identidad.id]);
    if (alta.rowCount) {
      await c.query(`INSERT INTO evento_operacion(operacion_id,actor_id,accion)
        VALUES($1,$2,'aceptar_intercambio')`, [id, identidad.id]);
      await c.query('INSERT INTO aviso(destinatario_id,mensaje,operacion_id) VALUES($1,$2,$3)',
        [ref.proponente_id, 'El receptor ha aceptado. Pendiente de confirmacion docente.', id]);
    }
    return resumen(c, id);
  });
}

export async function consultarIntercambio(pool, usuarioId, id) {
  const permiso = await pool.query(`SELECT 1 FROM intercambio
    WHERE operacion_id=$1 AND (proponente_id=$2 OR receptor_id=$2)`, [id, usuarioId]);
  if (!permiso.rowCount) throw fallo(404, 'INTERCAMBIO_NO_DISPONIBLE');
  return resumen(pool, id);
}
