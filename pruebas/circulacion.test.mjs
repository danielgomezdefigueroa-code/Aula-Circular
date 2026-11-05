import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:http';
import pg from 'pg';
import {crearAplicacion} from '../src/aplicacion.mjs';
import {crearHash} from '../src/claves.mjs';

test('Circulación docente: cuatro acciones, conflictos y ampliación 500',async t=>{
 const esquema='aula_test_'+randomBytes(8).toString('hex'),control=new pg.Pool({max:1,connectionTimeoutMillis:3000});let pool,server,almacen;
 const casos=[];
 async function caso(nombre,fn){await t.test(nombre,async()=>{await fn();casos.push({caso:nombre,resultado:'APROBADO'});});}
 try{
  await control.query(`CREATE SCHEMA ${esquema}`);pool=new pg.Pool({max:8,options:`-c search_path=${esquema}`});
  const dir=new URL('../sql/migraciones/',import.meta.url);for(const n of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await pool.query(await readFile(new URL(n,dir),'utf8'));
  const hash=await crearHash('Ensayo docente local 2026'),ids={};
  for(const [nombre,rol] of [['a','alumno'],['b','alumno'],['c','alumno'],['d','docente'],['e','docente'],['admin','admin']]){
   ids[nombre]=(await pool.query("INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,estado) VALUES($1,$2,$3,1,'activo') RETURNING id",['Ensayo '+nombre,nombre+'@example.invalid',hash])).rows[0].id;await pool.query('INSERT INTO usuario_rol VALUES($1,$2)',[ids[nombre],rol]);
  }
  server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const app=await crearAplicacion(pool,{origen:base,secreto:randomBytes(32).toString('hex'),esquema,limitar:false});almacen=app.almacen;server.on('request',app.app);
  async function pedir(s,url,body,csrf=true){const r=await fetch(base+'/api'+url,{method:body===undefined?'GET':'POST',headers:{Cookie:s.cookie??'',...(body===undefined?{}:{Origin:base,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':s.token}:{})})},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.getSetCookie().length)s.cookie=r.headers.getSetCookie()[0].split(';')[0];const b=await r.json();if(b.token)s.token=b.token;return {status:r.status,...b};}
  const sesiones={};for(const n of Object.keys(ids)){const s={};await pedir(s,'/csrf');assert.equal((await pedir(s,'/acceso',{correo:n+'@example.invalid',clave:'Ensayo docente local 2026'})).status,200);sesiones[n]=s;}
  const {a,b,c,d,e,admin}=sesiones;
  async function ficha(modalidad,propietario=ids.a,centro=false,estado='publicado'){
   const r=(await pool.query("INSERT INTO recurso(origen,tipo,titulo,curso_id,asignatura,edicion) VALUES($1,'fisico',$2,1,'Programación','2026') RETURNING id",[centro?'centro':'alumno','Material '+randomBytes(3).toString('hex')])).rows[0].id;
   const ej=(await pool.query("INSERT INTO ejemplar(recurso_id,codigo,propietario_usuario_id,conservacion) VALUES($1,$2,$3,'Completo') RETURNING id",[r,'E-'+randomBytes(5).toString('hex'),centro?null:propietario])).rows[0].id;
   let anuncio;if(!centro)anuncio=(await pool.query('INSERT INTO anuncio(ejemplar_id,modalidad,estado_revision) VALUES($1,$2,$3) RETURNING id',[ej,modalidad,estado])).rows[0].id;return {ej,anuncio};
  }
  async function solicitud(ej,s=b){const r=await pedir(s,'/solicitudes',{ejemplarId:ej});assert.equal(r.status,201);return r.datos.id;}
  async function asignar(id,s=d){return pedir(s,`/gestion/solicitudes/${id}/asignar`,{motivo:'Prioridad acordada'});}
  const operar=(op,accion,datos={},s=d)=>pedir(s,`/gestion/operaciones/${op.id}/${accion}`,{version:op.version,...datos});
  const futuro=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
  let prestamo;
  await caso('Revisar: condición previa, motivo y conflicto de versión',async()=>{
   const f=await ficha('cesion',ids.a,false,'pendiente');
   assert.equal((await pedir(d,`/gestion/anuncios/${f.anuncio}/revision`,{version:1,decision:'rechazar',motivo:''})).status,422);
   const respuestas=await Promise.all([pedir(d,`/gestion/anuncios/${f.anuncio}/revision`,{version:1,decision:'aprobar',motivo:'Ficha verificada'}),pedir(e,`/gestion/anuncios/${f.anuncio}/revision`,{version:1,decision:'rechazar',motivo:'Pantalla antigua'})]);assert.deepEqual(respuestas.map(x=>x.status).sort(),[200,409]);
   assert.equal((await pool.query('SELECT 1 FROM evento_anuncio WHERE anuncio_id=$1',[f.anuncio])).rowCount,1);
  });
  await caso('Asignar: dos sesiones docentes, una reserva, ningún cambio por roles ajenos',async()=>{
   const f=await ficha('prestamo',null,true),s1=await solicitud(f.ej),s2=await solicitud(f.ej,c);
   for(const sesion of [a,admin])assert.equal((await asignar(s1,sesion)).status,403);
   assert.equal((await pool.query('SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1',[f.ej])).rowCount,0);
   const respuestas=await Promise.all([asignar(s1,d),asignar(s2,e)]);assert.deepEqual(respuestas.map(x=>x.status).sort(),[201,409]);prestamo=respuestas.find(x=>x.status===201).datos;
   assert.equal((await pool.query('SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1',[f.ej])).rowCount,1);
   assert.equal((await pool.query('SELECT 1 FROM operacion_item WHERE ejemplar_id=$1',[f.ej])).rowCount,1);
   assert.equal((await asignar(s1,e)).status,409);
  });
  await caso('Entregar y devolver préstamo: vencimiento, versión, conservación y avisos únicos',async()=>{
   assert.equal((await operar(prestamo,'entregar',{vencimiento:'2026-02-31'})).status,422);
   for(const sesion of [a,admin])assert.equal((await operar(prestamo,'entregar',{vencimiento:futuro},sesion)).status,403);
   let r=await operar(prestamo,'entregar',{vencimiento:futuro});assert.equal(r.status,200);assert.equal(r.datos.estado,'prestada');
   assert.equal((await operar(prestamo,'entregar',{vencimiento:futuro},e)).status,409);prestamo=r.datos;
   assert.equal((await operar(prestamo,'cancelar',{motivo:'Ya entregado'})).status,409);
   assert.equal((await operar(prestamo,'devolver',{conservacion:''})).status,422);
   r=await operar(prestamo,'devolver',{conservacion:'Completo y apto'});assert.equal(r.status,200);assert.equal(r.datos.estado,'completada');
   assert.equal((await operar(prestamo,'devolver',{conservacion:'Otra devolución'},e)).status,409);
   assert.equal((await pool.query('SELECT 1 FROM reserva_activa WHERE operacion_id=$1',[prestamo.id])).rowCount,0);
   assert.equal((await pool.query("SELECT 1 FROM evento_operacion WHERE operacion_id=$1 AND accion='devolver'",[prestamo.id])).rowCount,1);
   assert.equal((await pool.query("SELECT 1 FROM aviso WHERE operacion_id=$1 AND mensaje='devolver: completada'",[prestamo.id])).rowCount,1);
  });
  await caso('Incidencia: mantiene reserva, bloquea devolución y resolución de baja retira material',async()=>{
   const f=await ficha('prestamo'),s=await solicitud(f.ej);let op=(await asignar(s)).datos;
   op=(await operar(op,'entregar',{vencimiento:futuro})).datos;
   const r=await operar(op,'incidencias',{motivo:'Daño en portada'});assert.equal(r.status,200);op=r.datos;
   assert.equal((await operar(op,'devolver',{conservacion:'Completo'})).status,409);
   assert.equal((await pool.query('SELECT 1 FROM reserva_activa WHERE operacion_id=$1',[op.id])).rowCount,1);
   assert.equal((await operar(op,'resolver',{motivo:'Material irrecuperable',resolucion:'baja'})).datos.estado,'cerrada_por_incidencia');
   assert.equal((await pool.query('SELECT estado_servicio FROM ejemplar WHERE id=$1',[f.ej])).rows[0].estado_servicio,'retirado');
  });
  let intercambio;
  async function propuesta(x,y,s=a){const r=await pedir(s,'/intercambios',{ejemplarA:x.ej,ejemplarB:y.ej,confirmoPropuesta:true});assert.equal(r.status,201);return r.datos;}
  const reservar=op=>pedir(d,`/gestion/intercambios/${op.id}/reservar`,{version:op.version});
  await caso('Intercambio: dos consentimientos, dos reservas y una operación común',async()=>{
   const x=await ficha('intercambio'),y=await ficha('intercambio',ids.b);let op=await propuesta(x,y);
   assert.equal((await reservar(op)).status,409);assert.equal((await pool.query('SELECT 1 FROM reserva_activa WHERE operacion_id=$1',[op.id])).rowCount,0);
   assert.equal((await pedir(c,`/intercambios/${op.id}/aceptar`,{version:1})).status,403);
   assert.equal((await pedir(b,`/intercambios/${op.id}/aceptar`,{version:1})).status,200);
   let r=await reservar(op);assert.equal(r.status,200);op=r.datos;
   const reservas=(await pool.query('SELECT * FROM reserva_activa WHERE operacion_id=$1',[op.id])).rows;assert.equal(reservas.length,2);assert.deepEqual(reservas.map(x=>x.ejemplar_id).sort((a,b)=>a-b),[x.ej,y.ej].sort((a,b)=>a-b));
   assert.equal((await reservar({...op,version:1})).status,409);
   const cola=await pedir(d,'/gestion/cola?modalidad=intercambio&estado=reservada');assert.equal(cola.status,200);assert.equal(cola.total,1);assert.equal(cola.datos[0].materiales.length,2);
   r=await operar(op,'entregar');assert.equal(r.status,200);assert.equal(r.datos.estado,'completada');
   assert.equal((await operar(op,'entregar',{},e)).status,409);
   assert.equal((await pool.query("SELECT 1 FROM ejemplar WHERE id=ANY($1::integer[]) AND estado_servicio='retirado'",[[x.ej,y.ej]])).rowCount,2);
   assert.equal((await pool.query("SELECT 1 FROM aviso WHERE operacion_id=$1 AND mensaje='entregar: completada'",[op.id])).rowCount,2);
   intercambio={operacion:op.id,ejemplares:[x.ej,y.ej],reservasComunes:reservas,resultado:r.datos.estado};
  });
  await caso('Intercambio ocupado: rollback sin reserva parcial y cancelación libera ambos',async()=>{
   const x=await ficha('intercambio'),y=await ficha('intercambio',ids.b),z=await ficha('intercambio',ids.c);
   const op1=await propuesta(x,y),op2=await propuesta(x,z);
   await pedir(b,`/intercambios/${op1.id}/aceptar`,{version:1});await pedir(c,`/intercambios/${op2.id}/aceptar`,{version:1});
   const rr=await Promise.all([reservar(op1),pedir(e,`/gestion/intercambios/${op2.id}/reservar`,{version:1})]);assert.deepEqual(rr.map(x=>x.status).sort(),[200,409]);
   const ganador=rr.find(x=>x.status===200).datos,perdedor=rr[0].status===200?op2:op1;
   assert.equal((await pool.query('SELECT 1 FROM reserva_activa WHERE operacion_id=$1',[perdedor.id])).rowCount,0);
   assert.equal((await pool.query('SELECT 1 FROM reserva_activa WHERE operacion_id=$1',[ganador.id])).rowCount,2);
   assert.equal((await operar(ganador,'cancelar',{motivo:'Renuncia previa'})).status,200);
   assert.equal((await pool.query('SELECT 1 FROM reserva_activa WHERE operacion_id=$1',[ganador.id])).rowCount,0);
  });
  await caso('Seguimiento 500: totales coherentes, páginas vacías y filtros sin mutaciones',async()=>{
   for(let n=0;n<3;n++){const f=await ficha('prestamo',null,true);let op=(await asignar(await solicitud(f.ej))).datos;op=(await operar(op,'entregar',{vencimiento:futuro})).datos;await pool.query("UPDATE operacion SET vencimiento=now()-interval '1 day' WHERE id=$1",[op.id]);}
   const antes=(await pool.query('SELECT row_to_json(o) AS fila FROM operacion o ORDER BY id')).rows;
   const total=(await pool.query("SELECT count(*)::integer AS n FROM operacion o WHERE tipo='prestamo' AND estado='prestada' AND vencimiento<now() AND EXISTS(SELECT 1 FROM operacion_item i JOIN ejemplar e ON e.id=i.ejemplar_id JOIN recurso r ON r.id=e.recurso_id WHERE i.operacion_id=o.id AND r.curso_id=1)")).rows[0].n;
   const url='/gestion/cola?accion=devolver&modalidad=prestamo&estado=prestada&curso=1&vencido=si&limite=2';
   const p1=await pedir(d,url),p2=await pedir(d,url+'&pagina=2'),p3=await pedir(d,url+'&pagina=100');
   assert.equal(p1.status,200);assert.equal(p1.total,total);assert.equal(p1.datos.length+p2.datos.length,total);assert.equal(p3.total,total);assert.equal(p3.datos.length,0);
   assert.equal(new Set([...p1.datos,...p2.datos].map(x=>x.id)).size,total);
   for(const sesion of [admin,a])assert.equal((await pedir(sesion,url)).status,403);
   for(const filtro of ['modalidad=otra','curso=abc','limite=21','vencido=tal','estado=cerrada','intruso=1'])assert.equal((await pedir(d,'/gestion/cola?'+filtro)).status,422);
   assert.deepEqual((await pool.query('SELECT row_to_json(o) AS fila FROM operacion o ORDER BY id')).rows,antes);
  });
  await mkdir('evidencias/circulacion',{recursive:true});
  let visual=null;
  if(process.env.VERIFICAR_PANTALLA==='1'){
   const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
   const {chromium}=require(process.env.PLAYWRIGHT_MODULO);
   const browser=await chromium.launch({headless:true,channel:'msedge'});
   try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const token=(await (await context.request.get(base+'/api/csrf')).json()).token;
    assert.equal((await context.request.post(base+'/api/acceso',{headers:{Origin:base,'X-CSRF-Token':token},data:{correo:'d@example.invalid',clave:'Ensayo docente local 2026'}})).status(),200);
    const f=await ficha('cesion');await solicitud(f.ej);await ficha('cesion',ids.a,false,'pendiente');
    const x=await ficha('intercambio'),y=await ficha('intercambio',ids.b),op=await propuesta(x,y);await pedir(b,`/intercambios/${op.id}/aceptar`,{version:1});
    const page=await context.newPage(),errores=[];page.on('pageerror',e=>errores.push(e.message));page.on('dialog',dialog=>dialog.accept());
    await page.goto(base+'/html/docencia.html');await page.locator('#circulacion li').first().waitFor();
    const zona=page.locator('#circulacion');
    await zona.locator('select[name=modalidad]').selectOption('intercambio');await zona.getByRole('button',{name:'Filtrar',exact:true}).click();
    await zona.getByRole('button',{name:'Reservar ambos'}).last().waitFor();
    const tarjeta=zona.locator('li').filter({hasText:`intercambio #${op.id}`});await tarjeta.getByRole('button',{name:'Reservar ambos'}).click();
    await zona.getByRole('status').filter({hasText:'Confirmado:'}).waitFor();
    assert.equal((await pool.query('SELECT 1 FROM reserva_activa WHERE operacion_id=$1',[op.id])).rowCount,2);
    await page.screenshot({path:'evidencias/circulacion/panel-escritorio.png',fullPage:true});
    await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/gestion/operaciones/${op.id}/entregar`)&&r.status()===200),tarjeta.getByRole('button',{name:'Confirmar entrega'}).click()]);
    await zona.getByRole('status').filter({hasText:'Estado del servidor: completada'}).waitFor();
    assert.equal((await pool.query('SELECT estado FROM operacion WHERE id=$1',[op.id])).rows[0].estado,'completada');
    await zona.locator('select[name=modalidad]').selectOption('');await zona.getByRole('button',{name:'Filtrar',exact:true}).click();
    await zona.locator('li').first().waitFor();
    await page.setViewportSize({width:320,height:900});await page.screenshot({path:'evidencias/circulacion/panel-movil.png',fullPage:true});
    visual=await page.evaluate(()=>({ancho:innerWidth,contenido:document.documentElement.scrollWidth}));assert.ok(visual.contenido<=visual.ancho);assert.deepEqual(errores,[]);
    await context.close();
   }finally{await browser.close();}
  }
  const archivos=['src/cesiones.mjs','public/mjs/circulacion-docente.mjs','public/html/docencia.html','sql/migraciones/008_circulacion.sql','pruebas/circulacion.test.mjs'];
  const huellas={};for(const f of archivos)huellas[f]=createHash('sha256').update(await readFile(f)).digest('hex');
  await writeFile('evidencias/circulacion/resultados.json',JSON.stringify({fecha:new Date().toISOString(),entorno:{node:process.version,postgres:(await pool.query('SHOW server_version')).rows[0].server_version},casos,intercambio,visual,huellas},null,2));
 }finally{
  if(server)await new Promise(ok=>server.close(ok));if(almacen)await almacen.close();if(pool)await pool.end();
  if(/^aula_test_[a-f0-9]{16}$/.test(esquema))await control.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);await control.end();
 }
});
