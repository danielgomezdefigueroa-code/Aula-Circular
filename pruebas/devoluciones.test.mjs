import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/aplicacion.mjs';
import { crearHash } from '../src/claves.mjs';

test('Devoluciones: HTTP y PostgreSQL reales con esquema temporal',async t => {
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
    await t.test('Permisos, CSRF, campos manipulados y conservación no apta mantienen los datos',async()=>{
      const x=await preparar(),antes=await foto(x);
      for(const [s,b,csrf,codigo] of [
        [sesiones.alumno,cuerpo,true,403],[sesiones.pendiente,cuerpo,true,403],
        [sesiones.doc,cuerpo,false,403],[sesiones.doc,{...cuerpo,docenteId:ids.alumno},true,422],
        [sesiones.doc,{...cuerpo,apto:false},true,409],[sesiones.doc,{apto:true,conservacion:''},true,422]
      ]) { assert.equal((await devolver(s,x,b,csrf)).codigo,codigo);assert.deepEqual(await foto(x),antes); }
    });
    await t.test('Cesión, intercambio y préstamo sin entregar no admiten devolución',async()=>{
      for(const [tipo,estado] of [['cesion','reservada'],['intercambio','reservada'],['prestamo','reservada']]) {
        const x=await preparar(tipo,estado),antes=await foto(x);
        assert.equal((await devolver(sesiones.doc,x)).codigo,409);assert.deepEqual(await foto(x),antes);
      }
    });
    await t.test('Incidencia abierta, retirada o reserva incoherente no liberan ejemplar',async()=>{
      for(const caso of ['incidencia','retirado','reserva']) {
        const x=await preparar();
        if(caso==='incidencia')await pool.query(`INSERT INTO incidencia(operacion_id,ejemplar_id,autor_id,tipo,descripcion)
          VALUES($1,$2,$3,'dano','Cubierta dañada')`,[x.id,x.ejemplar,ids.doc]);
        if(caso==='retirado')await pool.query("UPDATE ejemplar SET estado_servicio='retirado' WHERE id=$1",[x.ejemplar]);
        if(caso==='reserva')await pool.query('DELETE FROM reserva_activa WHERE operacion_id=$1',[x.id]);
        const antes=await foto(x);assert.equal((await devolver(sesiones.doc,x)).codigo,409);assert.deepEqual(await foto(x),antes);
      }
    });
    await t.test('Devolución normal de préstamo vencido libera reserva y conserva origen y entrega',async()=>{
      const x=await preparar(),antes=await foto(x);
      assert.equal(antes.operacion[0].estado,'prestada');assert.equal(antes.reservas.length,1);
      assert.equal((await devolver(sesiones.doc,x)).codigo,200);
      const fin=await foto(x);
      assert.equal(fin.operacion[0].estado,'completada');assert.equal(fin.reservas.length,0);
      assert.deepEqual(fin.operacion[0].entregada_en,antes.operacion[0].entregada_en);
      assert.ok(fin.operacion[0].cerrada_en);assert.equal(fin.ejemplar[0].estado_servicio,'habilitado');
      assert.equal(fin.ejemplar[0].propietario_usuario_id,null);assert.equal(fin.ejemplar[0].conservacion,cuerpo.conservacion);
      assert.equal(fin.eventos.length,1);assert.equal(fin.avisos.length,1);
      assert.equal((await devolver(sesiones.doc,x)).codigo,409);assert.deepEqual(await foto(x),fin);
    });
    await t.test('Dos devoluciones simultáneas: una confirma, la otra rechaza; un solo evento',async()=>{
      const x=await preparar();
      const rs=await Promise.all([devolver(sesiones.doc,x),devolver(sesiones.doc,x)]);
      assert.deepEqual(rs.map(r=>r.codigo).sort(),[200,409]);
      const fin=await foto(x);assert.equal(fin.eventos.length,1);assert.equal(fin.avisos.length,1);assert.equal(fin.reservas.length,0);
    });
    await t.test('Fallo real de PostgreSQL al final revierte operación, reserva, conservación, evento y aviso',async()=>{
      const x=await preparar(),antes=await foto(x);
      // Inyección exclusivamente en este esquema temporal; ningún interruptor de fallo en la API.
      await pool.query(`CREATE FUNCTION fallar_aviso_devolucion() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Fallo simulado antes de COMMIT'; END; $$`);
      await pool.query(`CREATE TRIGGER fallo_ensayo BEFORE INSERT ON aviso FOR EACH ROW EXECUTE FUNCTION fallar_aviso_devolucion()`);
      try {
        assert.equal((await devolver(sesiones.doc,x)).codigo,500);
        assert.deepEqual(await foto(x),antes);
      } finally {await pool.query('DROP TRIGGER fallo_ensayo ON aviso');await pool.query('DROP FUNCTION fallar_aviso_devolucion()');}
      assert.equal((await devolver(sesiones.doc,x)).codigo,200);
    });
  } finally {
    if(servidor)await new Promise((ok,mal)=>servidor.close(e=>e?mal(e):ok()));
    if(almacen)await almacen.close();if(pool)await pool.end();
    if(/^aula_test_[a-f0-9]{16}$/.test(esquema))await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await admin.end();
  }
});
