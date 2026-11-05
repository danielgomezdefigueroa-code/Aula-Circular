import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const salida=dirname(fileURLToPath(import.meta.url)),repo=resolve(salida,'../../..');
const require=createRequire(resolve(repo,'package.json')),pg=require('pg'),express=require('express');
const {chromium}=require(process.env.PLAYWRIGHT_MODULO);
const runtime=resolve(salida,'.runtime');
const {crearAplicacion}=await import(pathToFileURL(resolve(runtime,'src/aplicacion.mjs')));
const {crearHash}=await import(pathToFileURL(resolve(runtime,'src/claves.mjs')));
const esquema='aula_teclado_'+randomBytes(8).toString('hex'),control=new pg.Pool({max:1});
let pool,server,almacen,browser;
const resultados={base:'fe1d34f',tipo:'ensayo de teclado con Edge headless y viewport emulado; sin móvil físico',recorridos:[],errores:[],limites:['No se ha usado lector de pantalla','No acredita conformidad WCAG completa','La barrera de foco se prepara deliberadamente en una copia; no se atribuye al original']};
await mkdir(resolve(salida,'evidencias'),{recursive:true});
try{
 await control.query(`CREATE SCHEMA ${esquema}`);pool=new pg.Pool({max:6,options:`-c search_path=${esquema}`});
 const migraciones=resolve(runtime,'sql/migraciones');for(const n of (await readdir(migraciones)).filter(n=>n.endsWith('.sql')).sort())await pool.query(await readFile(resolve(migraciones,n),'utf8'));
 const clave='Ensayo ficticio de teclado 2026',hash=await crearHash(clave),ids={};
 for(const [nombre,rol] of [['alumno','alumno'],['propietario','alumno']]){
  ids[nombre]=(await pool.query("INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,curso_confirmado_id,estado) VALUES($1,$2,$3,1,1,'activo') RETURNING id",['Ensayo '+nombre,nombre+'@example.invalid',hash])).rows[0].id;
  await pool.query('INSERT INTO usuario_rol VALUES($1,$2)',[ids[nombre],rol]);
 }
 server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const app=await crearAplicacion(pool,{origen:base,secreto:randomBytes(32).toString('hex'),esquema,limitar:false});almacen=app.almacen;
 const outer=express();for(const version of ['original','antes','despues'])outer.use('/'+version,express.static(version==='original'?resolve(runtime,'public'):resolve(salida,version,'public')));outer.use(app.app);server.on('request',outer);
 browser=await chromium.launch({channel:'msedge',headless:true});
 resultados.entorno={node:process.version,postgres:(await pool.query('SHOW server_version')).rows[0].server_version,navegador:browser.version(),fecha:new Date().toISOString()};
 async function contexto(width,autenticar=true){
  const ctx=await browser.newContext({viewport:{width,height:900}});
  if(autenticar){const token=(await (await ctx.request.get(base+'/api/csrf')).json()).token;const r=await ctx.request.post(base+'/api/acceso',{headers:{Origin:base,'X-CSRF-Token':token},data:{correo:'alumno@example.invalid',clave}});assert.equal(r.status(),200);}
  return ctx;
 }
 async function estado(page){return page.evaluate(()=>{const a=document.activeElement,s=getComputedStyle(a);return {tag:a.tagName,id:a.id,texto:(a.innerText??a.getAttribute('aria-label')??'').trim().slice(0,65),outline:s.outlineStyle,anchoOutline:s.outlineWidth,colorOutline:s.outlineColor,focusVisible:a.matches(':focus-visible')};});}
 async function tecla(page,key,log){await page.keyboard.press(key);log.push({tecla:key,foco:await estado(page)});}
 async function hasta(page,selector,log,max=35){
  for(let n=0;n<max;n++){if(await page.locator(selector).evaluate(e=>e===document.activeElement))return;await tecla(page,'Tab',log);}
  throw Error('No se alcanza con Tab: '+selector);
 }
 async function captura(page,nombre){await page.screenshot({path:resolve(salida,'evidencias',nombre),fullPage:!nombre.includes('03-solicitud')});}
 // Main flow uses real keyboard events; identity is a stated setup prerequisite.
 for(const version of ['original','antes','despues'])for(const width of [320,390]){
  const titulo=`Programación ${version} ${width}`;
  const recurso=(await pool.query("INSERT INTO recurso(origen,tipo,titulo,curso_id,asignatura,edicion) VALUES('alumno','fisico',$1,1,'Programación','2026') RETURNING id",[titulo])).rows[0].id;
  const ejemplar=(await pool.query("INSERT INTO ejemplar(recurso_id,codigo,propietario_usuario_id,conservacion) VALUES($1,$2,$3,'Completo') RETURNING id",[recurso,version+'-'+width,ids.propietario])).rows[0].id;
  await pool.query("INSERT INTO anuncio(ejemplar_id,modalidad,estado_revision) VALUES($1,'cesion','publicado')",[ejemplar]);
  const ctx=await contexto(width),page=await ctx.newPage(),log=[];page.on('pageerror',e=>resultados.errores.push(e.message));
  await page.goto(`${base}/${version}/html/libros.html`);await page.locator('#libros li').first().waitFor();
  await hasta(page,'#menu-boton',log);const focoMenu=await estado(page);await captura(page,`${version}-${width}-01-foco.png`);
  await tecla(page,'Enter',log);assert.equal(await page.locator('#menu-boton').getAttribute('aria-expanded'),'true');
  await tecla(page,'Tab',log);const enlaceEnMenu=await estado(page);assert.equal(enlaceEnMenu.tag,'A');
  await tecla(page,'Escape',log);assert.equal(await page.locator('#menu-boton').getAttribute('aria-expanded'),'false');assert.equal((await estado(page)).id,'menu-boton');
  await tecla(page,'Tab',log);await tecla(page,'Shift+Tab',log);assert.equal((await estado(page)).id,'menu-boton');
  await hasta(page,'#lib-q',log);await page.keyboard.type(titulo);log.push({accion:'Escribir búsqueda',texto:titulo});
  await hasta(page,'#filtros-libros button[type=submit]',log);await tecla(page,'Enter',log);
  await page.waitForFunction(t=>document.querySelectorAll('#libros li').length===1&&document.querySelector('#libros').textContent.includes(t),titulo);
  await captura(page,`${version}-${width}-02-busqueda.png`);
  await hasta(page,'#libros button',log);assert.match(await page.locator('#libros button').first().innerText(),/Solicitar/);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/solicitudes')&&r.request().method()==='POST');
  await tecla(page,'Enter',log);assert.equal((await response).status(),201);
  await page.waitForFunction(()=>document.querySelector('#mensaje').textContent.includes('Solicitud de cesión enviada'));
  const focoFinal=await estado(page);assert.equal(focoFinal.id,'mensaje');log.push({accion:'Resultado confirmado y foco en el aviso',foco:focoFinal});
  const solicitud=(await pool.query('SELECT estado FROM solicitud WHERE ejemplar_id=$1 AND solicitante_id=$2',[ejemplar,ids.alumno])).rows[0];assert.equal(solicitud.estado,'pendiente');
  const reservas=(await pool.query('SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1',[ejemplar])).rowCount;assert.equal(reservas,0);
  const medida=await page.evaluate(()=>({viewport:innerWidth,contenido:document.documentElement.scrollWidth}));assert.ok(medida.contenido<=width);
  await captura(page,`${version}-${width}-03-solicitud.png`);
  if(version==='antes'){assert.equal(focoMenu.outline,'none');}else{assert.notEqual(focoMenu.outline,'none');assert.equal(focoMenu.focusVisible,true);}
  resultados.recorridos.push({version,width,log,focoMenu,focoFinal,enlaceEnMenu,medida,solicitud:solicitud.estado,reservas,resultado:version==='antes'?'Barrera didáctica reproducida: foco sin indicador':'APROBADO: recorrido completado con foco visible'});
  await ctx.close();
 }
 // Invalid form: keyboard submission, error association and recovery target.
 for(const version of ['antes','despues'])for(const width of [320,390]){
  const ctx=await contexto(width,false),page=await ctx.newPage(),log=[];
  await page.goto(`${base}/${version}/html/login.html`);await page.locator('#form-acceso').waitFor();await page.waitForFunction(()=>document.querySelector('#boton-acceso').disabled===false);
  await hasta(page,'#boton-acceso',log);await tecla(page,'Enter',log);await page.locator('#resumen-errores:not([hidden])').waitFor();
  const error=await page.evaluate(()=>({foco:document.activeElement.id,resumen:document.querySelector('#resumen-errores').innerText,campos:['acc-correo','acc-contrasena'].map(id=>{const e=document.getElementById(id);return {id,label:e.labels?.[0]?.textContent,invalid:e.getAttribute('aria-invalid'),descritoPor:e.getAttribute('aria-describedby'),mensaje:document.getElementById(id+'-error')?.textContent};}),viewport:innerWidth,contenido:document.documentElement.scrollWidth}));
  assert.equal(error.foco,'resumen-errores');assert.ok(error.campos.every(e=>e.label&&e.invalid==='true'&&e.mensaje));assert.ok(error.contenido<=width);
  await captura(page,`${version}-${width}-04-error.png`);
  await tecla(page,'Tab',log);await tecla(page,'Enter',log);assert.equal((await estado(page)).id,'acc-correo');
  resultados.recorridos.push({version,width,caso:'Formulario vacío',log,error,resultado:'APROBADO: errores específicos asociados y foco en resumen'});await ctx.close();
 }
 // Wider screens: responsive checks, separate from mobile keyboard evidence.
 for(const width of [768,1440]){const ctx=await contexto(width),page=await ctx.newPage();await page.goto(`${base}/despues/html/libros.html`);await page.locator('#libros li').first().waitFor();const medida=await page.evaluate(()=>({viewport:innerWidth,contenido:document.documentElement.scrollWidth}));assert.ok(medida.contenido<=width);resultados.recorridos.push({version:'despues',width,caso:'Reflujo',medida,resultado:'APROBADO'});await ctx.close();}
 resultados.cambio={archivo:'antes/public/css/estilo.css',antes:':focus, :focus-visible { outline: none !important; box-shadow: none !important; }',despues:'Eliminar exclusivamente la regla didáctica y conservar el estilo :focus-visible original de Aula Circular.'};
 resultados.sha256={};for(const version of ['antes','despues'])resultados.sha256[version]=createHash('sha256').update(await readFile(resolve(salida,version,'public/css/estilo.css'))).digest('hex');
 assert.deepEqual(resultados.errores,[]);
 await writeFile(resolve(salida,'resultados.json'),JSON.stringify(resultados,null,2));
 console.log(JSON.stringify({recorridos:resultados.recorridos.length,erroresJavaScript:resultados.errores.length,resultado:'APROBADO',salida},null,2));
 if(process.argv.includes('--servir')){
  console.log(`Ensayo manual: ${base}/antes/html/login.html y ${base}/despues/html/login.html. Cerrar con Ctrl+C.`);
  await new Promise(ok=>process.once('SIGINT',ok));
 }
}finally{
 if(browser)await browser.close();if(server)await new Promise(ok=>server.close(ok));if(almacen)await almacen.close();if(pool)await pool.end();if(/^aula_teclado_[a-f0-9]{16}$/.test(esquema))await control.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);await control.end();
}
