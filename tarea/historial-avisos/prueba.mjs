import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile,readdir,writeFile,mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { crearAplicacion } from '../../src/app.mjs';
import { crearHash } from '../../src/claves.mjs';

test('Historial propio y avisos leidos - 370 horas',async t=>{
  const esquema='aula_test_'+randomBytes(8).toString('hex');
  const admin=new pg.Pool({max:1,connectionTimeoutMillis:3000});let pool,servidor,almacen;
  try{
    await admin.query(`CREATE SCHEMA ${esquema}`);
    pool=new pg.Pool({max:5,options:`-c search_path=${esquema}`,connectionTimeoutMillis:3000});
    const dir=new URL('../../sql/migraciones/',import.meta.url);
    for(const nombre of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(nombre,dir),'utf8'));
    const clave='Frase de ensayo para anuncios 2026';const hash=await crearHash(clave);const ids={};
    for(const [nombre,estado,rol] of [['a','activo','alumno'],['b','activo','alumno'],['d','activo','docente'],['p','pendiente','alumno'],['c','activo','alumno'],['adm','activo','admin']]){
      const r=await pool.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,estado)
        VALUES($1,$2,$3,1,$4) RETURNING id`,['Cuenta '+nombre,nombre+'@example.invalid',hash,estado]);
      ids[nombre]=r.rows[0].id;await pool.query('INSERT INTO usuario_rol VALUES($1,$2)',[ids[nombre],rol]);
    }
    servidor=createServer();servidor.listen(0,'127.0.0.1');await once(servidor,'listening');
    const base='http://127.0.0.1:'+servidor.address().port;
    const resultado=await crearAplicacion(pool,{origen:base,secreto:randomBytes(32).toString('hex'),esquema,limitar:false});
    almacen=resultado.almacen;servidor.on('request',resultado.app);
    async function pedir(s,ruta,method='GET',body,conCsrf=true){
      const headers={Cookie:s.cookie??''};
      if(method!=='GET')Object.assign(headers,{'Content-Type':'application/json',Origin:base,...(conCsrf ? {'X-CSRF-Token':s.token}:{})});
      const r=await fetch(base+ruta,{method,headers,body:body===undefined ? undefined:JSON.stringify(body)});
      if(r.headers.getSetCookie().length)s.cookie=r.headers.getSetCookie()[0].split(';')[0];
      const b=await r.json();if(b.token)s.token=b.token;return {status:r.status,...b};
    }
    const sesiones={};for(const nombre of Object.keys(ids)){
      const s={};await pedir(s,'/api/csrf');assert.equal((await pedir(s,'/api/acceso','POST',{correo:nombre+'@example.invalid',clave})).status,200);sesiones[nombre]=s;
    }
    const {a,b,d}=sesiones;
    const datos={titulo:'Cesión EJ05',descripcion:'Datos ficticios',cursoId:2,asignatura:'Programación',edicion:'2026',isbn:'',conservacion:'Interior completo, portada gastada',modalidad:'cesion'};
    const post=(s,url,body={})=>pedir(s,url,'POST',body);
    async function anuncio(){const x=await post(a,'/api/anuncios',datos);assert.equal(x.status,201);const id=x.datos.id;const enviado=await post(a,`/api/anuncios/${id}/enviar`,{version:x.datos.version});return {id,version:enviado.datos.version,ejemplar:(await pedir(a,'/api/anuncios/'+id)).datos.ejemplar_id};}
    async function aprobar(x){assert.equal((await post(d,`/api/gestion/anuncios/${x.id}/revision`,{version:x.version,decision:'aprobar',motivo:''})).status,200);}
    async function solicitar(s,x){const r=await post(s,'/api/solicitudes',{ejemplarId:x.ejemplar});assert.equal(r.status,201);return r.datos.id;}
    async function asignar(id){return post(d,`/api/gestion/solicitudes/${id}/asignar`,{motivo:'Prioridad acordada en el ensayo'});}
    const evidencia=[];
    const guardar=(caso,esperado,observado)=>evidencia.push({caso,esperado,observado});
    let prestamo,intercambio,ejemplarPrestamo,avisoPrestamo;
    const cesiones=[];
    const fotos=async()=>{
      const salida={};
      for(const tabla of ['operacion','operacion_item','evento_operacion','reserva_activa','solicitud']) {
        salida[tabla]=(await pool.query(`SELECT * FROM ${tabla} ORDER BY 1,2`)).rows;
      }return salida;
    };
    await t.test('1. Historia conocida: dos cesiones, prestamo activo e intercambio cancelado',async()=>{
      for(let n=0;n<2;n++){
        const x=await anuncio();await aprobar(x);
        const op=await asignar(await solicitar(b,x));assert.equal(op.status,201);
        assert.equal((await post(d,`/api/gestion/operaciones/${op.datos.id}/entregar`)).status,200);
        cesiones.push(op.datos.id);
      }
      const recurso=(await pool.query(`INSERT INTO recurso(origen,tipo,titulo,asignatura,edicion)
        VALUES('centro','fisico','Calculadora historial','Matematicas','2026') RETURNING id`)).rows[0].id;
      ejemplarPrestamo=(await pool.query(`INSERT INTO ejemplar(recurso_id,codigo,conservacion)
        VALUES($1,'HIS-CAL-01','Completa') RETURNING id`,[recurso])).rows[0].id;
      const s=await post(b,'/api/prestamos/solicitudes',{ejemplarId:ejemplarPrestamo});assert.equal(s.status,201);
      const op=await post(d,`/api/gestion/prestamos/solicitudes/${s.datos.id}/adjudicar`,{
        motivo:'Prestamo ficticio para historial',vencimiento:new Date(Date.now()+14*86400000).toISOString()});
      assert.equal(op.status,201);prestamo=op.datos.id;
      assert.equal((await post(d,`/api/gestion/prestamos/${prestamo}/entregar`)).status,200);
      // Semilla SQL de un intercambio histórico cancelado: no acredita su ciclo de escritura por HTTP.
      intercambio=(await pool.query(`INSERT INTO operacion(tipo,estado,docente_id,cerrada_en)
        VALUES('intercambio','cancelada',$1,now()) RETURNING id`,[ids.d])).rows[0].id;
      const pareja=[];
      for(const [origen,destino,codigo] of [[ids.a,ids.b,'HIS-INT-A'],[ids.b,ids.a,'HIS-INT-B']]){
        const r=(await pool.query(`INSERT INTO recurso(origen,tipo,titulo,asignatura,edicion)
          VALUES('alumno','fisico',$1,'Programacion','2026') RETURNING id`,['Libro '+codigo])).rows[0].id;
        const e=(await pool.query(`INSERT INTO ejemplar(recurso_id,codigo,propietario_usuario_id,conservacion)
          VALUES($1,$2,$3,'Completo') RETURNING id`,[r,codigo,origen])).rows[0].id;
        await pool.query('INSERT INTO operacion_item VALUES($1,$2,$3,$4)',[intercambio,e,origen,destino]);pareja.push(e);
      }
      await pool.query(`INSERT INTO evento_operacion(operacion_id,actor_id,accion,motivo)
        VALUES($1,$2,'cancelar_intercambio','Cancelacion historica de ensayo')`,[intercambio,ids.d]);
      for(const alumno of [ids.a,ids.b])await pool.query('INSERT INTO aviso(destinatario_id,mensaje,operacion_id) VALUES($1,$2,$3)',[alumno,'Intercambio cancelado',intercambio]);
      avisoPrestamo=(await pool.query('SELECT id FROM aviso WHERE operacion_id=$1 AND destinatario_id=$2 ORDER BY id DESC LIMIT 1',[prestamo,ids.b])).rows[0].id;
      const estados=(await pool.query('SELECT tipo,estado,count(*)::int AS total FROM operacion GROUP BY tipo,estado ORDER BY tipo')).rows;
      assert.deepEqual(estados,[{tipo:'cesion',estado:'completada',total:2},{tipo:'intercambio',estado:'cancelada',total:1},{tipo:'prestamo',estado:'prestada',total:1}]);
      guardar('Semilla conocida','2 cesiones completadas; 1 prestamo activo; 1 intercambio cancelado',{estados,ids:{cesiones,prestamo,intercambio},origenIntercambio:'semilla SQL'});
    });
    await t.test('2. Historial por actor y SQL de control',async()=>{
      const control=await readFile(new URL('./control.sql',import.meta.url),'utf8');
      const actores=[];
      for(const [nombre,total] of [['a',3],['b',4],['c',0]]){
        const r=await pedir(sesiones[nombre],'/api/mi-espacio/historial');assert.equal(r.status,200);assert.equal(r.operaciones.length,total);
        const sql=(await pool.query(control,[ids[nombre]])).rows;
        const sum=sql.reduce((n,f)=>n+f.total,0);assert.equal(sum,total);
        assert.ok(r.operaciones.every(o=>o.items.some(i=>[i.origen_usuario_id,i.destino_usuario_id].includes(ids[nombre]))));
        assert.equal(new Set(r.operaciones.map(o=>o.id)).size,total);
        assert.ok(r.operaciones.every(o=>o.creada_en&&o.siguiente_accion&&o.eventos.every(e=>e.actor_id&&e.fecha)));
        assert.ok(r.solicitudes.every(s=>nombre==='b'));actores.push({actor:nombre,total,sql,http:r.operaciones});
      }
      const docente=await pedir(d,'/api/gestion/historial');assert.equal(docente.status,200);assert.equal(docente.operaciones.length,4);
      assert.equal((await pedir(sesiones.adm,'/api/gestion/historial')).status,403);
      assert.equal((await pedir(a,'/api/gestion/historial')).status,403);
      assert.equal((await pedir(sesiones.adm,'/api/mi-espacio/historial')).status,403);
      assert.equal((await pedir({},'/api/mi-espacio/historial')).status,401);
      assert.equal((await pedir(sesiones.p,'/api/mi-espacio/historial')).status,403);
      assert.equal((await pedir(a,'/api/mi-espacio/historial?usuarioId='+ids.b)).status,422);
      guardar('Actores y permisos','A=3, B=4, C=0; docente=4; admin sin docente no autorizado',actores);
    });
    await t.test('3. Aviso leido sin efectos laterales y repeticion concurrente',async()=>{
      const antes=await fotos();
      const resultados=await Promise.all([post(b,`/api/avisos/${avisoPrestamo}/leido`),post(b,`/api/avisos/${avisoPrestamo}/leido`)]);
      assert.deepEqual(resultados.map(r=>r.status),[200,200]);
      assert.ok(resultados[0].datos.leido_en);assert.equal(resultados[0].datos.leido_en,resultados[1].datos.leido_en);
      assert.deepEqual(await fotos(),antes);
      const avisoAntes=(await pool.query('SELECT * FROM aviso WHERE id=$1',[avisoPrestamo])).rows[0];
      assert.equal((await post(a,`/api/avisos/${avisoPrestamo}/leido`)).status,404);
      assert.deepEqual((await pool.query('SELECT * FROM aviso WHERE id=$1',[avisoPrestamo])).rows[0],avisoAntes);
      assert.equal((await pedir(b,`/api/avisos/${avisoPrestamo}/leido`,'POST',{},false)).status,403);
      const propios=await pedir(b,'/api/avisos');assert.ok(propios.datos.every(v=>v.destinatario_id===ids.b));
      guardar('Leer aviso propio y ajeno','200 repetido sin alterar operaciones; ajeno 404; sin CSRF 403',{id:avisoPrestamo,leido:avisoAntes.leido_en,tablasIntactas:true,reservas:antes.reserva_activa});
    });
    await t.test('4. Repetir una transicion no duplica aviso ni evento',async()=>{
      const antes=await fotos(),avisos=(await pool.query('SELECT * FROM aviso ORDER BY id')).rows;
      assert.equal((await post(d,`/api/gestion/operaciones/${cesiones[0]}/entregar`)).status,200);
      assert.deepEqual(await fotos(),antes);assert.deepEqual((await pool.query('SELECT * FROM aviso ORDER BY id')).rows,avisos);
      guardar('Entrega repetida','200; sin eventos ni avisos nuevos',{correcto:true});
    });
    await t.test('5. Curso y categoria desactivada no borran el historial',async()=>{
      const antes=await pedir(b,'/api/mi-espacio/historial'),operaciones=await fotos();
      await pool.query('UPDATE usuario SET curso_confirmado_id=2 WHERE id=$1',[ids.b]);
      await pool.query(`UPDATE categoria SET activo=false WHERE id=(SELECT r.categoria_id FROM recurso r JOIN ejemplar e ON e.recurso_id=r.id WHERE e.id=$1)`,[ejemplarPrestamo]);
      const despues=await pedir(b,'/api/mi-espacio/historial');assert.deepEqual(despues,antes);assert.deepEqual(await fotos(),operaciones);
      const perfil=await pedir(b,'/api/yo');assert.equal(perfil.datos.curso_confirmado_id,2);
      guardar('Cambio de curso y categoria inactiva','mismos ID, fechas, actores, eventos y reserva; perfil actual curso 2',{historialConservado:true,perfilCurso:2,operaciones:despues.operaciones.map(o=>o.id)});
    });
    await t.test('6. Orden estable, paginacion y quitar filtros',async()=>{
      const pagina1=await pedir(b,'/api/mi-espacio/historial?limite=2'),pagina2=await pedir(b,'/api/mi-espacio/historial?limite=2&pagina=2');
      assert.equal(pagina1.operaciones.length,2);assert.equal(pagina2.operaciones.length,2);
      assert.equal(new Set([...pagina1.operaciones,...pagina2.operaciones].map(o=>o.id)).size,4);
      const filtrado=await pedir(b,'/api/mi-espacio/historial?tipo=prestamo');assert.deepEqual(filtrado.operaciones.map(o=>o.id),[prestamo]);
      assert.equal((await pedir(b,'/api/mi-espacio/historial')).operaciones.length,4);
      for(const q of ['limite=21','pagina=0','tipo=otro'])assert.equal((await pedir(b,'/api/mi-espacio/historial?'+q)).status,422);
      guardar('Filtros y paginas','4 operaciones distintas al reunir dos paginas; quitar filtro restaura 4',{paginas:[pagina1.operaciones.map(o=>o.id),pagina2.operaciones.map(o=>o.id)]});
    });
    if(process.env.PRUEBA_NAVEGADOR==='1')await t.test('7. Mi espacio real: filtros, avisos y movil',async()=>{
      const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE);
      const navegador=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
      try{
        const contexto=await navegador.newContext({viewport:{width:1000,height:800}}),[name,value]=b.cookie.split('=');
        await contexto.addCookies([{name,value,url:base}]);const page=await contexto.newPage();
        await page.goto(base+'/html/mi-espacio.html');await page.locator('#seccion-operaciones').waitFor({state:'visible'});
        await page.waitForFunction(()=>document.querySelectorAll('#mis-operaciones li').length===4);
        await page.locator('#filtro-operacion').selectOption('prestamo');
        await page.waitForFunction(()=>document.querySelectorAll('#mis-operaciones li').length===1&&document.querySelector('#mis-operaciones').textContent.includes('Préstamo'));
        await page.locator('#filtro-operacion').selectOption('');await page.waitForFunction(()=>document.querySelectorAll('#mis-operaciones li').length===4);
        const antes=await fotos();await page.locator('#mis-avisos button').first().click();
        await page.waitForFunction(()=>document.querySelector('#estado-historial').textContent.includes('Aviso leído'));assert.deepEqual(await fotos(),antes);
        await mkdir(new URL('./evidencias/',import.meta.url),{recursive:true});
        await page.evaluate(()=>scrollTo(0,0));
        await page.screenshot({path:fileURLToPath(new URL('./evidencias/historial.png',import.meta.url)),fullPage:true});
        await page.setViewportSize({width:390,height:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await page.evaluate(()=>scrollTo(0,0));
        await page.screenshot({path:fileURLToPath(new URL('./evidencias/historial-movil.png',import.meta.url)),fullPage:true});
        guardar('Pantalla automatizada Edge','4 filas; filtro prestamo 1 y quitar 4; aviso sin efectos; movil 390 sin desbordamiento',{correcto:true,revisionManual:false});
      }finally{await navegador.close();}
    });
    await writeFile(new URL('./resultados.json',import.meta.url),JSON.stringify({version:'HIST-370-2026-11-18-v1',base:'7e7f5d93e80990f05def3082203030f90d0989df',fecha:new Date().toISOString(),node:process.version,postgres:(await pool.query('SHOW server_version')).rows[0].server_version,plan:370,evidencia},null,2));
  }finally{
    if(servidor)await new Promise((ok,fallo)=>servidor.close(e=>e ? fallo(e):ok()));
    if(almacen)await almacen.close();if(pool)await pool.end();
    if(/^aula_test_[a-f0-9]{16}$/.test(esquema))await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await admin.end();
  }
});
