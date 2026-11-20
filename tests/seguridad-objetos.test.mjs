import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';

test('SP7 Fede: objetos, CSRF y búsquedas con datos intactos',async t=>{
  const esquema='aula_test_'+randomBytes(8).toString('hex');
  const admin=new pg.Pool({max:1,connectionTimeoutMillis:3000});let pool,servidor,almacen;
  try{
    await admin.query(`CREATE SCHEMA ${esquema}`);
    pool=new pg.Pool({max:5,options:`-c search_path=${esquema}`,connectionTimeoutMillis:3000});
    const dir = new URL('../sql/migraciones/', import.meta.url);

    for (const nombre of (await readdir(dir))
      .filter(n => n.endsWith('.sql'))
      .sort()) {
      await pool.query(
        await readFile(new URL(nombre, dir), 'utf8')
      );
    }
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

    // Los nombres son constantes del test, nunca entradas HTTP.
    const tablas = ['recurso','ejemplar','anuncio','evento_anuncio',
      'solicitud','operacion','operacion_item','reserva_activa',
      'evento_operacion','aviso'];
    async function foto() {
      const estado = {};
      for (const tabla of tablas) {
        estado[tabla] = (await pool.query(
          `SELECT to_jsonb(t) AS fila FROM ${tabla} t ORDER BY to_jsonb(t)::text`
        )).rows;
      }
      return estado;
    }
    function respuestaSegura(respuesta) {
      function revisar(valor) {
        if (!valor || typeof valor !== 'object') return;
        for (const [clave, contenido] of Object.entries(valor)) {
          assert.ok(!/^(stack|password|clave|hash|token|cookie|ruta_interna|sql)$/i.test(clave),
            'La respuesta no debe exponer campos internos');
          revisar(contenido);
        }
      }
      revisar(respuesta);
       assert.doesNotMatch(JSON.stringify(respuesta), /node_modules|file:\/\/\/|[A-Z]:\\|\/workspace\//);
    }
    async function rechazo(s, ruta, metodo, cuerpo, csrf, esperado) {
      const antes = await foto();
      const respuesta = await pedir(s,ruta,metodo,cuerpo,csrf);
      assert.equal(respuesta.status,esperado);
      respuestaSegura(respuesta);
      assert.deepEqual(await foto(),antes);
      t.diagnostic(`${metodo} ${ruta}: esperado ${esperado}, observado ${respuesta.status}; datos intactos.`);
      t.diagnostic('Respuesta: '+JSON.stringify(respuesta));
      return respuesta;
    }

    await t.test('Escrituras sin CSRF o mal formadas no crean datos; alta válida sí',async()=>{
      await rechazo(a,'/api/anuncios','POST',datos,false,403);
      await rechazo(a,'/api/anuncios','POST',{...datos,titulo:' '},true,422);
      await rechazo(a,'/api/anuncios','POST',{...datos,propietarioId:ids.b},true,422);
      const creada=await pedir(a,'/api/anuncios','POST',datos);
      assert.equal(creada.status,201);
      id=creada.datos.id;version=creada.datos.version;
      const detalle=await pedir(a,'/api/anuncios/'+id);
      assert.equal(detalle.status,200);
      assert.equal(detalle.datos.propietario_usuario_id,ids.a);
      t.diagnostic('Alta permitida: HTTP 201; propietario obtenido de la sesión de A01.');
    });

    await t.test('B01 no edita el anuncio de A01; A01 conserva la edición permitida',async()=>{
      await rechazo(b,'/api/anuncios/'+id,'PATCH',
        {...datos,titulo:'Cambio ajeno',version},true,404);
      await rechazo(a,'/api/anuncios/'+id,'PATCH',
        {...datos,version},false,403);
      await rechazo(a,'/api/anuncios/'+id,'PATCH',
        {...datos,version,titulo:[]},true,422);
      const editada=await pedir(a,'/api/anuncios/'+id,'PATCH',
        {...datos,titulo:'Libro propio editado SP7',version});
      assert.equal(editada.status,200);
      const actual=await pedir(a,'/api/anuncios/'+id);
      assert.equal(actual.datos.titulo,'Libro propio editado SP7');
      assert.equal(actual.datos.propietario_usuario_id,ids.a);
      version=actual.datos.version;
      t.diagnostic('Edición propia: HTTP 200; título actualizado y propietario intacto.');
    });
    await t.test('Aviso ajeno, falta de CSRF e ID inválido no cambian datos',async()=>{
      const avisoId=(await pool.query(
        'INSERT INTO aviso(destinatario_id,mensaje) VALUES($1,$2) RETURNING id',
        [ids.a,'Aviso ficticio de A01 para SP7'])).rows[0].id;
      await rechazo(b,`/api/avisos/${avisoId}/leido`,'POST',{},true,404);
      await rechazo(a,`/api/avisos/${avisoId}/leido`,'POST',{},false,403);
      await rechazo(a,'/api/avisos/abc/leido','POST',{},true,422);
      const leido=await pedir(a,`/api/avisos/${avisoId}/leido`,'POST',{});
      assert.equal(leido.status,200);
      const fila=(await pool.query('SELECT destinatario_id,leido FROM aviso WHERE id=$1',[avisoId])).rows[0];
      assert.equal(fila.destinatario_id,ids.a);assert.equal(fila.leido,true);
      t.diagnostic('Aviso propio: HTTP 200 y leido=true; destinatario intacto.');
    });

    await t.test('Comillas y texto SQL se buscan como valores; búsqueda válida se conserva',async()=>{
      const textoSQL="' OR '1'='1";
      const creada=await pedir(a,'/api/anuncios','POST',{
        ...datos,titulo:'Manual literal '+textoSQL,isbn:''
      });
      assert.equal(creada.status,201);
      const literalId=creada.datos.id;
      // Publicación mediante las rutas reales, sin simular permisos en el cliente.
      for(const anuncioId of [id,literalId]) {
        const propia=await pedir(a,'/api/anuncios/'+anuncioId);
        const enviada=await pedir(a,`/api/anuncios/${anuncioId}/enviar`,'POST',{
          version:propia.datos.version
        });
        assert.equal(enviada.status,200);
        const publicada=await pedir(d,`/api/gestion/anuncios/${anuncioId}/revision`,'POST',{
          version:enviada.datos.version,decision:'aprobar',motivo:''
        });
        assert.equal(publicada.status,200);
      }
      const antes=await foto();
      const todos=await pedir(a,'/api/libros');
      assert.equal(todos.status,200);assert.equal(todos.total,2);
      const literal=await pedir(a,'/api/libros?q='+encodeURIComponent(textoSQL));
      assert.equal(literal.status,200);assert.equal(literal.total,1);
      assert.deepEqual(literal.datos.map(x=>x.id),[literalId]);
      respuestaSegura(literal);
      const inexistente=await pedir(a,'/api/libros?q='+encodeURIComponent("zzzz' OR '1'='1 --"));
      assert.equal(inexistente.status,200);assert.equal(inexistente.total,0);
      const normal=await pedir(a,'/api/libros?q='+encodeURIComponent('Libro propio editado SP7'));
      assert.equal(normal.status,200);assert.equal(normal.total,1);
      assert.equal(normal.datos[0].id,id);
      assert.deepEqual(await foto(),antes);
      t.diagnostic('GET /api/libros?q='+encodeURIComponent(textoSQL)+': HTTP 200; solo el título literal (1 de 2).');
      t.diagnostic('Texto sin coincidencia: HTTP 200, cero filas. Búsqueda normal: HTTP 200, una fila.');
      t.diagnostic('SQL: tablas y datos intactos. No se imprimen cookies, tokens ni contraseñas.');
    });
  } finally {
    if(servidor) await new Promise((ok,mal)=>{
      servidor.close(e=>e?mal(e):ok());
      servidor.closeAllConnections();
    });
    if(almacen) await almacen.close();
    if(pool) await pool.end();
    if(/^aula_test_[a-f0-9]{16}$/.test(esquema))
      await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await admin.end();
    }
});