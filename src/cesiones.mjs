import { Router } from 'express';
const idValido=x=>Number.isSafeInteger(x)&&x>0;
const fallo=(codigo,error)=>Object.assign(new Error(error),{codigo});
export function rutasCesiones(pool,sesion,activa){
 const r=Router();r.use(['/gestion/anuncios','/gestion/solicitudes','/gestion/operaciones','/solicitudes','/operaciones','/avisos','/intercambios','/gestion/intercambios','/gestion/cola'],sesion,activa);
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
  return {e,a};
 }
 async function disponible(c,e,a){
  const recurso=(await c.query('SELECT origen,tipo FROM recurso WHERE id=$1',[e.recurso_id])).rows[0];
  if(e.estado_servicio!=='habilitado'||recurso?.tipo!=='fisico'||(a?a.estado_revision!=='publicado':recurso?.origen!=='centro')||(await c.query(`SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1 UNION ALL SELECT 1 FROM operacion_item i JOIN operacion o ON o.id=i.operacion_id WHERE i.ejemplar_id=$1 AND o.estado IN ('reservada','prestada')`,[e.id])).rowCount)throw fallo(409,'EJEMPLAR_NO_DISPONIBLE');
 }
 async function cuentas(c,ids){const u=await c.query('SELECT id,estado FROM usuario WHERE id=ANY($1::integer[]) ORDER BY id FOR SHARE',[ids]);ids=ids.filter(Boolean);if(ids.some(id=>!u.rows.some(x=>x.id===id&&x.estado==='activo')))throw fallo(409,'PARTICIPANTE_NO_ACTIVO');}
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
   await c.query('INSERT INTO evento_anuncio(anuncio_id,actor_id,accion,estado_anterior,estado_nuevo,motivo) VALUES($1,$2,$3,$4,$5,$6)',[id,req.usuario.id,b.decision,a.estado_revision,estado,b.motivo.trim()]);if(e.propietario_usuario_id)await aviso(c,e.propietario_usuario_id,'Revisión: '+estado+'. '+b.motivo.trim());return actual;});res.json({datos});
 }));
 r.post('/solicitudes',alumno,ruta(async(req,res)=>{cuerpo(req,['ejemplarId']);if(!idValido(req.body.ejemplarId))throw fallo(422,'DATOS_INVALIDOS');const datos=await tx(req,'alumno',async c=>{const {e,a}=await ejemplar(c,req.body.ejemplarId);if(e.propietario_usuario_id===req.usuario.id)throw fallo(422,'SOLICITUD_PROPIA');if(a&& !['cesion','prestamo'].includes(a.modalidad))throw fallo(422,'MODALIDAD_NO_ADMITIDA');await disponible(c,e,a);await cuentas(c,[e.propietario_usuario_id]);return (await c.query('INSERT INTO solicitud(ejemplar_id,solicitante_id) VALUES($1,$2) RETURNING *',[e.id,req.usuario.id])).rows[0];});res.status(201).json({datos});}));
 r.get('/solicitudes',ruta(async(req,res)=>{const p=pagina(req),doc=req.usuario.roles.includes('docente');res.json({datos:(await pool.query(`SELECT s.*,r.titulo FROM solicitud s JOIN ejemplar e ON e.id=s.ejemplar_id JOIN recurso r ON r.id=e.recurso_id WHERE ($1 OR s.solicitante_id=$2) ORDER BY s.id DESC LIMIT $3 OFFSET $4`,[doc,req.usuario.id,...p])).rows});}));
 r.post('/solicitudes/:id/cancelar',alumno,ruta(async(req,res)=>{cuerpo(req,[]);const id=Number(req.params.id);if(!idValido(id))throw fallo(422,'ID_INVALIDO');const datos=await tx(req,'alumno',async c=>{const s=(await c.query("UPDATE solicitud SET estado='cancelada' WHERE id=$1 AND solicitante_id=$2 AND estado='pendiente' RETURNING *",[id,req.usuario.id])).rows[0];if(!s)throw fallo(409,'SOLICITUD_NO_CANCELABLE');return s;});res.json({datos});}));
 r.post('/gestion/solicitudes/:id/asignar',docente,ruta(async(req,res)=>{cuerpo(req,['motivo']);const id=Number(req.params.id),motivo=req.body.motivo;if(!idValido(id)||typeof motivo!=='string'||!motivo.trim()||motivo.length>1000)throw fallo(422,'MOTIVO_NECESARIO');
  const datos=await tx(req,'docente',async c=>{const ref=(await c.query('SELECT ejemplar_id FROM solicitud WHERE id=$1',[id])).rows[0];if(!ref)throw fallo(404,'SOLICITUD_NO_DISPONIBLE');const {e,a}=await ejemplar(c,ref.ejemplar_id);await disponible(c,e,a);const s=(await c.query('SELECT * FROM solicitud WHERE id=$1 FOR UPDATE',[id])).rows[0];if(s.estado!=='pendiente'||(a&&!['cesion','prestamo'].includes(a.modalidad))||s.solicitante_id===e.propietario_usuario_id)throw fallo(409,'SOLICITUD_NO_ASIGNABLE');await cuentas(c,[e.propietario_usuario_id,s.solicitante_id]);
   const op=(await c.query("INSERT INTO operacion(tipo,estado,docente_id) VALUES($2,'reservada',$1) RETURNING *",[req.usuario.id,a?.modalidad??'prestamo'])).rows[0];await c.query('INSERT INTO operacion_item VALUES($1,$2,$3,$4)',[op.id,e.id,e.propietario_usuario_id,s.solicitante_id]);await c.query('INSERT INTO reserva_activa VALUES($1,$2)',[e.id,op.id]);
   const solicitudes=await c.query("UPDATE solicitud SET estado=CASE WHEN id=$1 THEN 'adjudicada' ELSE 'rechazada' END WHERE ejemplar_id=$2 AND estado='pendiente' RETURNING *",[id,e.id]);for(const otra of solicitudes.rows)await aviso(c,otra.solicitante_id,'Solicitud '+otra.estado,op.id);
   if(e.propietario_usuario_id)await aviso(c,e.propietario_usuario_id,'Cesión reservada',op.id);await c.query("INSERT INTO evento_operacion(operacion_id,actor_id,accion,motivo) VALUES($1,$2,'asignar',$3)",[op.id,req.usuario.id,motivo.trim()]);return op;});res.status(201).json({datos});
 }));
 r.get('/operaciones',ruta(async(req,res)=>{const p=pagina(req);res.json({datos:(await pool.query(`SELECT o.*,jsonb_agg(jsonb_build_object('ejemplar',i.ejemplar_id,'origen',i.origen_usuario_id,'destinatario',i.destino_usuario_id,'titulo',r.titulo) ORDER BY i.ejemplar_id) AS materiales,string_agg(r.titulo,' / ' ORDER BY i.ejemplar_id) AS titulo FROM operacion o JOIN operacion_item i ON i.operacion_id=o.id JOIN ejemplar e ON e.id=i.ejemplar_id JOIN recurso r ON r.id=e.recurso_id WHERE ($1 OR EXISTS(SELECT 1 FROM operacion_item propio WHERE propio.operacion_id=o.id AND (propio.origen_usuario_id=$2 OR propio.destino_usuario_id=$2))) GROUP BY o.id ORDER BY o.id DESC LIMIT $3 OFFSET $4`,[req.usuario.roles.includes('docente'),req.usuario.id,...p])).rows});}));
 // All transitions share the same lock order: exemplars ascending, then operation.
 async function bloquearOperacion(c,id){
  const items=(await c.query('SELECT * FROM operacion_item WHERE operacion_id=$1 ORDER BY ejemplar_id',[id])).rows;
  if(!items.length)throw fallo(404,'OPERACION_NO_DISPONIBLE');
  const fichas=[];for(const i of items)fichas.push(await ejemplar(c,i.ejemplar_id));
  const op=(await c.query('SELECT * FROM operacion WHERE id=$1 FOR UPDATE',[id])).rows[0];
  return {items,fichas,op};
 }
 async function notificar(c,items,mensaje,id){
  for(const u of new Set(items.flatMap(i=>[i.origen_usuario_id,i.destino_usuario_id]).filter(Boolean)))await aviso(c,u,mensaje,id);
 }
 for(const accion of ['entregar','devolver','cancelar','incidencias','resolver'])r.post(`/gestion/operaciones/:id/${accion}`,docente,ruta(async(req,res)=>{
  cuerpo(req,['version','motivo','vencimiento','conservacion','resolucion']);
  const id=Number(req.params.id),b=req.body;
  if(!idValido(id)||(b.version!==undefined&&!idValido(b.version)))throw fallo(422,'DATOS_INVALIDOS');
  if(['cancelar','incidencias','resolver'].includes(accion)&&(typeof b.motivo!=='string'||!b.motivo.trim()||b.motivo.length>1000))throw fallo(422,'MOTIVO_NECESARIO');
  const datos=await tx(req,'docente',async c=>{
   const {items,fichas,op}=await bloquearOperacion(c,id);
   // Legacy cesion clients may omit version; new queue always submits it.
   if(op.tipo!=='cesion'&&!idValido(b.version))throw fallo(422,'VERSION_NECESARIA');
   if(b.version!==undefined&&op.version!==b.version)throw fallo(409,'VERSION_DESACTUALIZADA');
   if(accion==='entregar'&&op.estado==='completada')return op;
   let estado=op.estado,vencimiento=op.vencimiento;
   if(accion==='entregar'){
    if((await c.query("SELECT 1 FROM evento_operacion WHERE operacion_id=$1 AND accion='incidencias' AND id>COALESCE((SELECT max(id) FROM evento_operacion WHERE operacion_id=$1 AND accion='resolver'),0)",[id])).rowCount)throw fallo(409,'INCIDENCIA_PENDIENTE');
    if(op.estado!=='reservada')throw fallo(409,'OPERACION_NO_RESERVADA');
    await cuentas(c,items.flatMap(i=>[i.origen_usuario_id,i.destino_usuario_id]).filter(Boolean));
    if(op.tipo==='prestamo'){
     if(typeof b.vencimiento!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.vencimiento)||!Number.isFinite(Date.parse(b.vencimiento))||new Date(b.vencimiento).toISOString().slice(0,10)!==b.vencimiento||Date.parse(b.vencimiento)<=Date.now())throw fallo(422,'VENCIMIENTO_INVALIDO');
     vencimiento=b.vencimiento;estado='prestada';
    }else estado='completada';
   }else if(accion==='devolver'){
    if(op.tipo!=='prestamo'||op.estado!=='prestada')throw fallo(409,'PRESTAMO_NO_DEVOLVIBLE');
    if(typeof b.conservacion!=='string'||!b.conservacion.trim()||b.conservacion.length>500)throw fallo(422,'CONSERVACION_NECESARIA');
    if((await c.query("SELECT 1 FROM evento_operacion WHERE operacion_id=$1 AND accion='incidencias' AND id>COALESCE((SELECT max(id) FROM evento_operacion WHERE operacion_id=$1 AND accion='resolver'),0)",[id])).rowCount)throw fallo(409,'INCIDENCIA_PENDIENTE');
    estado='completada';await c.query('UPDATE ejemplar SET conservacion=$1 WHERE id=ANY($2::integer[])',[b.conservacion.trim(),items.map(i=>i.ejemplar_id)]);
   }else if(accion==='cancelar'){
    if(!['propuesta','reservada'].includes(op.estado))throw fallo(409,'OPERACION_NO_CANCELABLE');estado='cancelada';
   }else if(accion==='incidencias'){
    if(!['reservada','prestada'].includes(op.estado))throw fallo(409,'OPERACION_CERRADA');
   }else{
    if(!['reservada','prestada'].includes(op.estado)||!['apto','baja'].includes(b.resolucion)||(b.resolucion==='baja'&&op.tipo!=='prestamo'))throw fallo(409,'RESOLUCION_NO_PERMITIDA');
    if(!(await c.query("SELECT 1 FROM evento_operacion WHERE operacion_id=$1 AND accion='incidencias' AND id>COALESCE((SELECT max(id) FROM evento_operacion WHERE operacion_id=$1 AND accion='resolver'),0)",[id])).rowCount)throw fallo(409,'SIN_INCIDENCIA_PENDIENTE');
    if(b.resolucion==='baja')estado='cerrada_por_incidencia';
   }
   if(op.estado!=='propuesta'&&(await c.query('SELECT 1 FROM reserva_activa WHERE operacion_id=$1',[id])).rowCount!==items.length)throw fallo(409,'RESERVA_INCOHERENTE');
   if((accion==='entregar'&&op.tipo!=='prestamo')||(accion==='resolver'&&b.resolucion==='baja')){
    for(const {e,a} of fichas){await c.query("UPDATE ejemplar SET estado_servicio='retirado' WHERE id=$1",[e.id]);if(a){await c.query("UPDATE anuncio SET estado_revision='retirado',version=version+1,actualizada_en=now() WHERE id=$1",[a.id]);await c.query("INSERT INTO evento_anuncio(anuncio_id,actor_id,accion,estado_anterior,estado_nuevo) VALUES($1,$2,'circulacion_completada',$3,'retirado')",[a.id,req.usuario.id,a.estado_revision]);}}
   }
   const actual=(await c.query(`UPDATE operacion SET estado=$1,vencimiento=$2,version=version+1,
    entregada_en=CASE WHEN $3='entregar' THEN now() ELSE entregada_en END,
    cerrada_en=CASE WHEN $1 IN ('completada','cancelada','cerrada_por_incidencia') THEN now() ELSE cerrada_en END WHERE id=$4 RETURNING *`,[estado,vencimiento,accion,id])).rows[0];
   if(['completada','cancelada','cerrada_por_incidencia'].includes(estado))await c.query('DELETE FROM reserva_activa WHERE operacion_id=$1',[id]);
   await c.query('INSERT INTO evento_operacion(operacion_id,actor_id,accion,motivo) VALUES($1,$2,$3,$4)',[id,req.usuario.id,accion,b.motivo?.trim()??b.conservacion?.trim()??'']);
   await notificar(c,items,accion+': '+estado,id);return actual;
  });res.json({datos});
 }));
 r.post('/intercambios',alumno,ruta(async(req,res)=>{
  cuerpo(req,['ejemplarA','ejemplarB','confirmoPropuesta']);const b=req.body;
  if(!idValido(b.ejemplarA)||!idValido(b.ejemplarB)||b.ejemplarA===b.ejemplarB||b.confirmoPropuesta!==true)throw fallo(422,'PROPUESTA_INVALIDA');
  const datos=await tx(req,'alumno',async c=>{
   const fichas=[];for(const id of [b.ejemplarA,b.ejemplarB].sort((a,b)=>a-b))fichas.push(await ejemplar(c,id));
   for(const {e,a} of fichas){if(a?.modalidad!=='intercambio')throw fallo(422,'MODALIDAD_NO_ADMITIDA');await disponible(c,e,a);}
   const [ea,eb]=fichas.map(x=>x.e);if(!ea.propietario_usuario_id||!eb.propietario_usuario_id||ea.propietario_usuario_id===eb.propietario_usuario_id||![ea.propietario_usuario_id,eb.propietario_usuario_id].includes(req.usuario.id))throw fallo(403,'PROPIEDAD_NECESARIA');
   await cuentas(c,[ea.propietario_usuario_id,eb.propietario_usuario_id]);
   const op=(await c.query("INSERT INTO operacion(tipo,estado) VALUES('intercambio','propuesta') RETURNING *")).rows[0];
   for(const [e,otro] of [[ea,eb],[eb,ea]])await c.query('INSERT INTO operacion_item VALUES($1,$2,$3,$4)',[op.id,e.id,e.propietario_usuario_id,otro.propietario_usuario_id]);
   await c.query('INSERT INTO intercambio_aceptacion VALUES($1,$2,now())',[op.id,req.usuario.id]);
   await notificar(c,[{origen_usuario_id:ea.propietario_usuario_id,destino_usuario_id:eb.propietario_usuario_id}],'Propuesta de intercambio',op.id);return op;
  });res.status(201).json({datos});
 }));
 r.post('/intercambios/:id/aceptar',alumno,ruta(async(req,res)=>{
  cuerpo(req,['version']);const id=Number(req.params.id);if(!idValido(id)||!idValido(req.body.version))throw fallo(422,'DATOS_INVALIDOS');
  const datos=await tx(req,'alumno',async c=>{
   const {op,items,fichas}=await bloquearOperacion(c,id);
   if(!items.some(i=>i.origen_usuario_id===req.usuario.id))throw fallo(403,'PROPIEDAD_NECESARIA');
   if(op.tipo!=='intercambio'||op.estado!=='propuesta'||op.version!==req.body.version)throw fallo(409,'PROPUESTA_DESACTUALIZADA');
   for(const {e,a} of fichas){if(a?.modalidad!=='intercambio')throw fallo(409,'PROPUESTA_DESACTUALIZADA');await disponible(c,e,a);}
   await cuentas(c,items.map(i=>i.origen_usuario_id));
   await c.query('INSERT INTO intercambio_aceptacion(operacion_id,usuario_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,req.usuario.id]);return op;
  });res.json({datos});
 }));
 r.post('/gestion/intercambios/:id/reservar',docente,ruta(async(req,res)=>{
  cuerpo(req,['version']);const id=Number(req.params.id);if(!idValido(id)||!idValido(req.body.version))throw fallo(422,'DATOS_INVALIDOS');
  const datos=await tx(req,'docente',async c=>{
   const {items,fichas,op}=await bloquearOperacion(c,id);
   if(op.tipo!=='intercambio'||op.estado!=='propuesta'||op.version!==req.body.version||items.length!==2)throw fallo(409,'PROPUESTA_DESACTUALIZADA');
   await cuentas(c,items.map(i=>i.origen_usuario_id));
   const aceptaciones=(await c.query('SELECT usuario_id FROM intercambio_aceptacion WHERE operacion_id=$1',[id])).rows;
   if(!items.every(i=>aceptaciones.some(a=>a.usuario_id===i.origen_usuario_id)))throw fallo(409,'ACEPTACION_PENDIENTE');
   for(const {e,a} of fichas){if(a?.modalidad!=='intercambio')throw fallo(409,'PROPUESTA_DESACTUALIZADA');await disponible(c,e,a);}
   for(const i of items)await c.query('INSERT INTO reserva_activa VALUES($1,$2)',[i.ejemplar_id,id]);
   const actual=(await c.query("UPDATE operacion SET estado='reservada',version=version+1,docente_id=$2 WHERE id=$1 RETURNING *",[id,req.usuario.id])).rows[0];
   await c.query("INSERT INTO evento_operacion(operacion_id,actor_id,accion) VALUES($1,$2,'reservar')",[id,req.usuario.id]);await notificar(c,items,'Intercambio reservado',id);return actual;
  });res.json({datos});
 }));
 r.get('/gestion/cola',docente,ruta(async(req,res)=>{
  const q=req.query,p=Number(q.pagina??1),l=Number(q.limite??20);
  if(Object.keys(q).some(k=>!['pagina','limite','accion','modalidad','curso','estado','vencido'].includes(k))||!idValido(p)||p>100000||!idValido(l)||l>20||q.accion&&!['revisar','asignar','entregar','devolver'].includes(q.accion)||q.modalidad&&!['cesion','prestamo','intercambio'].includes(q.modalidad)||q.curso&&!idValido(Number(q.curso))||q.estado&&!['pendiente','propuesta','reservada','prestada'].includes(q.estado)||q.vencido&&!['si','no'].includes(q.vencido))throw fallo(422,'FILTROS_INVALIDOS');
  // One row per operation; aggregate items before pagination and counting.
  const consulta=`WITH cola AS (
   SELECT 'revisar' AS accion,a.id,a.version,a.modalidad,a.estado_revision AS estado,a.creada_en AS fecha,NULL::timestamptz AS vencimiento,
    jsonb_build_array(jsonb_build_object('ejemplar',e.id,'titulo',r.titulo,'curso',r.curso_id)) AS materiales,
    'Anuncio pendiente, ficha completa y propietario activo' AS condicion
   FROM anuncio a JOIN ejemplar e ON e.id=a.ejemplar_id JOIN recurso r ON r.id=e.recurso_id WHERE a.estado_revision='pendiente'
   UNION ALL
   SELECT 'asignar',s.id,1,COALESCE(a.modalidad,'prestamo'),s.estado,s.creada_en,NULL::timestamptz,
    jsonb_build_array(jsonb_build_object('ejemplar',e.id,'titulo',r.titulo,'curso',r.curso_id,'destinatario',s.solicitante_id,'origen',e.propietario_usuario_id)),
    'Ejemplar disponible y participantes activos; la solicitud no reserva'
   FROM solicitud s JOIN ejemplar e ON e.id=s.ejemplar_id JOIN recurso r ON r.id=e.recurso_id LEFT JOIN anuncio a ON a.ejemplar_id=e.id WHERE s.estado='pendiente'
   UNION ALL
   SELECT CASE WHEN o.estado='propuesta' THEN 'asignar' WHEN o.estado='reservada' THEN 'entregar' ELSE 'devolver' END,
    o.id,o.version,o.tipo,o.estado,o.creada_en,o.vencimiento,
    jsonb_agg(jsonb_build_object('ejemplar',e.id,'titulo',r.titulo,'curso',r.curso_id,'origen',i.origen_usuario_id,'destinatario',i.destino_usuario_id) ORDER BY e.id),
    CASE WHEN o.estado='propuesta' THEN 'Dos aceptaciones vigentes y ambos ejemplares disponibles' WHEN o.estado='reservada' THEN 'Reserva vigente y participantes activos' ELSE 'Préstamo entregado; conservación apta y sin incidencia pendiente' END
   FROM operacion o JOIN operacion_item i ON i.operacion_id=o.id JOIN ejemplar e ON e.id=i.ejemplar_id JOIN recurso r ON r.id=e.recurso_id
   WHERE o.estado IN ('propuesta','reservada','prestada') GROUP BY o.id
  ) SELECT * FROM cola WHERE ($1::text IS NULL OR accion=$1) AND ($2::text IS NULL OR modalidad=$2)
   AND ($3::integer IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(materiales) m WHERE (m->>'curso')::integer=$3))
   AND ($4::text IS NULL OR estado=$4) AND ($5::text IS NULL OR (vencimiento IS NOT NULL AND vencimiento<now())=($5='si'))`;
  const valores=[q.accion??null,q.modalidad??null,q.curso?Number(q.curso):null,q.estado??null,q.vencido??null];
  // A single statement gives total and page from the same snapshot, including empty pages.
  const resultado=await pool.query(`WITH filtrada AS (${consulta}) SELECT (SELECT count(*)::integer FROM filtrada) AS total,
   COALESCE((SELECT jsonb_agg(x) FROM (SELECT * FROM filtrada ORDER BY accion,fecha,id LIMIT $6 OFFSET $7) x),'[]'::jsonb) AS datos`,[...valores,l,(p-1)*l]);
  for(const x of resultado.rows[0].datos){
   const faltan=[];
   const fichas=(await pool.query(`SELECT e.id,e.estado_servicio,e.conservacion,r.edicion,c.activo AS curso_activo,
    a.estado_revision,a.modalidad,u.estado AS propietario_estado,ra.operacion_id AS reserva
    FROM ejemplar e JOIN recurso r ON r.id=e.recurso_id LEFT JOIN curso c ON c.id=r.curso_id
    LEFT JOIN anuncio a ON a.ejemplar_id=e.id LEFT JOIN usuario u ON u.id=e.propietario_usuario_id
    LEFT JOIN reserva_activa ra ON ra.ejemplar_id=e.id WHERE e.id=ANY($1::integer[])`,[x.materiales.map(m=>m.ejemplar)])).rows;
   for(const f of fichas){
    const m=x.materiales.find(m=>m.ejemplar===f.id);m.conservacion=f.conservacion;m.edicion=f.edicion;
    if(['revisar','asignar'].includes(x.accion)&&f.estado_servicio!=='habilitado')faltan.push(`Ejemplar ${f.id} retirado`);
    if(x.accion==='revisar'&&(!f.curso_activo||!f.conservacion.trim()||!f.edicion.trim()))faltan.push('Ficha o curso incompleto');
    if(x.accion==='asignar'&&(f.reserva||f.estado_revision&&f.estado_revision!=='publicado'))faltan.push(`Ejemplar ${f.id} ocupado o sin publicar`);
   }
   const participantes=x.materiales.flatMap(m=>[m.origen,m.destinatario]).filter(Boolean);
   if(x.accion==='revisar'){
    if(fichas.some(f=>f.propietario_estado!=='activo'))faltan.push('Propietario inactivo');
   }else if(participantes.length&&(await pool.query("SELECT 1 FROM usuario WHERE id=ANY($1::integer[]) AND estado<>'activo'",[participantes])).rowCount)faltan.push('Participante inactivo');
   if(x.estado==='propuesta'){
    const aceptaciones=(await pool.query('SELECT usuario_id FROM intercambio_aceptacion WHERE operacion_id=$1',[x.id])).rows;
    if(!x.materiales.every(m=>aceptaciones.some(a=>a.usuario_id===m.origen)))faltan.push('Falta la aceptación de un propietario');
   }
   if(['reservada','prestada'].includes(x.estado)){
    if((await pool.query("SELECT 1 FROM evento_operacion WHERE operacion_id=$1 AND accion='incidencias' AND id>COALESCE((SELECT max(id) FROM evento_operacion WHERE operacion_id=$1 AND accion='resolver'),0)",[x.id])).rowCount)faltan.push('Incidencia pendiente de resolución');
   }
   x.faltan=[...new Set(faltan)];x.habilitada=!faltan.length;
  }
  res.json({...resultado.rows[0],pagina:p,limite:l});
 }));
 r.get('/avisos',ruta(async(req,res)=>{const p=pagina(req);res.json({datos:(await pool.query('SELECT * FROM aviso WHERE destinatario_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[req.usuario.id,...p])).rows});}));
 return r;
}
