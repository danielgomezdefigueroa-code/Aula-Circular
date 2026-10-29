// HTTP real de la parte de Daniel. No reserva ni entrega intercambios.
// Conserva cuentas y anuncios ficticios de cada ejecucion en la base del Sprint 4.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/aplicacion.mjs';
import { crearHash } from '../src/claves.mjs';

if (process.env.PGDATABASE !== 'aula_circular_sprint4_ensayo' ||
    !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) || process.env.PGUSER !== 'aula_app' ||
    (process.env.NODE_ENV && process.env.NODE_ENV !== 'development')) {
  throw new Error('Usa solo la base local del Sprint 4 como aula_app en desarrollo.');
}
const pool = new pg.Pool({ max: 5, connectionTimeoutMillis: 4000 });
const origen = 'http://127.0.0.1:3000';
const sufijo = randomUUID().slice(0, 8);
// Solo reduce la salida para la captura; se ejecutan siempre los 21 casos.
const captura = process.argv.includes('--captura');
const casosVisibles = new Set(['Propuesta valida', 'Tercero acepta', 'Version manipulada',
  'Receptor acepta', 'Aceptacion repetida', 'Editar material aceptado',
  'Aceptar acuerdo cancelado', 'Nueva propuesta tras republicar']);
let servidor, almacen, total = 0;

try {
  const cursoId = (await pool.query('SELECT id FROM curso WHERE activo ORDER BY id LIMIT 1')).rows[0]?.id;
  assert.ok(cursoId, 'Falta preparar los cursos');
  const cuentas = {};
  for (const [nombre, rol, activo] of [['D01', 'docente', true], ['A01', 'alumno', true],
    ['A02', 'alumno', true], ['A03', 'alumno', true], ['P01', 'alumno', false]]) {
    const clave = randomUUID(), hash = await crearHash(clave);
    const correo = `${nombre.toLowerCase()}-${sufijo}@example.test`;
    const id = (await pool.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id)
      VALUES($1,$2,$3,$4) RETURNING id`, [`${nombre}-${sufijo}`, correo, hash, cursoId])).rows[0].id;
    await pool.query('INSERT INTO usuario_rol(usuario_id,rol) VALUES($1,$2)', [id, rol]);
    if (activo) await pool.query(`UPDATE usuario SET estado='activo', curso_confirmado_id=$1,
      validado_por=$2, validado_en=now() WHERE id=$3`, [cursoId, cuentas.D01?.id ?? id, id]);
    cuentas[nombre] = { id, correo, clave, sesion: {} };
  }
  const app = await crearAplicacion(pool, { origen, secreto: randomBytes(32).toString('hex'), limitar: false });
  almacen = app.almacen;
  servidor = app.app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const base = `http://127.0.0.1:${servidor.address().port}`;

  // Cookies y tokens separados por identidad; nunca se muestran.
  async function pedir(s, ruta, metodo = 'GET', cuerpo, csrf = true) {
    const headers = {};
    if (s.cookie) headers.Cookie = s.cookie;
    if (metodo !== 'GET') {
      headers.Origin = origen;
      headers['Content-Type'] = 'application/json';
      if (csrf && s.token) headers['X-CSRF-Token'] = s.token;
    }
    const r = await fetch(base + ruta, { method: metodo, headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(6000) });
    const cookie = r.headers.getSetCookie()[0];
    if (cookie) s.cookie = cookie.split(';')[0];
    const texto = await r.text(), datos = texto ? JSON.parse(texto) : null;
    if (datos?.token) s.token = datos.token;
    return { codigo: r.status, cuerpo: datos };
  }
  for (const c of Object.values(cuentas)) {
    assert.equal((await pedir(c.sesion, '/api/csrf')).codigo, 200);
    assert.equal((await pedir(c.sesion, '/api/acceso', 'POST', { correo: c.correo, clave: c.clave })).codigo, 200);
  }
  const a = cuentas.A01.sesion, b = cuentas.A02.sesion, tercero = cuentas.A03.sesion;
  const d = cuentas.D01.sesion;
  const post = (s, ruta, datos) => pedir(s, ruta, 'POST', datos);

  async function anuncio(s, modalidad = 'intercambio', publicar = true) {
    const datos = { titulo: `Manual de ensayo ${randomUUID().slice(0, 8)}`, descripcion: 'Ejemplar ficticio',
      cursoId, asignatura: 'Bases de datos', edicion: '2026', isbn: '', conservacion: 'Completo', modalidad };
    const alta = await post(s, '/api/anuncios', datos);
    assert.equal(alta.codigo, 201);
    const id = alta.cuerpo.datos.id;
    if (publicar) {
      const envio = await post(s, `/api/anuncios/${id}/enviar`, { version: alta.cuerpo.datos.version });
      assert.equal(envio.codigo, 200);
      assert.equal((await post(d, `/api/gestion/anuncios/${id}/revision`,
        { version: envio.cuerpo.datos.version, decision: 'aprobar', motivo: '' })).codigo, 200);
    }
    const actual = (await pedir(s, `/api/anuncios/${id}`)).cuerpo.datos;
    return { id, ejemplarId: actual.ejemplar_id, version: actual.version, datos };
  }
  console.log('RESERVA CONJUNTA | HTTP real y PostgreSQL');
  console.log('Ensayo:', sufijo);

  async function comprobar(nombre, sesion, ruta, esperado, csrf = true) {
    const r = await pedir(sesion, ruta, 'POST', {}, csrf);
    console.log(`\n${nombre}: POST ${ruta}`);
    console.log(`Esperado: ${esperado} | Observado: ${r.codigo}`);
    console.log(JSON.stringify(r.cuerpo));
    assert.equal(r.codigo, esperado, nombre);
    return r;
  }

  async function estadoSql(id) {
    return (await pool.query(
      `SELECT o.estado, o.docente_id,
        (SELECT count(*)::int FROM aceptacion_intercambio
         WHERE operacion_id=o.id) AS aceptaciones,
        (SELECT count(*)::int FROM reserva_activa
         WHERE operacion_id=o.id) AS reservas,
        (SELECT count(*)::int FROM evento_operacion
         WHERE operacion_id=o.id) AS eventos,
        (SELECT count(*)::int FROM aviso
         WHERE operacion_id=o.id) AS avisos
       FROM operacion o WHERE o.id=$1`,
      [id]
    )).rows[0];
  }

  async function prepararAcuerdo(sesionA, sesionB, materialA, materialB) {
    const r = await post(sesionA, '/api/intercambios', {
      ejemplarOfrecidoId: materialA.ejemplarId,
      ejemplarSolicitadoId: materialB.ejemplarId,
      confirmoPropuesta: true
    });
    assert.equal(r.codigo, 201);
    const propuesta = r.cuerpo.datos;

    return {
      id: propuesta.id,
      aceptar: async () => {
        const respuesta = await post(
          sesionB,
          `/api/intercambios/${propuesta.id}/aceptar`,
          {
            ejemplarOfrecidoId: propuesta.ejemplarOfrecidoId,
            ejemplarSolicitadoId: propuesta.ejemplarSolicitadoId,
            versionOfrecida: propuesta.versionOfrecida,
            versionSolicitada: propuesta.versionSolicitada,
            confirmoAceptacion: true
          }
        );
        assert.equal(respuesta.codigo, 200);
      }
    };
  }

  const materialA = await anuncio(a);
  const materialB = await anuncio(b);

  const acuerdo = await prepararAcuerdo(a, b, materialA, materialB);
  const ruta = `/api/gestion/intercambios/${acuerdo.id}/reservar`;

  const inicial = await estadoSql(acuerdo.id);
  assert.equal(inicial.aceptaciones, 1);
  assert.equal(inicial.reservas, 0);

  const faltaAceptacion = await comprobar(
    'Solo una aceptacion', d, ruta, 409
  );
  assert.equal(
    faltaAceptacion.cuerpo.error,
    'ACEPTACIONES_PENDIENTES'
  );
  assert.deepEqual(await estadoSql(acuerdo.id), inicial);
  console.log('SQL: propuesta intacta, una aceptacion y cero reservas.');

  await acuerdo.aceptar();
  const aceptado = await estadoSql(acuerdo.id);
  assert.equal(aceptado.aceptaciones, 2);
  assert.equal(aceptado.reservas, 0);

  await comprobar('Alumno intenta reservar', a, ruta, 403);
  assert.deepEqual(await estadoSql(acuerdo.id), aceptado);

  await comprobar('Docente sin CSRF', d, ruta, 403, false);
  assert.deepEqual(await estadoSql(acuerdo.id), aceptado);

  // Otra propuesta válida comparte materialB, pero ofrece otro ejemplar.
  // Se prepara antes de reservar: proponer y aceptar no ocupan material.
  const materialC = await anuncio(tercero);
  const competidor = await prepararAcuerdo(
    tercero, b, materialC, materialB
  );
  await competidor.aceptar();

  await comprobar('Docente reserva ambos', d, ruta, 200);

  const reservado = await estadoSql(acuerdo.id);
  assert.equal(reservado.estado, 'reservada');
  assert.equal(reservado.docente_id, cuentas.D01.id);
  assert.equal(reservado.reservas, 2);
  assert.equal(reservado.eventos, aceptado.eventos + 1);
  assert.equal(reservado.avisos, aceptado.avisos + 2);

  const reservas = (await pool.query(
    `SELECT ejemplar_id, operacion_id
     FROM reserva_activa
     WHERE operacion_id=$1
     ORDER BY ejemplar_id`,
    [acuerdo.id]
  )).rows;

  assert.deepEqual(
    reservas.map(r => r.ejemplar_id),
    [materialA.ejemplarId, materialB.ejemplarId].sort((x, y) => x - y)
  );

  console.log('\nSQL: dos reservas para una unica operacion.');
  console.log(JSON.stringify(reservas, null, 2));

  await comprobar('Reserva repetida', d, ruta, 409);
  assert.deepEqual(await estadoSql(acuerdo.id), reservado);

  const antesConflicto = await estadoSql(competidor.id);
  const conflicto = await comprobar(
    'Otro acuerdo comparte un ejemplar ocupado',
    d,
    `/api/gestion/intercambios/${competidor.id}/reservar`,
    409
  );
  assert.equal(conflicto.cuerpo.error, 'EJEMPLAR_OCUPADO');
  assert.deepEqual(await estadoSql(competidor.id), antesConflicto);

  assert.equal((await pool.query(
    'SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1',
    [materialC.ejemplarId]
  )).rowCount, 0);

  assert.deepEqual((await pool.query(
    `SELECT ejemplar_id, operacion_id
     FROM reserva_activa
     WHERE operacion_id=$1
     ORDER BY ejemplar_id`,
    [acuerdo.id]
  )).rows, reservas);

  console.log('SQL: el acuerdo rechazado conserva cero reservas.');
  console.log('Su otro ejemplar sigue libre; la reserva ganadora permanece.');

  const propietarios = (await pool.query(
    `SELECT id, propietario_usuario_id
     FROM ejemplar WHERE id=ANY($1::integer[]) ORDER BY id`,
    [[materialA.ejemplarId, materialB.ejemplarId, materialC.ejemplarId]]
  )).rows;

  for (const [material, propietario] of [
    [materialA, cuentas.A01.id],
    [materialB, cuentas.A02.id],
    [materialC, cuentas.A03.id]
  ]) {
    assert.equal(
      propietarios.find(e => e.id === material.ejemplarId)
        .propietario_usuario_id,
      propietario
    );
  }

  console.log('\nRESULTADO: reserva conjunta y rechazos comprobados.');
  console.log('Sin medias reservas, cambios de propietario ni avisos duplicados.');
  console.log('Competencia secuencial comprobada; no es prueba de concurrencia.');
  console.log('Los datos ficticios del ensayo se conservan.');
} catch (error) {
  console.error('PRUEBA FALLIDA. Codigo:', error.code ?? 'sin codigo');
  if (error.code === 'ERR_ASSERTION') console.error('Comprobacion:', error.message);
  process.exitCode = 1;
} finally {
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  if (almacen) await almacen.close();
  await pool.end();
}
