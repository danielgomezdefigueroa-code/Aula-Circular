import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import pg from 'pg';
import {crearAplicacion} from '../src/aplicacion.mjs';
import {crearHash} from '../src/claves.mjs';
test('Panel docente y administración: PostgreSQL y HTTP reales',async t=>{
 const esquema='aula_test_'+randomBytes(8).toString('hex'),admin=new pg.Pool({max:1,connectionTimeoutMillis:3000});let pool,servidor,almacen;
 const evidencia={fecha:new Date().toISOString(),version:'panel-docente-admin-v1',matriz:[],casos:[]};
 try{
 await admin.query(`CREATE SCHEMA ${esquema}`);pool=new pg.Pool({max:8,options:`-c search_path=${esquema}`,connectionTimeoutMillis:3000});
 const dir=new URL('../sql/migraciones/',import.meta.url);for(const n of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await pool.query(await readFile(new URL(n,dir),'utf8'));
 const clave='Frase ficticia para pruebas 2026',hash=await crearHash(clave),ids={},sesiones={};
 const cuentas={alumno:['alumno'],docente:['docente'],admin:['admin'],ambos:['admin','docente'],segundo:['admin'],pendiente:['alumno']};
 for(const [nombre,roles] of Object.entries(cuentas)){const pendiente=nombre==='pendiente';ids[nombre]=(await pool.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,curso_confirmado_id,estado,validado_en) VALUES($1,$2,$3,1,$4,$5,$6) RETURNING id`,['Ensayo '+nombre,nombre+'@example.invalid',hash,pendiente?null:1,pendiente?'pendiente':'activo',pendiente?null:new Date()])).rows[0].id;for(const rol of roles)await pool.query('INSERT INTO usuario_rol VALUES($1,$2)',[ids[nombre],rol]);}
 const x=await crearAplicacion(pool,{origen:'http://127.0.0.1:3000',secreto:randomBytes(32).toString('hex'),esquema,limitar:false});almacen=x.almacen;servidor=x.app.listen(0,'127.0.0.1');await once(servidor,'listening');const base='http://127.0.0.1:'+servidor.address().port;
 async function pedir(s,ruta,method='GET',body,csrf=true){const headers={Cookie:s.cookie??''};if(method!=='GET')Object.assign(headers,{'Content-Type':'application/json',Origin:'http://127.0.0.1:3000',...(csrf?{'X-CSRF-Token':s.token}:{})});const r=await fetch(base+ruta,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.getSetCookie().length)s.cookie=r.headers.getSetCookie()[0].split(';')[0];const b=await r.json();if(b.token)s.token=b.token;return {status:r.status,...b};}
 for(const nombre of Object.keys(cuentas)){const s={};await pedir(s,'/api/csrf');assert.equal((await pedir(s,'/api/acceso','POST',{correo:nombre+'@example.invalid',clave})).status,200);sesiones[nombre]=s;}
 const patch=(s,id,b)=>pedir(s,'/api/admin/usuarios/'+id,'PATCH',b);
 await t.test('Matriz de cuatro roles: interfaz respaldada por permisos HTTP',async()=>{
 for(const rol of ['alumno','docente','admin','ambos']){
 const resultados={rol};for(const [nombre,ruta,esperado] of [['cola','/api/gestion/usuarios',rol==='docente'||rol==='ambos'?200:403],['administracion','/api/admin/usuarios',rol==='admin'||rol==='ambos'?200:403],['biblioteca','/api/biblioteca',rol==='admin'?403:200],['documentacion','/api/documentacion',rol==='admin'?403:200],['revision','/api/gestion/anuncios',rol==='docente'||rol==='ambos'?200:403]]){const r=await pedir(sesiones[rol],ruta);assert.equal(r.status,esperado);resultados[nombre]=r.status;}evidencia.matriz.push(resultados);
 }assert.equal((await pedir({},'/api/admin/usuarios')).status,401);
 assert.equal((await pedir(sesiones.admin,'/api/gestion/solicitudes/1/asignar','POST',{motivo:'Ensayo'})).status,403);
 assert.equal((await pedir(sesiones.admin,'/api/gestion/operaciones/1/entregar','POST',{})).status,403);
 });
 await t.test('Validación docente y separación administrativa; auditoría de pertenencia',async()=>{
 assert.equal((await patch(sesiones.admin,ids.pendiente,{estado:'activo'})).status,409);
 assert.equal((await pedir(sesiones.docente,`/api/gestion/usuarios/${ids.pendiente}/validar`,'POST',{cursoId:2})).status,200);
 assert.equal((await pool.query('SELECT * FROM evento_cuenta WHERE usuario_id=$1',[ids.pendiente])).rowCount,1);
 assert.equal((await patch(sesiones.admin,ids.alumno,{cursoId:2})).status,422);
 });
 await t.test('Cursos y categorías: alta, edición, desactivación y referencias conservadas',async()=>{
 for(const tipo of ['cursos','categorias']){const r=await pedir(sesiones.admin,'/api/admin/'+tipo,'POST',{codigo:'ENSAYO',nombre:'Ensayo inicial'});assert.equal(r.status,201);assert.equal((await pedir(sesiones.admin,'/api/admin/'+tipo+'/'+r.datos.id,'PATCH',{nombre:'Ensayo revisado',activo:false})).status,200);assert.ok((await pedir(sesiones.admin,'/api/admin/'+tipo)).datos.some(x=>x.id===r.datos.id&&!x.activo));assert.equal((await pedir(sesiones.admin,'/api/admin/'+tipo,'POST',{codigo:'ENSAYO',nombre:'Duplicado'})).status,409);}
 assert.equal((await pedir(sesiones.admin,'/api/admin/cursos/1','PATCH',{activo:false})).status,200);assert.equal((await pool.query('SELECT curso_confirmado_id FROM usuario WHERE id=$1',[ids.alumno])).rows[0].curso_confirmado_id,1);
 assert.equal((await pedir(sesiones.admin,'/api/admin/usuarios?limite=21')).status,422);
 assert.equal((await pedir(sesiones.admin,'/api/admin/usuarios?orden=hash')).status,422);
 assert.equal((await pedir(sesiones.admin,'/api/admin/cursos','POST',{codigo:'X',nombre:'X'},false)).status,403);
 });
 await t.test('Rol docente explícito: retirada pierde permiso en la siguiente petición de la misma sesión',async()=>{
 assert.equal((await patch(sesiones.admin,ids.ambos,{roles:['admin']})).status,200);
 assert.equal((await pedir(sesiones.ambos,'/api/gestion/usuarios')).status,403);
 assert.equal((await pedir(sesiones.ambos,'/api/admin/usuarios')).status,200);
 assert.equal((await patch(sesiones.admin,ids.ambos,{roles:['admin','docente']})).status,200);
 assert.equal((await pedir(sesiones.ambos,'/api/gestion/usuarios')).status,200);
 });
 await t.test('Suspensión con sesión abierta: rechazo inmediato e historial conservado',async()=>{
 const recurso=(await pool.query("INSERT INTO recurso(origen,tipo,titulo,curso_id,asignatura,edicion) VALUES('alumno','fisico','Historial de ensayo',1,'Programación','2026') RETURNING id")).rows[0].id;
 const ej=(await pool.query("INSERT INTO ejemplar(recurso_id,codigo,propietario_usuario_id,conservacion) VALUES($1,'HIST-001',$2,'Completo') RETURNING id",[recurso,ids.alumno])).rows[0].id;
 const op=(await pool.query("INSERT INTO operacion(tipo,estado,docente_id) VALUES('cesion','reservada',$1) RETURNING id",[ids.docente])).rows[0].id;
 await pool.query('INSERT INTO operacion_item VALUES($1,$2,$3,$4)',[op,ej,ids.alumno,ids.pendiente]);
 await pool.query('INSERT INTO reserva_activa VALUES($1,$2)',[ej,op]);
 assert.equal((await patch(sesiones.admin,ids.alumno,{estado:'suspendido'})).status,200);
 assert.equal((await pool.query('SELECT * FROM operacion_item WHERE operacion_id=$1',[op])).rowCount,1);
 assert.equal((await pool.query('SELECT * FROM reserva_activa WHERE ejemplar_id=$1',[ej])).rowCount,1);
 assert.equal((await pedir(sesiones.alumno,'/api/biblioteca')).status,401);
 assert.equal((await pool.query('SELECT * FROM usuario WHERE id=$1',[ids.alumno])).rowCount,1);
 assert.equal((await patch(sesiones.admin,ids.alumno,{estado:'activo'})).status,200);
 assert.equal((await pedir(sesiones.alumno,'/api/yo')).status,401);
 assert.ok((await pool.query("SELECT * FROM evento_administracion WHERE entidad='usuario' AND entidad_id=$1",[ids.alumno])).rowCount>=2);
 });
 await t.test('Ampliación 500: dos retiradas simultáneas sobre los últimos administradores',async()=>{
 assert.equal((await patch(sesiones.admin,ids.segundo,{roles:[]})).status,200);
 const r=await Promise.all([patch(sesiones.admin,ids.admin,{roles:[]}),patch(sesiones.ambos,ids.ambos,{roles:['docente']})]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
 const activos=await pool.query("SELECT u.id FROM usuario u JOIN usuario_rol r ON r.usuario_id=u.id WHERE u.estado='activo' AND r.rol='admin'");assert.equal(activos.rowCount,1);const ganador=activos.rows[0].id===ids.admin?'admin':'ambos';
 assert.equal((await patch(sesiones[ganador],ids[ganador],{estado:'suspendido'})).status,409);
 assert.equal((await patch(sesiones[ganador],ids[ganador],{roles:[]})).status,409);
 evidencia.concurrencia={respuestas:r.map(x=>x.status),administradoresActivos:activos.rowCount};
 });
 evidencia.casos=['Matriz de cuatro roles','Validación docente y auditoría','Gestión de cursos y categorías','Retirada de permiso con sesión abierta','Suspensión y conservación de historial','Concurrencia y último administrador'];evidencia.resultado='PASS';
 await mkdir(new URL('../evidencias/panel-docente/',import.meta.url),{recursive:true});await writeFile(new URL('../evidencias/panel-docente/resultados.json',import.meta.url),JSON.stringify(evidencia,null,2));
 }finally{if(servidor)await new Promise(ok=>servidor.close(ok));if(almacen)await almacen.close();if(pool)await pool.end();if(/^aula_test_[a-f0-9]{16}$/.test(esquema))await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);await admin.end();}
});
