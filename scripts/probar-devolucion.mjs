// Ensayo conservado para comparar antes/después en pgAdmin. Nunca usa datos reales.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import { crearAplicacion } from '../src/aplicacion.mjs';
import { crearHash } from '../src/claves.mjs';

if (process.env.PGDATABASE !== 'aula_circular_devoluciones_ensayo' ||
    !['localhost','127.0.0.1','::1'].includes(process.env.PGHOST) ||
    process.env.PGUSER !== 'aula_app' || process.env.NODE_ENV === 'production') {
  throw new Error('Usa solo la base local aula_circular_devoluciones_ensayo con aula_app.');
}
const pool = new pg.Pool({max:5,connectionTimeoutMillis:3000});
const ensayo=randomBytes(4).toString('hex'),codigo='DEV-'+ensayo;
const clave=randomBytes(24).toString('hex');
let servidor,almacen,operacion,ejemplar;
try {
  assert.equal((await pool.query("SELECT to_regclass('incidencia') IS NOT NULL AS lista")).rows[0].lista,true,'Aplica las migraciones primero');
  const hash=await crearHash(clave),c=await pool.connect();
  let docente;
  try {
    await c.query('BEGIN');
    const curso=(await c.query('SELECT id FROM curso WHERE activo ORDER BY id LIMIT 1')).rows[0]?.id;
    assert.ok(curso,'Falta un curso de ensayo activo');
    const usuarios=[];
    for (const [nombre,rol] of [['Docente','docente'],['Alumno','alumno']]) {
      const u=(await c.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,estado)
        VALUES($1,$2,$3,$4,'activo') RETURNING id`,[nombre+' ensayo '+ensayo,nombre.toLowerCase()+'.'+ensayo+'@example.invalid',hash,curso])).rows[0].id;
      await c.query('INSERT INTO usuario_rol VALUES($1,$2)',[u,rol]);usuarios.push(u);
    }
    docente=usuarios[0];
    const recurso=(await c.query(`INSERT INTO recurso(origen,tipo,titulo,curso_id,asignatura,edicion)
      VALUES('centro','fisico',$1,$2,'Programación','2026') RETURNING id`,['Manual de ensayo '+ensayo,curso])).rows[0].id;
    ejemplar=(await c.query(`INSERT INTO ejemplar(recurso_id,codigo,conservacion)
      VALUES($1,$2,'Buen estado antes de la entrega') RETURNING id`,[recurso,codigo])).rows[0].id;
    operacion=(await c.query(`INSERT INTO operacion(tipo,estado,docente_id,entregada_en,vencimiento)
      VALUES('prestamo','prestada',$1,now()-interval '3 days',now()-interval '1 day') RETURNING id`,[docente])).rows[0].id;
    await c.query('INSERT INTO operacion_item VALUES($1,$2,NULL,$3)',[operacion,ejemplar,usuarios[1]]);
    await c.query('INSERT INTO reserva_activa VALUES($1,$2)',[ejemplar,operacion]);
    await c.query("INSERT INTO evento_operacion(operacion_id,actor_id,accion,motivo) VALUES($1,$2,'entregar','Entrega ficticia preparada mediante SQL')",[operacion,docente]);
    await c.query('COMMIT');
  } catch(e) {await c.query('ROLLBACK').catch(()=>{});throw e;} finally {c.release();}

  async function foto() {
    return (await pool.query(`SELECT o.id AS operacion,o.estado,e.codigo,e.estado_servicio,e.conservacion,
      (SELECT count(*)::int FROM reserva_activa WHERE operacion_id=o.id) AS reservas,
      (SELECT count(*)::int FROM evento_operacion WHERE operacion_id=o.id AND accion='devolver') AS devoluciones,
      (SELECT count(*)::int FROM aviso WHERE operacion_id=o.id) AS avisos,
      o.entregada_en,o.cerrada_en
      FROM operacion o JOIN operacion_item i ON i.operacion_id=o.id JOIN ejemplar e ON e.id=i.ejemplar_id
      WHERE o.id=$1`,[operacion])).rows[0];
  }
  console.log('ENSAYO DE DEVOLUCION | Base:',process.env.PGDATABASE,'| Código:',codigo);
  console.log('Preparación SQL de un préstamo ya entregado. La devolución se ejecutará por HTTP real.');
  const antes=await foto();console.log('ANTES:',JSON.stringify(antes));
  assert.equal(antes.estado,'prestada');assert.equal(antes.reservas,1);
  console.log('CONSULTA PARA PGADMIN (solo lectura):');
  console.log(`SELECT o.id AS operacion,o.estado,e.codigo,e.estado_servicio,e.conservacion,
 (SELECT count(*) FROM reserva_activa WHERE operacion_id=o.id) AS reservas,
 (SELECT count(*) FROM evento_operacion WHERE operacion_id=o.id AND accion='devolver') AS devoluciones
FROM operacion o JOIN operacion_item i ON i.operacion_id=o.id
JOIN ejemplar e ON e.id=i.ejemplar_id WHERE o.id=${operacion};`);
  if (!process.argv.includes('--automatico')) {
    const terminal=createInterface({input:process.stdin,output:process.stdout});
    try {await terminal.question('Consulta y captura el ANTES en pgAdmin. Después vuelve aquí y pulsa ENTER para devolver.');}
    finally {terminal.close();}
  }
  const resultado=await crearAplicacion(pool,{origen:'http://127.0.0.1:3000',secreto:randomBytes(32).toString('hex'),limitar:false});
  almacen=resultado.almacen;servidor=resultado.app.listen(0,'127.0.0.1');await once(servidor,'listening');
  const base='http://127.0.0.1:'+servidor.address().port;let cookie='',token='';
  async function pedir(ruta,cuerpo) {
    const r=await fetch(base+ruta,{method:cuerpo===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:'http://127.0.0.1:3000',
      'Content-Type':'application/json',...(token?{'X-CSRF-Token':token}:{})},body:cuerpo===undefined?undefined:JSON.stringify(cuerpo)});
    if(r.headers.getSetCookie().length)cookie=r.headers.getSetCookie()[0].split(';')[0];
    const b=await r.json();if(b.token)token=b.token;return {codigo:r.status,cuerpo:b};
  }
  await pedir('/api/csrf');
  assert.equal((await pedir('/api/acceso',{correo:'docente.'+ensayo+'@example.invalid',clave})).codigo,200);
  const ruta=`/api/gestion/operaciones/${operacion}/devolver`;
  const entrada={apto:true,conservacion:'Buen estado comprobado al devolver'};
  const r=await pedir(ruta,entrada);console.log('DEVOLUCION: POST',ruta,'| esperado 200 | observado',r.codigo);
  console.log(JSON.stringify(r.cuerpo));assert.equal(r.codigo,200);
  const despues=await foto();console.log('DESPUES:',JSON.stringify(despues));
  assert.equal(despues.estado,'completada');assert.equal(despues.reservas,0);assert.equal(despues.devoluciones,1);
  assert.equal(despues.avisos,1);assert.equal(despues.estado_servicio,'habilitado');
  assert.deepEqual(despues.entregada_en,antes.entregada_en);assert.ok(despues.cerrada_en);
  const repetida=await pedir(ruta,entrada);console.log('REPETICION: esperado 409 | observado',repetida.codigo,JSON.stringify(repetida.cuerpo));
  assert.equal(repetida.codigo,409);assert.deepEqual(await foto(),despues);
  console.log('RESULTADO: devolución y repetición comprobadas. Ejecuta otra vez la misma consulta en pgAdmin para capturar el DESPUES.');
  console.log('Se conserva este ensayo: dos cuentas, un ejemplar y una operación; no se borran datos anteriores.');
} finally {
  if(servidor)await new Promise((ok,mal)=>servidor.close(e=>e?mal(e):ok()));
  if(almacen)await almacen.close();await pool.end();
}
