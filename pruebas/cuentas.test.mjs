import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/aplicacion.mjs';

test('Registro, sesión, permisos y revocación en PostgreSQL y HTTP reales', async t => {
  // Se crea un esquema aleatorio separado: nunca se vacían tablas de trabajo.
  const esquema='aula_test_'+randomBytes(8).toString('hex');
  const admin=new pg.Pool({max:1,connectionTimeoutMillis:3000});
  let pool,servidor,almacen;
  try {
    await admin.query(`CREATE SCHEMA ${esquema}`);
    pool=new pg.Pool({max:4,options:`-c search_path=${esquema}`,connectionTimeoutMillis:3000});
    await pool.query(await readFile(new URL('../sql/migraciones/002_cuentas.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../sql/migraciones/003_validacion_docente.sql',import.meta.url),'utf8'));
    const resultado=await crearAplicacion(pool,{origen:'http://127.0.0.1:3000',
      secreto:randomBytes(32).toString('hex'),esquema,limitar:false});
    almacen=resultado.almacen;
    servidor=resultado.app.listen(0,'127.0.0.1');await once(servidor,'listening');
    const base='http://127.0.0.1:'+servidor.address().port;
    const nuevaSesion=()=>({cookie:'',token:''});
    const a=nuevaSesion();const b=nuevaSesion();
    async function pedir(s,ruta,method='GET',body,extra={}){
      const headers={Cookie:s.cookie,...extra};
      if(method!=='GET') Object.assign(headers,{'Content-Type':'application/json',Origin:'http://127.0.0.1:3000','X-CSRF-Token':s.token});
      const r=await fetch(base+ruta,{method,headers,body:body===undefined ? undefined:JSON.stringify(body)});
      const cookies=r.headers.getSetCookie();
      if(cookies.length) s.cookie=cookies[0].split(';')[0];
      const datos=r.status===204 ? {}:await r.json();
      if(datos.token) s.token=datos.token;
      return {estado:r.status,datos,headers:r.headers};
    }
    const registro={alias:'Alumno de prueba',correo:'a01@example.invalid',clave:'una frase ficticia de prueba 123',cursoId:1};
    await t.test('Sin sesión: 401 y CSRF ausente: 403',async()=>{
      assert.equal((await pedir(a,'/api/yo')).estado,401);
      assert.equal((await pedir(a,'/api/registro','POST',registro)).estado,403);
      assert.equal((await pedir(a,'/api/csrf')).estado,200);
      await pedir(b,'/api/csrf');
      const r=await fetch(base+'/api/registro',{method:'POST',headers:{'Content-Type':'application/json',
        Cookie:a.cookie,Origin:'http://otro-origen.invalid','X-CSRF-Token':a.token},body:JSON.stringify(registro)});
      assert.equal(r.status,403);
    });
    await t.test('Registro rechaza roles del cliente y guarda pendiente con hash',async()=>{
      assert.equal((await pedir(a,'/api/registro','POST',{...registro,rol:'docente'})).estado,422);
      assert.equal((await pedir(a,'/api/registro','POST',registro)).estado,202);
      assert.equal((await pedir(a,'/api/registro','POST',registro)).estado,202);
      const r=await pool.query('SELECT estado,hash,curso_confirmado_id FROM usuario');
      assert.equal(r.rowCount,1);assert.equal(r.rows[0].estado,'pendiente');
      assert.notEqual(r.rows[0].hash,registro.clave);assert.match(r.rows[0].hash,/^scrypt\$/);
      assert.equal(r.rows[0].curso_confirmado_id,null);
      assert.deepEqual((await pool.query('SELECT rol FROM usuario_rol')).rows,[{rol:'alumno'}]);
    });
    await t.test('Acceso regenera sesión y permite perfil propio pendiente, sin hash',async()=>{
      assert.equal((await pedir(a,'/api/acceso','POST',{correo:registro.correo,clave:'contraseña equivocada larga'})).estado,401);
      const anterior=a.cookie;const tokenAnterior=a.token;
      assert.equal((await pedir(a,'/api/acceso','POST',{correo:registro.correo,clave:registro.clave})).estado,200);
      assert.notEqual(a.cookie,anterior);assert.notEqual(a.token,tokenAnterior);
      const r=await pedir(a,'/api/yo');assert.equal(r.estado,200);
      assert.equal(r.datos.datos.estado,'pendiente');assert.equal('hash' in r.datos.datos,false);
      assert.equal((await pedir(b,'/api/yo')).estado,401);
      const biblioteca=await pedir(a,'/api/biblioteca');assert.equal(biblioteca.estado,403);
      assert.equal(biblioteca.datos.error,'CUENTA_PENDIENTE');
      assert.match(r.headers.get('cache-control'),/no-store/);
    });
    await t.test('Estado y roles se releen de BD; auth_version revoca la sesión',async()=>{
      await pool.query("UPDATE usuario SET estado='activo'");
      assert.equal((await pedir(a,'/api/yo')).datos.datos.estado,'activo');
      await pool.query("UPDATE usuario SET estado='suspendido'");
      assert.equal((await pedir(a,'/api/biblioteca')).datos.error,'CUENTA_SUSPENDIDA');
      await pool.query('UPDATE usuario SET auth_version=auth_version+1');
      assert.equal((await pedir(a,'/api/yo')).estado,401);
    });
    await t.test('Logout invalida también la cookie anterior',async()=>{
      await pedir(a,'/api/csrf');
      await pedir(a,'/api/acceso','POST',{correo:registro.correo,clave:registro.clave});
      const cookieAnterior=a.cookie;
      assert.equal((await pedir(a,'/api/salida','POST',{})).estado,204);
      assert.equal((await pedir({cookie:cookieAnterior},'/api/yo')).estado,401);
    });
    await t.test('Solo docente activo valida; un admin sin rol docente no puede',async()=>{
      await pool.query("UPDATE usuario SET estado='activo'");
      await pedir(a,'/api/csrf');await pedir(a,'/api/acceso','POST',{correo:registro.correo,clave:registro.clave});
      assert.equal((await pedir(nuevaSesion(),'/api/gestion/usuarios')).estado,401);
      assert.equal((await pedir(a,'/api/gestion/usuarios')).estado,403);
      const admin=await pool.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,estado)
        SELECT 'Admin de prueba','admin@example.invalid',hash,1,'activo' FROM usuario WHERE correo=$1 RETURNING id`,[registro.correo]);
      await pool.query("INSERT INTO usuario_rol VALUES($1,'admin')",[admin.rows[0].id]);
      const c=nuevaSesion();await pedir(c,'/api/csrf');
      await pedir(c,'/api/acceso','POST',{correo:'admin@example.invalid',clave:registro.clave});
      assert.equal((await pedir(c,'/api/gestion/usuarios')).estado,403);
      const pendiente={...registro,correo:'b02@example.invalid',alias:'Alumno B'};
      assert.equal((await pedir(b,'/api/registro','POST',pendiente)).estado,202);
      await pedir(b,'/api/acceso','POST',{correo:pendiente.correo,clave:pendiente.clave});
      const id=(await pedir(b,'/api/yo')).datos.datos.id;
      assert.equal((await pedir(a,`/api/gestion/usuarios/${id}/validar`,'POST',{cursoId:1})).estado,403);
      const docente=await pool.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,estado)
        SELECT 'Docente de prueba','docente@example.invalid',hash,1,'activo' FROM usuario WHERE correo=$1 RETURNING id`,[registro.correo]);
      await pool.query("INSERT INTO usuario_rol VALUES($1,'docente')",[docente.rows[0].id]);
      const d=nuevaSesion();await pedir(d,'/api/csrf');
      await pedir(d,'/api/acceso','POST',{correo:'docente@example.invalid',clave:registro.clave});
      const lista=await pedir(d,'/api/gestion/usuarios');assert.equal(lista.estado,200);
      assert.equal(lista.datos.datos.length,1);assert.equal('hash' in lista.datos.datos[0],false);
      assert.equal((await pedir(d,`/api/gestion/usuarios/${id}/validar`,'POST',{cursoId:9999})).estado,422);
      assert.equal((await pedir(d,`/api/gestion/usuarios/${id}/validar`,'POST',{cursoId:2,rol:'docente'})).estado,422);
      const resultados=await Promise.all([1,2].map(()=>pedir(d,`/api/gestion/usuarios/${id}/validar`,'POST',{cursoId:2})));
      assert.deepEqual(resultados.map(r=>r.estado).sort(),[200,409]);
      const estado=(await pool.query('SELECT estado,curso_confirmado_id,validado_por,validado_en FROM usuario WHERE id=$1',[id])).rows[0];
      assert.equal(estado.estado,'activo');assert.equal(estado.curso_confirmado_id,2);
      assert.equal(estado.validado_por,docente.rows[0].id);assert.ok(estado.validado_en);
      assert.equal((await pool.query('SELECT * FROM evento_cuenta WHERE usuario_id=$1',[id])).rowCount,1);
      assert.deepEqual((await pool.query('SELECT rol FROM usuario_rol WHERE usuario_id=$1',[id])).rows,[{rol:'alumno'}]);
      assert.equal((await pedir(b,'/api/yo')).estado,401);
      await pedir(b,'/api/csrf');await pedir(b,'/api/acceso','POST',{correo:pendiente.correo,clave:pendiente.clave});
      assert.equal((await pedir(b,'/api/yo')).datos.datos.curso_confirmado_id,2);
      await pool.query("UPDATE usuario SET estado='suspendido' WHERE id=$1",[docente.rows[0].id]);
      assert.equal((await pedir(d,'/api/gestion/usuarios')).estado,403);
    });
  } finally {
    if(servidor) await new Promise((ok,fallo)=>servidor.close(e=>e ? fallo(e):ok()));
    if(almacen) await almacen.close();
    if(pool) await pool.end();
    // Solo elimina el esquema aleatorio creado por esta prueba.
    if(/^aula_test_[a-f0-9]{16}$/.test(esquema)) await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await admin.end();
  }
});
