import { Router } from 'express';

const tipos = ['cesion', 'prestamo', 'intercambio'];
const estados = ['propuesta', 'reservada', 'prestada', 'completada', 'cancelada', 'cerrada_por_incidencia'];
const entero = (valor, maximo) => /^[1-9]\d*$/.test(String(valor)) && Number.isSafeInteger(Number(valor)) && Number(valor) <= maximo;

export function rutasHistorial(pool, sesion, activa) {
  const r = Router();
  const participante = (req, res, next) => req.usuario.roles.some(rol => ['alumno', 'docente'].includes(rol))
    ? next() : res.status(403).json({error:'PERMISO_INSUFICIENTE'});

  for (const ruta of ['/mi-espacio/historial', '/gestion/historial']) {
    r.get(ruta, sesion, activa, participante, async (req, res) => {
      const docente = ruta === '/gestion/historial';
      if (docente && !req.usuario.roles.includes('docente')) return res.status(403).json({error:'PERMISO_DOCENTE_NECESARIO'});
      const {pagina='1', limite='10', tipo, estado} = req.query;
      if (Object.keys(req.query).some(c => !['pagina','limite','tipo','estado'].includes(c)) ||
          !entero(pagina,100000) || !entero(limite,20) || (tipo !== undefined && !tipos.includes(tipo)) ||
          (estado !== undefined && !estados.includes(estado))) return res.status(422).json({error:'FILTROS_INVALIDOS'});
      const valores = [req.usuario.id, docente, tipo ?? null, estado ?? null, Number(limite)+1, (Number(pagina)-1)*Number(limite)];
      // EXISTS autoriza la operación completa; no duplica una operación por sus ítems/eventos.
      // Sin filtros por curso actual ni categoría activa: las referencias históricas se conservan.
      const operaciones = (await pool.query(`SELECT o.id,o.tipo,o.estado,o.creada_en,o.entregada_en,o.cerrada_en,o.vencimiento,
        COALESCE((SELECT json_agg(json_build_object('codigo',e.codigo,'titulo',f.titulo,
          'origen_usuario_id',i.origen_usuario_id,'destino_usuario_id',i.destino_usuario_id)
          ORDER BY e.id) FROM operacion_item i JOIN ejemplar e ON e.id=i.ejemplar_id
          JOIN recurso f ON f.id=e.recurso_id WHERE i.operacion_id=o.id),'[]') AS items,
        COALESCE((SELECT json_agg(json_build_object('id',v.id,'actor_id',v.actor_id,'actor',autor.alias,'accion',v.accion,
          'fecha',v.creada_en,'motivo',v.motivo) ORDER BY v.creada_en,v.id)
          FROM evento_operacion v JOIN usuario autor ON autor.id=v.actor_id WHERE v.operacion_id=o.id),'[]') AS eventos
        FROM operacion o WHERE ($2 OR EXISTS(SELECT 1 FROM operacion_item i WHERE i.operacion_id=o.id
          AND (i.origen_usuario_id=$1 OR i.destino_usuario_id=$1)))
          AND ($3::text IS NULL OR o.tipo=$3) AND ($4::text IS NULL OR o.estado=$4)
        ORDER BY o.creada_en DESC,o.id DESC LIMIT $5 OFFSET $6`,valores)).rows;
      const solicitudes = (await pool.query(`SELECT s.id,s.estado,s.creada_en,e.codigo,f.titulo
        FROM solicitud s JOIN ejemplar e ON e.id=s.ejemplar_id JOIN recurso f ON f.id=e.recurso_id
        WHERE ($2 OR s.solicitante_id=$1) ORDER BY s.creada_en DESC,s.id DESC LIMIT $3 OFFSET $4`,
      [req.usuario.id,docente,Number(limite)+1,(Number(pagina)-1)*Number(limite)])).rows;
      const datos = operaciones.slice(0,Number(limite)).map(o => ({...o, siguiente_accion:
        o.estado === 'prestada' ? 'Devolución o incidencia por el profesorado' :
          o.estado === 'reservada' ? 'Entrega o cancelación por el profesorado' :
            o.estado === 'propuesta' ? 'Revisar acuerdo y aceptaciones' : 'Operación cerrada; consultar historial'}));
      res.json({operaciones:datos,solicitudes:solicitudes.slice(0,Number(limite)),pagina:Number(pagina),limite:Number(limite),
        hayMas:operaciones.length>Number(limite)||solicitudes.length>Number(limite)});
    });
  }

  r.post('/avisos/:id/leido', sesion, activa, async (req,res) => {
    if (!entero(req.params.id,2147483647) || !req.body || Array.isArray(req.body) || Object.keys(req.body).length) {
      return res.status(422).json({error:'DATOS_INVALIDOS'});
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const actor = (await c.query('SELECT estado,auth_version FROM usuario WHERE id=$1 FOR SHARE',[req.usuario.id])).rows[0];
      if (actor?.estado !== 'activo' || actor.auth_version !== req.session.authVersion) {
        await c.query('ROLLBACK');return res.status(403).json({error:'SESION_NO_AUTORIZADA'});
      }
      const aviso = (await c.query(`UPDATE aviso SET leido_en=COALESCE(leido_en,now())
        WHERE id=$1 AND destinatario_id=$2 RETURNING id,mensaje,operacion_id,creado_en,leido_en`,[Number(req.params.id),req.usuario.id])).rows[0];
      await c.query('COMMIT');
      if (!aviso) return res.status(404).json({error:'AVISO_NO_DISPONIBLE'});
      res.json({datos:aviso});
    } catch(error) {await c.query('ROLLBACK').catch(()=>{});throw error;}
    finally {c.release();}
  });
  return r;
}
