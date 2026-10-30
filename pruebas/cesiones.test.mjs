import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/aplicacion.mjs';
import { crearHash } from '../src/claves.mjs';

test('Cesiones, moderación y reasignación con PostgreSQL y HTTP reales',async t=>{
  const esquema='aula_test_'+randomBytes(8).toString('hex');
  const admin=new pg.Pool({max:1,connectionTimeoutMillis:3000});let pool,servidor,almacen;
  try{
    await admin.query(`CREATE SCHEMA ${esquema}`);
    pool=new pg.Pool({max:5,options:`-c search_path=${esquema}`,connectionTimeoutMillis:3000});
    const dir=new URL('../sql/migraciones/',import.meta.url);
    for(const nombre of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(nombre,dir),'utf8'));
    const clave='Frase de ensayo para anuncios 2026';const hash=await crearHash(clave);const ids={};
    for(const [nombre,estado,rol] of [['a','activo','alumno'],['b','activo','alumno'],['d','activo','docente'],['p','pendiente','alumno'],['c','activo','alumno']]){
      const r=await pool.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,estado)
        VALUES($1,$2,$3,1,$4) RETURNING id`,['Cuenta '+nombre,nombre+'@example.invalid',hash,estado]);
      ids[nombre]=r.rows[0].id;await pool.query('INSERT INTO usuario_rol VALUES($1,$2)',[ids[nombre],rol]);
    }
    const resultado=await crearAplicacion(pool,{origen:'http://127.0.0.1:3000',secreto:randomBytes(32).toString('hex'),esquema,limitar:false});
    almacen=resultado.almacen;servidor=resultado.app.listen(0,'127.0.0.1');await once(servidor,'listening');
    const base='http://127.0.0.1:'+servidor.address().port;
    async function pedir(s,ruta,method='GET',body,conCsrf=true){
      const headers={Cookie:s.cookie??''};
      if(method!=='GET')Object.assign(headers,{'Content-Type':'application/json',Origin:'http://127.0.0.1:3000',...(conCsrf ? {'X-CSRF-Token':s.token}:{})});
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
    await t.test('Moderación: permisos, rechazo motivado, corrección y aprobación',async()=>{
      const x=await anuncio();assert.equal((await post(b,'/api/solicitudes',{ejemplarId:x.ejemplar})).status,409);
      assert.equal((await post(a,`/api/gestion/anuncios/${x.id}/revision`,{version:x.version,decision:'aprobar',motivo:''})).status,403);
      assert.equal((await post(d,`/api/gestion/anuncios/${x.id}/revision`,{version:x.version,decision:'rechazar',motivo:''})).status,422);
      assert.equal((await post(d,`/api/gestion/anuncios/${x.id}/revision`,{version:x.version,decision:'rechazar',motivo:'Aclara conservación'})).status,200);
      const actual=(await pedir(a,'/api/anuncios/'+x.id)).datos;
      const edit=await pedir(a,'/api/anuncios/'+x.id,'PATCH',{...datos,conservacion:'Portada gastada; todas las páginas intactas',version:actual.version});assert.equal(edit.status,200);
      x.version=(await post(a,`/api/anuncios/${x.id}/enviar`,{version:edit.datos.version})).datos.version;await aprobar(x);
    });
    await t.test('Cesión completa: solicitud propia, reserva única, entrega repetida e historial',async()=>{
      const x=await anuncio();await aprobar(x);assert.equal((await post(a,'/api/solicitudes',{ejemplarId:x.ejemplar})).status,422);
      const s=await solicitar(b,x);assert.equal((await post(b,'/api/solicitudes',{ejemplarId:x.ejemplar})).status,409);
      assert.equal((await asignar(s)).status,201);const op=(await pedir(d,'/api/operaciones')).datos[0];
      assert.equal((await post(b,`/api/gestion/operaciones/${op.id}/entregar`)).status,403);
      assert.equal((await post(b,'/api/solicitudes',{ejemplarId:x.ejemplar})).status,409);
      const entregas=await Promise.all([post(d,`/api/gestion/operaciones/${op.id}/entregar`),post(d,`/api/gestion/operaciones/${op.id}/entregar`)]);assert.deepEqual(entregas.map(r=>r.status),[200,200]);
      assert.equal((await pool.query("SELECT * FROM evento_operacion WHERE operacion_id=$1 AND accion='entregar'",[op.id])).rowCount,1);
      assert.equal((await pool.query('SELECT * FROM reserva_activa WHERE ejemplar_id=$1',[x.ejemplar])).rowCount,0);
      const e=(await pool.query('SELECT * FROM ejemplar WHERE id=$1',[x.ejemplar])).rows[0];assert.equal(e.estado_servicio,'retirado');assert.equal(e.propietario_usuario_id,ids.a);
      assert.equal((await post(d,`/api/gestion/operaciones/${op.id}/cancelar`,{motivo:'No procede'})).status,409);
      assert.ok(!(await pedir(b,'/api/libros')).datos.some(y=>y.id===x.id));
    });
    await t.test('Cancelación previa y ampliación 500: nuevas solicitudes sin reactivar antiguas',async()=>{
      const x=await anuncio();await aprobar(x);const s=await solicitar(b,x);
      const c={};await pedir(c,'/api/csrf');await pedir(c,'/api/acceso','POST',{correo:'c@example.invalid',clave});
      const otra=await solicitar(c,x);const carreras=await Promise.all([asignar(s),asignar(otra)]);assert.deepEqual(carreras.map(r=>r.status).sort(),[201,409]);
      const op=(await pool.query('SELECT operacion_id FROM reserva_activa WHERE ejemplar_id=$1',[x.ejemplar])).rows[0].operacion_id;
      assert.equal((await post(d,`/api/gestion/operaciones/${op}/cancelar`,{motivo:'Destinatario renuncia antes de recoger'})).status,200);
      assert.equal((await pool.query('SELECT * FROM reserva_activa WHERE ejemplar_id=$1',[x.ejemplar])).rowCount,0);
      const estados=(await pool.query('SELECT estado FROM solicitud WHERE id=ANY($1::integer[])',[[s,otra]])).rows.map(x=>x.estado).sort();assert.deepEqual(estados,['adjudicada','rechazada']);
      const nueva=await solicitar(b,x);assert.equal((await asignar(nueva)).status,201);
      assert.equal((await pool.query('SELECT * FROM operacion_item WHERE ejemplar_id=$1',[x.ejemplar])).rowCount,2);
      assert.equal((await pool.query('SELECT estado FROM operacion WHERE id=$1',[op])).rows[0].estado,'cancelada');
    });
  }finally{
    if(servidor)await new Promise((ok,fallo)=>servidor.close(e=>e ? fallo(e):ok()));
    if(almacen)await almacen.close();if(pool)await pool.end();
    if(/^aula_test_[a-f0-9]{16}$/.test(esquema))await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await admin.end();
  }
});
