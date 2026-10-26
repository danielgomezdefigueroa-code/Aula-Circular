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
  const ofrecido = await anuncio(a), solicitado = await anuncio(b);
  const entrada = { ejemplarOfrecidoId: ofrecido.ejemplarId,
    ejemplarSolicitadoId: solicitado.ejemplarId, confirmoPropuesta: true };
  async function caso(nombre, sesion, ruta, datos, esperado, opciones = {}) {
    const r = await pedir(sesion, ruta, opciones.metodo ?? 'POST', datos, opciones.csrf !== false);
    assert.equal(r.codigo, esperado, nombre);
    if (opciones.error) assert.equal(r.cuerpo.error, opciones.error, nombre);
    total++;
    if (!captura || casosVisibles.has(nombre)) {
      console.log(`${nombre}: ${opciones.metodo ?? 'POST'} ${ruta} | esperado ${esperado} | observado ${r.codigo}`);
      console.log(JSON.stringify(r.cuerpo));
    }
    return r;
  }
  console.log('SPRINT 4 | HTTP real y PostgreSQL | Ensayo:', sufijo);
  console.log('Base: aula_circular_sprint4_ensayo | Usuario BD: aula_app');
  await caso('Sin confirmacion explicita', a, '/api/intercambios', { ...entrada, confirmoPropuesta: false }, 422);
  await caso('Mismo ejemplar dos veces', a, '/api/intercambios',
    { ...entrada, ejemplarSolicitadoId: ofrecido.ejemplarId }, 422);
  await caso('Identidad enviada por cliente', a, '/api/intercambios', { ...entrada, proponenteId: cuentas.A03.id }, 422);
  await caso('Sin CSRF', a, '/api/intercambios', entrada, 403, { csrf: false });
  await caso('Cuenta pendiente', cuentas.P01.sesion, '/api/intercambios', entrada, 403);
  await caso('Docente sin rol alumno', d, '/api/intercambios', entrada, 403);
  await caso('Ofrecer el ejemplar ajeno', tercero, '/api/intercambios', entrada, 403);
  const cesion = await anuncio(a, 'cesion');
  await caso('Modalidad cesion', a, '/api/intercambios', { ...entrada, ejemplarOfrecidoId: cesion.ejemplarId }, 422);
  const borrador = await anuncio(a, 'intercambio', false);
  await caso('Anuncio no publicado', a, '/api/intercambios', { ...entrada, ejemplarOfrecidoId: borrador.ejemplarId }, 409);
  const propuesta = (await caso('Propuesta valida', a, '/api/intercambios', entrada, 201)).cuerpo.datos;
  assert.equal(propuesta.aceptaciones, 1);
  const rutaAceptar = `/api/intercambios/${propuesta.id}/aceptar`;
  const acuerdo = { ejemplarOfrecidoId: propuesta.ejemplarOfrecidoId,
    ejemplarSolicitadoId: propuesta.ejemplarSolicitadoId, versionOfrecida: propuesta.versionOfrecida,
    versionSolicitada: propuesta.versionSolicitada, confirmoAceptacion: true };

  async function estadoSql(id) {
    return (await pool.query(`SELECT o.estado,
      (SELECT count(*)::int FROM aceptacion_intercambio WHERE operacion_id=o.id) AS aceptaciones,
      (SELECT count(*)::int FROM reserva_activa WHERE operacion_id=o.id) AS reservas,
      (SELECT count(*)::int FROM operacion_item WHERE operacion_id=o.id) AS items,
      (SELECT count(*)::int FROM evento_operacion WHERE operacion_id=o.id) AS eventos,
      (SELECT count(*)::int FROM aviso WHERE operacion_id=o.id) AS avisos
      FROM operacion o WHERE id=$1`, [id])).rows[0];
  }
  const inicial = await estadoSql(propuesta.id);
  assert.deepEqual(inicial, { estado: 'propuesta', aceptaciones: 1, reservas: 0, items: 2, eventos: 1, avisos: 1 });
  console.log('SQL tras proponer:', JSON.stringify(inicial));
  await caso('Repetir propuesta', a, '/api/intercambios', entrada, 409);
  await caso('Tercero consulta', tercero, `/api/intercambios/${propuesta.id}`, undefined, 404, { metodo: 'GET' });
  await caso('Tercero acepta', tercero, rutaAceptar, acuerdo, 403);
  await caso('Proponente acepta por receptor', a, rutaAceptar, acuerdo, 403);
  await caso('Pareja manipulada', b, rutaAceptar, { ...acuerdo, ejemplarSolicitadoId: ofrecido.ejemplarId }, 409);
  await caso('Version manipulada', b, rutaAceptar, { ...acuerdo, versionOfrecida: acuerdo.versionOfrecida + 1 }, 409);
  assert.deepEqual(await estadoSql(propuesta.id), inicial, 'Los rechazos no deben cambiar el acuerdo');
  const aceptada = await caso('Receptor acepta', b, rutaAceptar, acuerdo, 200);
  assert.equal(aceptada.cuerpo.datos.aceptaciones, 2);
  const completa = await estadoSql(propuesta.id);
  assert.deepEqual(completa, { estado: 'propuesta', aceptaciones: 2, reservas: 0, items: 2, eventos: 2, avisos: 2 });
  await caso('Aceptacion repetida', b, rutaAceptar, acuerdo, 200);
  assert.deepEqual(await estadoSql(propuesta.id), completa, 'No duplicar aceptaciones, eventos ni avisos');
  console.log('SQL tras ambas aceptaciones:', JSON.stringify(completa));

  // Reutilizamos la edicion real de anuncios; no alteramos su implementacion.
  await caso('Editar material aceptado', a, `/api/anuncios/${ofrecido.id}`,
    { ...ofrecido.datos, titulo: 'Edicion nueva del ensayo', version: ofrecido.version }, 200, { metodo: 'PATCH' });
  const cancelada = await estadoSql(propuesta.id);
  assert.equal(cancelada.estado, 'cancelada');
  assert.equal(cancelada.aceptaciones, 2);
  assert.equal(cancelada.reservas, 0);
  await caso('Aceptar acuerdo cancelado', b, rutaAceptar, acuerdo, 409);
  console.log('SQL tras editar: cancelada; 2 aceptaciones historicas y 0 reservas.');
  const anuncioActual = (await pedir(a, `/api/anuncios/${ofrecido.id}`)).cuerpo.datos;
  assert.equal(anuncioActual.estado_revision, 'pendiente');
  assert.equal((await post(d, `/api/gestion/anuncios/${ofrecido.id}/revision`,
    { version: anuncioActual.version, decision: 'aprobar', motivo: '' })).codigo, 200);
  const nueva = (await caso('Nueva propuesta tras republicar', a, '/api/intercambios', entrada, 201)).cuerpo.datos;
  assert.notEqual(nueva.id, propuesta.id);
  assert.equal(nueva.aceptaciones, 1);
  assert.notEqual(nueva.versionOfrecida, propuesta.versionOfrecida);
  const propietarios = await pool.query('SELECT id, propietario_usuario_id FROM ejemplar WHERE id=ANY($1::integer[]) ORDER BY id',
    [[ofrecido.ejemplarId, solicitado.ejemplarId]]);
  assert.equal(propietarios.rows.find(e => e.id === ofrecido.ejemplarId).propietario_usuario_id, cuentas.A01.id);
  assert.equal(propietarios.rows.find(e => e.id === solicitado.ejemplarId).propietario_usuario_id, cuentas.A02.id);
  assert.equal((await estadoSql(nueva.id)).reservas, 0);
  console.log(`RESULTADO: ${total} casos HTTP superados y estados SQL comprobados.`);
  console.log('No se modificaron propietarios ni se crearon reservas.');
  console.log('Pendiente de Fede: reserva, entrega y cancelacion conjuntas.');
  console.log('Se conservan 5 cuentas y 4 anuncios ficticios por ejecucion.');
} catch (error) {
  console.error('PRUEBA FALLIDA. Codigo:', error.code ?? 'sin codigo');
  if (error.code === 'ERR_ASSERTION') console.error('Comprobacion:', error.message);
  process.exitCode = 1;
} finally {
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  if (almacen) await almacen.close();
  await pool.end();
}
