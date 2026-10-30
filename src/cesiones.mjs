import { Router } from 'express';
import { gestionarIntercambio } from './intercambios/gestion.mjs';
const idValido=x=>Number.isSafeInteger(x)&&x>0;
const fallo=(codigo,error)=>Object.assign(new Error(error),{codigo});
export function rutasCesiones(pool,sesion,activa){
 const r=Router();r.use(['/gestion/anuncios','/gestion/solicitudes','/gestion/operaciones','/solicitudes','/operaciones','/avisos'],sesion,activa);
 const rol=nombre=>(req,res,next)=>req.usuario.roles.includes(nombre)?next():res.status(403).json({error:'PERMISO_INSUFICIENTE'});
 const docente=rol('docente'),alumno=rol('alumno');
 function cuerpo(req,campos){if(!req.body||Array.isArray(req.body)||Object.keys(req.body).some(k=>!campos.includes(k)))throw fallo(422,'DATOS_INVALIDOS');}
 function pagina(req){const p=Number(req.query.pagina??1),l=Number(req.query.limite??20);if(Object.keys(req.query).some(k=>!['pagina','limite'].includes(k))||!idValido(p)||p>100000||!idValido(l)||l>20)throw fallo(422,'PAGINACION_INVALIDA');return [l,(p-1)*l];}
 const ruta=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.codigo)return res.status(e.codigo).json({error:e.message});next(e);}};
 async function tx(req,permiso,fn){
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");
   const u=(await c.query('SELECT estado,auth_version FROM usuario WHERE id=$1 FOR SHARE',[req.usuario.id])).rows[0];
   if(!u||u.auth_version!==req.session.authVersion)throw fallo(401,'SESION_CADUCADA');
   if(u.estado!=='activo'||!(await c.query('SELECT 1 FROM usuario_rol WHERE usuario_id=$1 AND rol=$2',[req.usuario.id,permiso])).rowCount)throw fallo(403,'PERMISO_INSUFICIENTE');
   const resultado=await fn(c);await c.query('COMMIT');return resultado;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});if(['23505','55P03','40P01'].includes(e.code))throw fallo(409,'CONFLICTO_RECARGA_EL_ESTADO');throw e;}finally{c.release();}
 }
 async function ejemplar(c,id){
  const e=(await c.query('SELECT * FROM ejemplar WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!e)throw fallo(404,'EJEMPLAR_NO_DISPONIBLE');
  const a=(await c.query('SELECT * FROM anuncio WHERE ejemplar_id=$1 FOR UPDATE',[id])).rows[0];
  if(!a)throw fallo(404,'ANUNCIO_NO_DISPONIBLE');return {e,a};
 }
 async function disponible(c,e,a){if(e.estado_servicio!=='habilitado'||a.estado_revision!=='publicado'||(await c.query(`SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1 UNION ALL SELECT 1 FROM operacion_item i JOIN operacion o ON o.id=i.operacion_id WHERE i.ejemplar_id=$1 AND o.estado IN ('reservada','prestada')`,[e.id])).rowCount)throw fallo(409,'EJEMPLAR_NO_DISPONIBLE');}
 async function cuentas(c,ids){const u=await c.query('SELECT id,estado FROM usuario WHERE id=ANY($1::integer[]) ORDER BY id FOR SHARE',[ids]);if(ids.some(id=>!u.rows.some(x=>x.id===id&&x.estado==='activo')))throw fallo(409,'PARTICIPANTE_NO_ACTIVO');}
 async function aviso(c,destino,mensaje,op=null){await c.query('INSERT INTO aviso(destinatario_id,mensaje,operacion_id) VALUES($1,$2,$3)',[destino,mensaje,op]);}
 r.get('/gestion/anuncios',docente,ruta(async(req,res)=>{const p=pagina(req);res.json({datos:(await pool.query(`SELECT a.*,r.titulo,r.edicion,r.asignatura,r.curso_id,e.conservacion,e.codigo FROM anuncio a JOIN ejemplar e ON e.id=a.ejemplar_id JOIN recurso r ON r.id=e.recurso_id WHERE a.estado_revision='pendiente' ORDER BY a.id LIMIT $1 OFFSET $2`,p)).rows});}));
 r.post('/gestion/anuncios/:id/revision',docente,ruta(async(req,res)=>{
  cuerpo(req,['version','decision','motivo']);const id=Number(req.params.id),b=req.body;
  if(!idValido(id)||!idValido(b.version)||!['aprobar','rechazar'].includes(b.decision)||typeof b.motivo!=='string'||b.motivo.length>1000||(b.decision==='rechazar'&&!b.motivo.trim()))throw fallo(422,'DATOS_INVALIDOS');
  const datos=await tx(req,'docente',async c=>{const ref=(await c.query('SELECT ejemplar_id FROM anuncio WHERE id=$1',[id])).rows[0];if(!ref)throw fallo(404,'ANUNCIO_NO_DISPONIBLE');const {e,a}=await ejemplar(c,ref.ejemplar_id);
   if(a.estado_revision!=='pendiente'||a.version!==b.version||e.estado_servicio!=='habilitado')throw fallo(409,'REVISION_DESACTUALIZADA');
   const estado=b.decision==='aprobar'?'publicado':'rechazado';
   if(estado==='publicado'){await cuentas(c,[e.propietario_usuario_id]);const ficha=(await c.query('SELECT r.*,c.activo FROM recurso r JOIN curso c ON c.id=r.curso_id WHERE r.id=$1',[e.recurso_id])).rows[0];if(!ficha?.activo||!ficha.edicion.trim()||!e.conservacion.trim())throw fallo(422,'FICHA_INCOMPLETA');}
   const actual=(await c.query('UPDATE anuncio SET estado_revision=$1,motivo=$2,version=version+1,actualizada_en=now() WHERE id=$3 RETURNING *',[estado,b.motivo.trim(),id])).rows[0];
   await c.query('INSERT INTO evento_anuncio(anuncio_id,actor_id,accion,estado_anterior,estado_nuevo,motivo) VALUES($1,$2,$3,$4,$5,$6)',[id,req.usuario.id,b.decision,a.estado_revision,estado,b.motivo.trim()]);await aviso(c,e.propietario_usuario_id,'Revisión: '+estado+'. '+b.motivo.trim());return actual;});res.json({datos});
 }));
 r.post('/solicitudes',alumno,ruta(async(req,res)=>{cuerpo(req,['ejemplarId']);if(!idValido(req.body.ejemplarId))throw fallo(422,'DATOS_INVALIDOS');const datos=await tx(req,'alumno',async c=>{const {e,a}=await ejemplar(c,req.body.ejemplarId);if(e.propietario_usuario_id===req.usuario.id)throw fallo(422,'SOLICITUD_PROPIA');if(a.modalidad!=='cesion')throw fallo(422,'MODALIDAD_NO_ADMITIDA');await disponible(c,e,a);await cuentas(c,[e.propietario_usuario_id]);return (await c.query('INSERT INTO solicitud(ejemplar_id,solicitante_id) VALUES($1,$2) RETURNING *',[e.id,req.usuario.id])).rows[0];});res.status(201).json({datos});}));
 r.get('/solicitudes',ruta(async(req,res)=>{const p=pagina(req),doc=req.usuario.roles.includes('docente');res.json({datos:(await pool.query(`SELECT s.*,r.titulo FROM solicitud s JOIN ejemplar e ON e.id=s.ejemplar_id JOIN recurso r ON r.id=e.recurso_id WHERE ($1 OR s.solicitante_id=$2) ORDER BY s.id DESC LIMIT $3 OFFSET $4`,[doc,req.usuario.id,...p])).rows});}));
 r.post('/solicitudes/:id/cancelar',alumno,ruta(async(req,res)=>{cuerpo(req,[]);const id=Number(req.params.id);if(!idValido(id))throw fallo(422,'ID_INVALIDO');const datos=await tx(req,'alumno',async c=>{const s=(await c.query("UPDATE solicitud SET estado='cancelada' WHERE id=$1 AND solicitante_id=$2 AND estado='pendiente' RETURNING *",[id,req.usuario.id])).rows[0];if(!s)throw fallo(409,'SOLICITUD_NO_CANCELABLE');return s;});res.json({datos});}));
 r.post('/gestion/solicitudes/:id/asignar',docente,ruta(async(req,res)=>{cuerpo(req,['motivo']);const id=Number(req.params.id),motivo=req.body.motivo;if(!idValido(id)||typeof motivo!=='string'||!motivo.trim()||motivo.length>1000)throw fallo(422,'MOTIVO_NECESARIO');
  const datos=await tx(req,'docente',async c=>{const ref=(await c.query('SELECT ejemplar_id FROM solicitud WHERE id=$1',[id])).rows[0];if(!ref)throw fallo(404,'SOLICITUD_NO_DISPONIBLE');const {e,a}=await ejemplar(c,ref.ejemplar_id);await disponible(c,e,a);const s=(await c.query('SELECT * FROM solicitud WHERE id=$1 FOR UPDATE',[id])).rows[0];if(s.estado!=='pendiente'||a.modalidad!=='cesion'||s.solicitante_id===e.propietario_usuario_id)throw fallo(409,'SOLICITUD_NO_ASIGNABLE');await cuentas(c,[e.propietario_usuario_id,s.solicitante_id]);
   const op=(await c.query("INSERT INTO operacion(tipo,estado,docente_id) VALUES('cesion','reservada',$1) RETURNING *",[req.usuario.id])).rows[0];await c.query('INSERT INTO operacion_item VALUES($1,$2,$3,$4)',[op.id,e.id,e.propietario_usuario_id,s.solicitante_id]);await c.query('INSERT INTO reserva_activa VALUES($1,$2)',[e.id,op.id]);
   const solicitudes=await c.query("UPDATE solicitud SET estado=CASE WHEN id=$1 THEN 'adjudicada' ELSE 'rechazada' END WHERE ejemplar_id=$2 AND estado='pendiente' RETURNING *",[id,e.id]);for(const otra of solicitudes.rows)await aviso(c,otra.solicitante_id,'Solicitud '+otra.estado,op.id);
   await aviso(c,e.propietario_usuario_id,'Cesión reservada',op.id);await c.query("INSERT INTO evento_operacion(operacion_id,actor_id,accion,motivo) VALUES($1,$2,'asignar',$3)",[op.id,req.usuario.id,motivo.trim()]);return op;});res.status(201).json({datos});
 }));
 r.get('/operaciones',ruta(async(req,res)=>{const p=pagina(req);res.json({datos:(await pool.query(`SELECT o.*,i.ejemplar_id,i.origen_usuario_id,i.destino_usuario_id,r.titulo FROM operacion o JOIN operacion_item i ON i.operacion_id=o.id JOIN ejemplar e ON e.id=i.ejemplar_id JOIN recurso r ON r.id=e.recurso_id WHERE o.tipo='cesion' AND ($1 OR i.origen_usuario_id=$2 OR i.destino_usuario_id=$2) ORDER BY o.id DESC LIMIT $3 OFFSET $4`,[req.usuario.roles.includes('docente'),req.usuario.id,...p])).rows});}));
 for(const accion of ['entregar','cancelar'])r.post(`/gestion/operaciones/:id/${accion}`,docente,ruta(async(req,res)=>{cuerpo(req,accion==='cancelar'?['motivo']:[]);const id=Number(req.params.id);if(!idValido(id)||(accion==='cancelar'&&(typeof req.body.motivo!=='string'||!req.body.motivo.trim()||req.body.motivo.length>1000)))throw fallo(422,'DATOS_INVALIDOS');
  // Las rutas son comunes: cada tipo utiliza su propio servicio.
  const referencia = (
    await pool.query(
      'SELECT tipo FROM operacion WHERE id=$1',
      [id]
    )
  ).rows[0];

  if (!referencia) {
    throw fallo(404, 'OPERACION_NO_DISPONIBLE');
  }

  if (referencia.tipo === 'intercambio') {
    const datos = await gestionarIntercambio(
      pool,
      {
        id: req.usuario.id,
        authVersion: req.session.authVersion
      },
      id,
      accion,
      req.body.motivo
    );

    return res.json({ datos });
  }
  const datos=await tx(req,'docente',async c=>{const items=(await c.query('SELECT * FROM operacion_item WHERE operacion_id=$1 ORDER BY ejemplar_id',[id])).rows;if(items.length!==1)throw fallo(404,'CESION_NO_DISPONIBLE');const i=items[0];const {e,a}=await ejemplar(c,i.ejemplar_id);const op=(await c.query('SELECT * FROM operacion WHERE id=$1 FOR UPDATE',[id])).rows[0];if(op.tipo!=='cesion')throw fallo(409,'MODALIDAD_NO_ADMITIDA');if(accion==='entregar'&&op.estado==='completada')return op;if(op.estado!=='reservada')throw fallo(409,'OPERACION_NO_RESERVADA');if(!(await c.query('SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1 AND operacion_id=$2',[e.id,id])).rowCount)throw fallo(409,'RESERVA_INCOHERENTE');
   if(accion==='entregar'){await cuentas(c,[i.origen_usuario_id,i.destino_usuario_id]);await c.query("UPDATE ejemplar SET estado_servicio='retirado' WHERE id=$1",[e.id]);await c.query("UPDATE anuncio SET estado_revision='retirado',version=version+1,actualizada_en=now() WHERE id=$1",[a.id]);await c.query("INSERT INTO evento_anuncio(anuncio_id,actor_id,accion,estado_anterior,estado_nuevo) VALUES($1,$2,'cesion_completada',$3,'retirado')",[a.id,req.usuario.id,a.estado_revision]);}
   const estado=accion==='entregar'?'completada':'cancelada';const actual=(await c.query(`UPDATE operacion SET estado=$1,cerrada_en=now(),entregada_en=CASE WHEN $1='completada' THEN now() ELSE entregada_en END WHERE id=$2 RETURNING *`,[estado,id])).rows[0];await c.query('DELETE FROM reserva_activa WHERE operacion_id=$1',[id]);await c.query('INSERT INTO evento_operacion(operacion_id,actor_id,accion,motivo) VALUES($1,$2,$3,$4)',[id,req.usuario.id,accion,req.body.motivo?.trim()??'']);for(const u of [i.origen_usuario_id,i.destino_usuario_id])await aviso(c,u,'Cesión '+estado,id);return actual;});res.json({datos});
 }));
 r.get('/avisos',ruta(async(req,res)=>{const p=pagina(req);res.json({datos:(await pool.query('SELECT * FROM aviso WHERE destinatario_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[req.usuario.id,...p])).rows});}));
 return r;
}
