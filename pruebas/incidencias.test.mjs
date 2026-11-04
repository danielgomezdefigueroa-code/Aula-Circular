import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/aplicacion.mjs';
import { crearHash } from '../src/claves.mjs';

test('Incidencias: HTTP y PostgreSQL reales con esquema temporal',async t => {
  const esquema='aula_test_'+randomBytes(8).toString('hex');
  const admin=new pg.Pool({max:1,connectionTimeoutMillis:3000});
  let pool,servidor,almacen;
  try {
    await admin.query(`CREATE SCHEMA ${esquema}`);
    pool=new pg.Pool({max:5,options:`-c search_path=${esquema}`,connectionTimeoutMillis:3000});
    const dir=new URL('../sql/migraciones/',import.meta.url);
    for (const n of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(n,dir),'utf8'));
    const clave=randomBytes(24).toString('hex'),hash=await crearHash(clave),ids={},sesiones={};
    for (const [nombre,rol,estado] of [['doc','docente','activo'],['alumno','alumno','activo'],['pendiente','docente','pendiente']]) {
      ids[nombre]=(await pool.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,estado)
        VALUES($1,$2,$3,1,$4) RETURNING id`,[nombre,nombre+'@example.invalid',hash,estado])).rows[0].id;
      await pool.query('INSERT INTO usuario_rol VALUES($1,$2)',[ids[nombre],rol]);
    }
    const resultado=await crearAplicacion(pool,{origen:'http://127.0.0.1:3000',secreto:randomBytes(32).toString('hex'),esquema,limitar:false});
    almacen=resultado.almacen;servidor=resultado.app.listen(0,'127.0.0.1');await once(servidor,'listening');
    const base='http://127.0.0.1:'+servidor.address().port;
    async function pedir(s,ruta,body,csrf=true) {
      const r=await fetch(base+ruta,{method:body===undefined?'GET':'POST',headers:{Cookie:s.cookie??'',
        Origin:'http://127.0.0.1:3000','Content-Type':'application/json',...(csrf&&s.token?{'X-CSRF-Token':s.token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      if(r.headers.getSetCookie().length)s.cookie=r.headers.getSetCookie()[0].split(';')[0];
      const b=await r.json();if(b.token)s.token=b.token;return {codigo:r.status,cuerpo:b};
    }
    for(const nombre of Object.keys(ids)) {
      const s={};await pedir(s,'/api/csrf');assert.equal((await pedir(s,'/api/acceso',{correo:nombre+'@example.invalid',clave})).codigo,200);sesiones[nombre]=s;
    }
    let numero=0;
    // Semilla SQL explícita: préstamos ya entregados, no simula la adjudicación HTTP anterior.
    async function preparar(tipo='prestamo',estado='prestada') {
      numero++;
      const recurso=(await pool.query(`INSERT INTO recurso(origen,tipo,titulo,asignatura,edicion)
        VALUES('centro','fisico',$1,'General','2026') RETURNING id`,['Ensayo '+numero])).rows[0].id;
      const ejemplar=(await pool.query(`INSERT INTO ejemplar(recurso_id,codigo,conservacion)
        VALUES($1,$2,'Estado inicial') RETURNING id`,[recurso,'DEV-'+numero])).rows[0].id;
      const op=(await pool.query(`INSERT INTO operacion(tipo,estado,docente_id,vencimiento,entregada_en)
        VALUES($1,$2,$3,now()-interval '1 day',CASE WHEN $2='prestada' THEN now()-interval '3 days' ELSE NULL END) RETURNING id`,[tipo,estado,ids.doc])).rows[0].id;
      await pool.query('INSERT INTO operacion_item VALUES($1,$2,NULL,$3)',[op,ejemplar,ids.alumno]);
      await pool.query('INSERT INTO reserva_activa VALUES($1,$2)',[ejemplar,op]);
      return {id:op,ejemplar};
    }
    async function foto(x) {
      return {
        operacion:(await pool.query('SELECT * FROM operacion WHERE id=$1',[x.id])).rows,
        ejemplar:(await pool.query('SELECT * FROM ejemplar WHERE id=$1',[x.ejemplar])).rows,
        reservas:(await pool.query('SELECT * FROM reserva_activa WHERE ejemplar_id=$1',[x.ejemplar])).rows,
        eventos:(await pool.query('SELECT * FROM evento_operacion WHERE operacion_id=$1 ORDER BY id',[x.id])).rows,
        avisos:(await pool.query('SELECT * FROM aviso WHERE operacion_id=$1 ORDER BY id',[x.id])).rows,
        incidencias:(await pool.query('SELECT * FROM incidencia WHERE operacion_id=$1 ORDER BY id',[x.id])).rows
      };
    }
    const cuerpo={apto:true,conservacion:'Buen estado tras la devolución'};
    const devolver=(s,x,b=cuerpo,csrf=true)=>pedir(s,`/api/gestion/operaciones/${x.id}/devolver`,b,csrf);
	     const dano = {
      tipo: 'dano',
      descripcion: 'Cubierta dañada durante el préstamo'
    };

    const abrir = (s, x, datos = dano, csrf = true) =>
      pedir(s, `/api/gestion/operaciones/${x.id}/incidencias`, datos, csrf);

    await t.test('Rechaza permisos, CSRF y datos manipulados sin escribir', async () => {
      const x = await preparar();
      const antes = await foto(x);

      for (const [sesion, datos, csrf, codigo] of [
        [sesiones.alumno, dano, true, 403],
        [sesiones.pendiente, dano, true, 403],
        [sesiones.doc, dano, false, 403],
        [sesiones.doc, { ...dano, ejemplarId: x.ejemplar }, true, 422],
        [sesiones.doc, { ...dano, descripcion: ' ' }, true, 422]
      ]) {
        const respuesta = await abrir(sesion, x, datos, csrf);
        assert.equal(respuesta.codigo, codigo, JSON.stringify(respuesta.cuerpo));
        assert.deepEqual(await foto(x), antes);
      }
    });

    await t.test('Abre incidencia y conserva el préstamo y su reserva', async t => {
      const x = await preparar();
      const antes = await foto(x);

      const respuesta = await abrir(sesiones.doc, x);
      assert.equal(respuesta.codigo, 201, JSON.stringify(respuesta.cuerpo));
      assert.equal(respuesta.cuerpo.datos.ejemplar_id, x.ejemplar);

      const despues = await foto(x);
      assert.deepEqual(despues.operacion, antes.operacion);
      assert.deepEqual(despues.ejemplar, antes.ejemplar);
      assert.deepEqual(despues.reservas, antes.reservas);
      assert.equal(despues.reservas.length, 1);
      assert.equal(despues.incidencias.length, 1);
      assert.equal(despues.incidencias[0].estado, 'abierta');
      assert.equal(despues.incidencias[0].tipo, 'dano');
      assert.equal(despues.eventos.length, antes.eventos.length + 1);
      assert.equal(despues.eventos.at(-1).accion, 'abrir_incidencia');
      assert.equal(despues.avisos.length, antes.avisos.length + 1);

      t.diagnostic(`POST incidencias: esperado 201, observado ${respuesta.codigo}.`);
      t.diagnostic(
        `SQL antes: ${antes.operacion[0].estado}, ` +
        `${antes.reservas.length} reserva, ${antes.incidencias.length} incidencias.`
      );
      t.diagnostic(
        `SQL después: ${despues.operacion[0].estado}, ` +
        `${despues.reservas.length} reserva, incidencia ${despues.incidencias[0].estado}.`
      );
    });

    await t.test('Bloquea apertura repetida y devolución con incidencia abierta', async t => {
      const x = await preparar();
      assert.equal((await abrir(sesiones.doc, x)).codigo, 201);
      const antes = await foto(x);

      for (const [accion, ejecutar] of [
        ['Repetir apertura', () => abrir(sesiones.doc, x)],
        ['Devolver', () => devolver(sesiones.doc, x)]
      ]) {
        const respuesta = await ejecutar();
        assert.equal(respuesta.codigo, 409, JSON.stringify(respuesta.cuerpo));
        assert.equal(respuesta.cuerpo.error, 'INCIDENCIA_PENDIENTE');
        assert.deepEqual(await foto(x), antes);
        t.diagnostic(`${accion}: HTTP 409 INCIDENCIA_PENDIENTE; SQL sin cambios.`);
      }
    });
    const resolucion = {
      resolucion: 'Daño irreparable: se retira el ejemplar'
    };

    const baja = (s, x, incidenciaId, datos = resolucion, csrf = true) =>
      pedir(
        s,
        `/api/gestion/operaciones/${x.id}/incidencias/${incidenciaId}/baja`,
        datos,
        csrf
      );

    await t.test('Baja docente: cierra el préstamo y libera la reserva una sola vez', async t => {
      const x = await preparar();
      const apertura = await abrir(sesiones.doc, x);
      assert.equal(apertura.codigo, 201);
      const incidenciaId = apertura.cuerpo.datos.id;
      const antes = await foto(x);

      for (const [ejecutar, codigo] of [
        [() => baja(sesiones.alumno, x, incidenciaId), 403],
        [() => baja(sesiones.doc, x, incidenciaId, resolucion, false), 403],
        [() => baja(sesiones.doc, x, incidenciaId, { resolucion: ' ' }), 422],
        [() => baja(sesiones.doc, x, incidenciaId + 1), 409]
      ]) {
        const rechazo = await ejecutar();
        assert.equal(rechazo.codigo, codigo, JSON.stringify(rechazo.cuerpo));
        assert.deepEqual(await foto(x), antes);
      }

      const respuesta = await baja(sesiones.doc, x, incidenciaId);
      assert.equal(respuesta.codigo, 200, JSON.stringify(respuesta.cuerpo));

      const fin = await foto(x);
      assert.equal(fin.operacion[0].estado, 'cerrada_por_incidencia');
      assert.ok(fin.operacion[0].cerrada_en);
      assert.deepEqual(fin.operacion[0].entregada_en, antes.operacion[0].entregada_en);
      assert.equal(fin.ejemplar[0].estado_servicio, 'retirado');
      assert.equal(fin.ejemplar[0].propietario_usuario_id, antes.ejemplar[0].propietario_usuario_id);
      assert.equal(fin.reservas.length, 0);
      assert.equal(fin.incidencias.length, 1);
      assert.equal(fin.incidencias[0].id, incidenciaId);
      assert.equal(fin.incidencias[0].estado, 'resuelta');
      assert.equal(fin.incidencias[0].resolucion, resolucion.resolucion);
      assert.equal(fin.incidencias[0].resuelta_por, ids.doc);
      assert.ok(fin.incidencias[0].resuelta_en);
      assert.deepEqual(fin.eventos.map(e => e.accion), [
        'abrir_incidencia', 'baja_por_incidencia'
      ]);
      assert.equal(fin.avisos.length, antes.avisos.length + 1);

      assert.equal((await baja(sesiones.doc, x, incidenciaId)).codigo, 409);
      assert.deepEqual(await foto(x), fin);

      t.diagnostic(`POST baja: esperado 200, observado ${respuesta.codigo}.`);
      t.diagnostic(
        `SQL antes: ${antes.operacion[0].estado}, ` +
        `${antes.incidencias[0].estado}, ${antes.reservas.length} reserva.`
      );
      t.diagnostic(
        `SQL después: ${fin.operacion[0].estado}, ` +
        `ejemplar ${fin.ejemplar[0].estado_servicio}, ` +
        `incidencia ${fin.incidencias[0].estado}, ${fin.reservas.length} reservas.`
      );
      t.diagnostic('Repetición: HTTP 409; SQL sin cambios ni evento de devolución.');
    });

    await t.test('Fallo al guardar el aviso revierte toda la baja y permite reintentar', async t => {
      const x = await preparar();
      const apertura = await abrir(sesiones.doc, x);
      assert.equal(apertura.codigo, 201);
      const incidenciaId = apertura.cuerpo.datos.id;
      const antes = await foto(x);

      // Solo se instala en el esquema temporal de este ensayo.
      await pool.query(`
        CREATE FUNCTION fallar_aviso_baja() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Fallo de ensayo antes del COMMIT'; END; $$`);
      await pool.query(`
        CREATE TRIGGER fallo_aviso_baja BEFORE INSERT ON aviso
        FOR EACH ROW EXECUTE FUNCTION fallar_aviso_baja()`);

      try {
        assert.equal((await baja(sesiones.doc, x, incidenciaId)).codigo, 500);
        assert.deepEqual(await foto(x), antes);
        t.diagnostic('Fallo provocado: HTTP 500; incidencia abierta y reserva intacta.');
      } finally {
        await pool.query('DROP TRIGGER fallo_aviso_baja ON aviso');
        await pool.query('DROP FUNCTION fallar_aviso_baja()');
      }

      assert.equal((await baja(sesiones.doc, x, incidenciaId)).codigo, 200);
      const fin = await foto(x);
      assert.equal(fin.operacion[0].estado, 'cerrada_por_incidencia');
      assert.equal(fin.incidencias[0].estado, 'resuelta');
      assert.equal(fin.reservas.length, 0);
      assert.equal(fin.eventos.length, antes.eventos.length + 1);
      assert.equal(fin.avisos.length, antes.avisos.length + 1);
      t.diagnostic('Reintento: HTTP 200; baja confirmada y cero reservas.');
    });
    await t.test('Un préstamo entregado no se puede cancelar', async t => {
      const x = await preparar();
      const antes = await foto(x);

      assert.equal(antes.operacion[0].estado, 'prestada');
      assert.equal(antes.reservas.length, 1);

      const respuesta = await pedir(
        sesiones.doc,
        `/api/gestion/operaciones/${x.id}/cancelar`,
        { motivo: 'Intento de cancelar después de la entrega' }
      );

      assert.equal(respuesta.codigo, 409, JSON.stringify(respuesta.cuerpo));
      assert.equal(respuesta.cuerpo.error, 'MODALIDAD_NO_ADMITIDA');
      assert.deepEqual(await foto(x), antes);

      t.diagnostic(
        'HTTP 409 MODALIDAD_NO_ADMITIDA; SQL: préstamo prestado, ' +
        'una reserva activa y sin cambios.'
      );
    });
  } finally {
    if(servidor)await new Promise((ok,mal)=>servidor.close(e=>e?mal(e):ok()));
    if(almacen)await almacen.close();if(pool)await pool.end();
    if(/^aula_test_[a-f0-9]{16}$/.test(esquema))await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await admin.end();
  }
});
