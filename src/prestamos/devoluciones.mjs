import { Router } from 'express';

const fallo = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });

export async function devolverPrestamo(pool, identidad, id, entrada) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout='3s'");
    const docente = (await c.query(
      'SELECT estado,auth_version FROM usuario WHERE id=$1 FOR SHARE', [identidad.id]
    )).rows[0];
    if (!docente || docente.auth_version !== identidad.authVersion) throw fallo(401,'SESION_CADUCADA');
    const rol = await c.query(
      "SELECT 1 FROM usuario_rol WHERE usuario_id=$1 AND rol='docente' FOR SHARE", [identidad.id]
    );
    if (docente.estado !== 'activo' || !rol.rowCount) throw fallo(403,'PERMISO_INSUFICIENTE');

    const referencias = await c.query(
      'SELECT ejemplar_id FROM operacion_item WHERE operacion_id=$1 ORDER BY ejemplar_id', [id]
    );
    if (!referencias.rowCount) throw fallo(404,'OPERACION_NO_DISPONIBLE');
    // Convención compartida: ejemplares, anuncios y después operación.
    const ids = referencias.rows.map(i => i.ejemplar_id);
    const ejemplares = await c.query(
      'SELECT * FROM ejemplar WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE', [ids]
    );
    await c.query('SELECT id FROM anuncio WHERE ejemplar_id=ANY($1::integer[]) ORDER BY ejemplar_id FOR UPDATE',[ids]);
    const op = (await c.query('SELECT * FROM operacion WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (!op) throw fallo(404,'OPERACION_NO_DISPONIBLE');
    if (op.tipo !== 'prestamo') throw fallo(409,'SOLO_DEVOLUCION_DE_PRESTAMO');
    if (op.estado !== 'prestada' || !op.entregada_en || !op.vencimiento || op.cerrada_en) {
      throw fallo(409,'PRESTAMO_NO_DEVOLVIBLE');
    }
    const items = await c.query('SELECT * FROM operacion_item WHERE operacion_id=$1 ORDER BY ejemplar_id FOR UPDATE',[id]);
    if (items.rowCount !== 1 || ejemplares.rowCount !== 1 || items.rows[0].ejemplar_id !== ids[0]) {
      throw fallo(409,'OPERACION_INCOHERENTE');
    }
    const e = ejemplares.rows[0];
    const reservas = await c.query(
      'SELECT ejemplar_id,operacion_id FROM reserva_activa WHERE operacion_id=$1 OR ejemplar_id=$2 ORDER BY ejemplar_id FOR UPDATE',[id,e.id]
    );
    if (reservas.rowCount !== 1 || reservas.rows[0].operacion_id !== id || reservas.rows[0].ejemplar_id !== e.id) {
      throw fallo(409,'RESERVA_INCOHERENTE');
    }
    const incidencias = await c.query(
      "SELECT id FROM incidencia WHERE operacion_id=$1 AND estado='abierta' ORDER BY id FOR UPDATE",[id]
    );
    if (incidencias.rowCount) throw fallo(409,'INCIDENCIA_PENDIENTE');
    if (!entrada.apto || e.estado_servicio !== 'habilitado') throw fallo(409,'REQUIERE_GESTION_INCIDENCIA');
    // Un vencimiento pasado no impide devolver ni libera por sí solo.
    await c.query('UPDATE ejemplar SET conservacion=$1 WHERE id=$2',[entrada.conservacion.trim(),e.id]);
    const actual = (await c.query(
      "UPDATE operacion SET estado='completada',cerrada_en=now() WHERE id=$1 RETURNING id,tipo,estado,entregada_en,cerrada_en",[id]
    )).rows[0];
    await c.query('DELETE FROM reserva_activa WHERE operacion_id=$1',[id]);
    await c.query(
      "INSERT INTO evento_operacion(operacion_id,actor_id,accion,motivo) VALUES($1,$2,'devolver',$3)",
      [id,identidad.id,entrada.conservacion.trim()]
    );
    const destinatarios = [...new Set([items.rows[0].origen_usuario_id,items.rows[0].destino_usuario_id].filter(x => x !== null))];
    for (const usuarioId of destinatarios) await c.query(
      'INSERT INTO aviso(destinatario_id,mensaje,operacion_id) VALUES($1,$2,$3)',
      [usuarioId,'Devolución del préstamo confirmada por el docente.',id]
    );
    await c.query('COMMIT');
    return actual;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    if (['23505','55P03','40P01'].includes(error.code)) throw fallo(409,'CONFLICTO_RECARGA_EL_ESTADO');
    throw error;
  } finally { c.release(); }
}

export function rutasDevoluciones(pool,sesion,activa) {
  const r = Router();
  r.post('/gestion/operaciones/:id/devolver',sesion,activa,async (req,res,next) => {
    try {
      if (!req.usuario.roles.includes('docente')) throw fallo(403,'PERMISO_INSUFICIENTE');
      const id=Number(req.params.id),b=req.body;
      if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id) || id>2147483647 ||
          !b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length!==2 ||
          !Object.hasOwn(b,'conservacion') || !Object.hasOwn(b,'apto') ||
          typeof b.apto!=='boolean' || typeof b.conservacion!=='string' ||
          !b.conservacion.trim() || b.conservacion.trim().length>500) throw fallo(422,'DATOS_INVALIDOS');
      res.json({datos:await devolverPrestamo(pool,{id:req.usuario.id,authVersion:req.session.authVersion},id,b)});
    } catch(error) {
      if (error.codigo) return res.status(error.codigo).json({error:error.message});
      next(error);
    }
  });
  return r;
}
