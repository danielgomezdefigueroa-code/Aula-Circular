import { Router } from 'express';
const fallo=(status,error)=>Object.assign(new Error(error),{status});
const idValido=id=>Number.isSafeInteger(id)&&id>0;
function paginar(req){
 if(Object.keys(req.query).some(k=>!['pagina','limite'].includes(k)))throw fallo(422,'FILTROS_INVALIDOS');
 const p=Number(req.query.pagina??1),l=Number(req.query.limite??20);
 if(!idValido(p)||p>100000||!idValido(l)||l>20)throw fallo(422,'PAGINACION_INVALIDA');
 return [l,(p-1)*l];
}
function cuerpo(b,campos){if(!b||Array.isArray(b)||typeof b!=='object'||!Object.keys(b).length||Object.keys(b).some(k=>!campos.includes(k)))throw fallo(422,'DATOS_INVALIDOS');}
export function rutasAdministracion(pool,sesion,activa){
 const r=Router();
 r.use(sesion,activa,(req,res,next)=>req.usuario.roles.includes('admin')?next():res.status(403).json({error:'PERMISO_ADMIN_NECESARIO'}));
 const ruta=f=>async(req,res,next)=>{try{await f(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});if(e.code==='23505')return res.status(409).json({error:'CODIGO_DUPLICADO'});next(e);}};
 async function tx(req,f){const c=await pool.connect();try{
  await c.query('BEGIN');
  // Todas las mutaciones administrativas comparten este bloqueo antes de contar o escribir.
  await c.query('SELECT pg_advisory_xact_lock(71001)');
  const actor=(await c.query(`SELECT u.estado,u.auth_version FROM usuario u JOIN usuario_rol r ON r.usuario_id=u.id AND r.rol='admin' WHERE u.id=$1 FOR UPDATE OF u`,[req.usuario.id])).rows[0];
  if(!actor||actor.estado!=='activo'||actor.auth_version!==req.session.authVersion)throw fallo(403,'PERMISO_ADMIN_NECESARIO');
  const result=await f(c);await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function evento(c,req,entidad,id,antes,despues){await c.query('INSERT INTO evento_administracion(actor_id,entidad,entidad_id,antes,despues) VALUES($1,$2,$3,$4,$5)',[req.usuario.id,entidad,id,JSON.stringify(antes),JSON.stringify(despues)]);}
 r.get('/usuarios',ruta(async(req,res)=>{const p=paginar(req);res.json({datos:(await pool.query(`SELECT u.id,u.alias,u.estado,u.validado_en,ARRAY(SELECT rol FROM usuario_rol WHERE usuario_id=u.id ORDER BY rol) roles FROM usuario u ORDER BY u.id LIMIT $1 OFFSET $2`,p)).rows});}));
 r.patch('/usuarios/:id',ruta(async(req,res)=>{
  const id=Number(req.params.id),b=req.body;cuerpo(b,['estado','roles']);
  if(!idValido(id)||(b.estado!==undefined&&!['activo','suspendido'].includes(b.estado))||(b.roles!==undefined&&(!Array.isArray(b.roles)||new Set(b.roles).size!==b.roles.length||b.roles.some(x=>!['alumno','docente','admin'].includes(x)))))throw fallo(422,'DATOS_INVALIDOS');
  const datos=await tx(req,async c=>{
   const u=(await c.query(`SELECT u.id,u.estado,u.validado_en,ARRAY(SELECT rol FROM usuario_rol WHERE usuario_id=u.id ORDER BY rol) roles FROM usuario u WHERE u.id=$1 FOR UPDATE`,[id])).rows[0];
   if(!u)throw fallo(404,'CUENTA_NO_DISPONIBLE');
   if(b.estado==='activo'&&(u.estado==='pendiente'||!u.validado_en))throw fallo(409,'VALIDACION_DOCENTE_NECESARIA');
   const estado=b.estado??u.estado,roles=b.roles??u.roles;
   if(u.estado==='activo'&&u.roles.includes('admin')&&(estado!=='activo'||!roles.includes('admin'))){
    const n=await c.query(`SELECT count(*)::int n FROM usuario u JOIN usuario_rol r ON r.usuario_id=u.id AND r.rol='admin' WHERE u.estado='activo'`);
    if(n.rows[0].n<=1)throw fallo(409,'ULTIMO_ADMIN_ACTIVO');
   }
   await c.query('UPDATE usuario SET estado=$2,auth_version=auth_version+CASE WHEN estado<>$2 THEN 1 ELSE 0 END WHERE id=$1',[id,estado]);
   if(b.roles!==undefined){await c.query('DELETE FROM usuario_rol WHERE usuario_id=$1',[id]);for(const rol of roles)await c.query('INSERT INTO usuario_rol VALUES($1,$2)',[id,rol]);}
   const despues={id,estado,roles};await evento(c,req,'usuario',id,{estado:u.estado,roles:u.roles},despues);return despues;
  });res.json({datos});
 }));
 for(const tabla of ['cursos','categorias']){
  const entidad=tabla==='cursos'?'curso':'categoria'; // Identificadores constantes, nunca del cliente.
  r.get('/'+tabla,ruta(async(req,res)=>res.json({datos:(await pool.query(`SELECT id,codigo,nombre,activo FROM ${entidad} ORDER BY id LIMIT $1 OFFSET $2`,paginar(req))).rows})));
  for(const metodo of ['post','patch'])r[metodo]('/'+tabla+(metodo==='patch'?'/:id':''),ruta(async(req,res)=>{
   const b=req.body;cuerpo(b,['codigo','nombre','activo']);const id=Number(req.params.id);
   if((metodo==='patch'&&!idValido(id))||(metodo==='post'&&(!b.codigo||!b.nombre))||['codigo','nombre'].some(k=>b[k]!==undefined&&(typeof b[k]!=='string'||!b[k].trim()||b[k].length>100))||(b.activo!==undefined&&typeof b.activo!=='boolean'))throw fallo(422,'DATOS_INVALIDOS');
   const datos=await tx(req,async c=>{
    let antes={};if(metodo==='patch'){antes=(await c.query(`SELECT id,codigo,nombre,activo FROM ${entidad} WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!antes)throw fallo(404,'NO_ENCONTRADO');}
    const x=metodo==='post'?await c.query(`INSERT INTO ${entidad}(codigo,nombre,activo) VALUES($1,$2,$3) RETURNING *`,[b.codigo.trim(),b.nombre.trim(),b.activo??true]):await c.query(`UPDATE ${entidad} SET codigo=$2,nombre=$3,activo=$4 WHERE id=$1 RETURNING *`,[id,b.codigo?.trim()??antes.codigo,b.nombre?.trim()??antes.nombre,b.activo??antes.activo]);
    const despues=x.rows[0];await evento(c,req,entidad,despues.id,antes,despues);return despues;
   });res.status(metodo==='post'?201:200).json({datos});
  }));
 }
 r.get('/eventos',ruta(async(req,res)=>res.json({datos:(await pool.query('SELECT id,actor_id,entidad,entidad_id,antes,despues,creada_en FROM evento_administracion ORDER BY id DESC LIMIT $1 OFFSET $2',paginar(req))).rows})));
 return r;
}
