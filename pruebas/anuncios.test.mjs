import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/aplicacion.mjs';
import { crearHash } from '../src/claves.mjs';

test('Anuncios propios, estados y concurrencia con PostgreSQL y HTTP reales',async t=>{
  const esquema='aula_test_'+randomBytes(8).toString('hex');
  const admin=new pg.Pool({max:1,connectionTimeoutMillis:3000});let pool,servidor,almacen;
  try{
    await admin.query(`CREATE SCHEMA ${esquema}`);
    pool=new pg.Pool({max:5,options:`-c search_path=${esquema}`,connectionTimeoutMillis:3000});
    const dir=new URL('../sql/migraciones/',import.meta.url);
    for(const nombre of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(nombre,dir),'utf8'));
    const clave='Frase de ensayo para anuncios 2026';const hash=await crearHash(clave);const ids={};
    for(const [nombre,estado,rol] of [['a','activo','alumno'],['b','activo','alumno'],['d','activo','docente'],['p','pendiente','alumno']]){
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
    const {a,b,d,p}=sesiones;
    const datos={titulo:'Libro de programación',descripcion:'Ejemplo ficticio',cursoId:2,asignatura:'Programación',edicion:'2024',isbn:'9780306406157',conservacion:'Buen estado, sin páginas sueltas.',modalidad:'prestamo'};
    let id,ejemplar,version;
    await t.test('Validación de campos, CSRF, cuenta activa y propiedad desde sesión',async()=>{
      assert.equal((await pedir({},'/api/mi-espacio')).status,401);
      assert.equal((await pedir(p,'/api/anuncios','POST',datos)).status,403);
      assert.equal((await pedir(d,'/api/anuncios','POST',datos)).status,403);
      assert.equal((await pedir(a,'/api/anuncios','POST',datos,false)).status,403);
      for(const campos of [{propietarioId:ids.b},{estado_revision:'publicado'},{titulo:' '},{edicion:''},{cursoId:999},{isbn:'9780306406158'}]){
        assert.equal((await pedir(a,'/api/anuncios','POST',{...datos,...campos})).status,422);
      }
      assert.equal((await pool.query('SELECT * FROM anuncio')).rowCount,0);
      const r=await pedir(a,'/api/anuncios','POST',datos);assert.equal(r.status,201);
      id=r.datos.id;version=r.datos.version;assert.equal(r.datos.estado_revision,'borrador');
      const detalle=await pedir(a,'/api/anuncios/'+id);ejemplar=detalle.datos.ejemplar_id;
      assert.equal(detalle.datos.propietario_usuario_id,ids.a);assert.match(detalle.datos.codigo,/^LIB-/);
      assert.equal((await pedir(a,'/api/libros')).datos.length,0);
    });
    await t.test('Otra cuenta no puede leer, editar, enviar ni cambiar el propietario',async()=>{
      assert.equal((await pedir(b,'/api/mi-espacio')).datos.length,0);
      assert.equal((await pedir(b,'/api/anuncios/'+id)).status,404);
      assert.equal((await pedir(b,'/api/anuncios/'+id,'PATCH',{...datos,titulo:'Ajeno',version})).status,404);
      assert.equal((await pedir(b,`/api/anuncios/${id}/enviar`,'POST',{version})).status,404);
      assert.equal((await pedir(a,'/api/anuncios/'+id,'PATCH',{...datos,version,propietario_usuario_id:ids.b})).status,422);
      assert.equal((await pedir(a,'/api/anuncios/'+id)).datos.titulo,datos.titulo);
    });
    await t.test('Dos ediciones de la misma versión: una guarda y otra recibe 409',async()=>{
      const resultados=await Promise.all(['Edición A','Edición B'].map(edicion=>pedir(a,'/api/anuncios/'+id,'PATCH',{...datos,edicion,version})));
      assert.deepEqual(resultados.map(r=>r.status).sort(),[200,409]);
      const actual=(await pedir(a,'/api/anuncios/'+id)).datos;version=actual.version;
      assert.equal(version,2);assert.ok(['Edición A','Edición B'].includes(actual.edicion));
    });
    await t.test('Enviar a revisión no publica y conserva historial',async()=>{
      const r=await pedir(a,`/api/anuncios/${id}/enviar`,'POST',{version});assert.equal(r.status,200);version=r.datos.version;
      const detalle=await pedir(a,'/api/anuncios/'+id);assert.equal(detalle.datos.estado_revision,'pendiente');
      assert.equal(detalle.historial.length,3);assert.equal(detalle.historial[0].accion,'enviar');
      assert.equal((await pedir(a,'/api/libros')).datos.length,0);
      assert.equal((await pedir(a,`/api/anuncios/${id}/enviar`,'POST',{version})).status,409);
      assert.equal((await pedir(a,'/api/anuncios/'+id,'PATCH',{...datos,version})).status,409);
    });
    await t.test('Corregir un rechazo conserva motivo e historial y permite reenviar',async()=>{
      // Fixture de una revisión docente: el panel de revisión pertenece al siguiente sprint.
      await pool.query("UPDATE anuncio SET estado_revision='rechazado',motivo='Aclara la conservación',version=version+1 WHERE id=$1",[id]);
      await pool.query(`INSERT INTO evento_anuncio(anuncio_id,actor_id,accion,estado_anterior,estado_nuevo,motivo)
        VALUES($1,$2,'rechazar','pendiente','rechazado','Aclara la conservación')`,[id,ids.d]);
      version=(await pedir(a,'/api/anuncios/'+id)).datos.version;
      const r=await pedir(a,'/api/anuncios/'+id,'PATCH',{...datos,conservacion:'Portada gastada, interior sin marcas.',version});
      assert.equal(r.status,200);version=r.datos.version;assert.equal(r.datos.estado_revision,'borrador');
      const detalle=await pedir(a,'/api/anuncios/'+id);assert.equal(detalle.datos.motivo,'Aclara la conservación');
      assert.ok(detalle.historial.some(e=>e.accion==='rechazar'));
      const enviado=await pedir(a,`/api/anuncios/${id}/enviar`,'POST',{version});assert.equal(enviado.status,200);version=enviado.datos.version;
    });
    await t.test('Editar publicado vuelve a revisión y cancela propuestas sin reserva',async()=>{
      await pool.query("UPDATE anuncio SET estado_revision='publicado',version=version+1 WHERE id=$1",[id]);
      assert.equal((await pedir(a,'/api/libros')).datos.length,1);
      const publicado=(await pedir(a,'/api/anuncios/'+id)).datos;version=publicado.version;
      const igual=await pedir(a,'/api/anuncios/'+id,'PATCH',{...datos,conservacion:publicado.conservacion,version});
      assert.equal(igual.status,200);assert.equal(igual.datos.estado_revision,'publicado');assert.equal(igual.datos.version,version);
      const op=await pool.query("INSERT INTO operacion(tipo,estado) VALUES('intercambio','propuesta') RETURNING id");
      await pool.query('INSERT INTO operacion_item VALUES($1,$2,$3,$4)',[op.rows[0].id,ejemplar,ids.a,ids.b]);
      const r=await pedir(a,'/api/anuncios/'+id,'PATCH',{...datos,titulo:'Libro corregido',version});
      assert.equal(r.status,200);version=r.datos.version;assert.equal(r.datos.estado_revision,'pendiente');
      assert.equal((await pedir(a,'/api/libros')).datos.length,0);
      assert.equal((await pool.query('SELECT estado FROM operacion WHERE id=$1',[op.rows[0].id])).rows[0].estado,'cancelada');
      assert.equal((await pool.query('SELECT * FROM evento_operacion WHERE operacion_id=$1',[op.rows[0].id])).rowCount,1);
    });
    await t.test('Una operación activa bloquea cambios sin alterar el ejemplar ni el anuncio',async()=>{
      const op=await pool.query("INSERT INTO operacion(tipo,estado) VALUES('prestamo','prestada') RETURNING id");
      await pool.query('INSERT INTO operacion_item VALUES($1,$2,$3,$4)',[op.rows[0].id,ejemplar,ids.a,ids.b]);
      await pool.query('INSERT INTO reserva_activa VALUES($1,$2)',[ejemplar,op.rows[0].id]);
      const antes=(await pedir(a,'/api/anuncios/'+id)).datos;
      const r=await pedir(a,'/api/anuncios/'+id,'PATCH',{...datos,titulo:'Cambio prohibido',version});
      assert.equal(r.status,409);assert.equal(r.error,'EJEMPLAR_OCUPADO');
      const despues=(await pedir(a,'/api/anuncios/'+id)).datos;
      assert.equal(despues.titulo,antes.titulo);assert.equal(despues.version,antes.version);
      assert.equal((await pool.query('SELECT * FROM reserva_activa')).rowCount,1);
    });
    await t.test('Sin ISBN se admite; la paginación y los datos privados se controlan',async()=>{
      assert.equal((await pedir(a,'/api/anuncios','POST',{...datos,isbn:''})).status,201);
      assert.equal((await pedir(a,'/api/mi-espacio?limite=21')).status,422);
      assert.equal((await pedir(a,'/api/mi-espacio?propietario=2')).status,422);
      assert.equal((await pedir(a,'/api/libros')).datos.some(x=>'correo' in x||'propietario_usuario_id' in x),false);
    });
  }finally{
    if(servidor)await new Promise((ok,fallo)=>servidor.close(e=>e ? fallo(e):ok()));
    if(almacen)await almacen.close();if(pool)await pool.end();
    if(/^aula_test_[a-f0-9]{16}$/.test(esquema))await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await admin.end();
  }
});
