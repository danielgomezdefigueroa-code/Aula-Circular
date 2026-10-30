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
  // Fotografía de todos los efectos relevantes de una operación.
  async function foto(id) {
    const operacion = (await pool.query(
      'SELECT * FROM operacion WHERE id=$1', [id]
    )).rows[0];

    const items = (await pool.query(
      `SELECT * FROM operacion_item WHERE operacion_id=$1
       ORDER BY ejemplar_id`, [id]
    )).rows;

    const ids = items.map(i => i.ejemplar_id);

    const ejemplares = (await pool.query(
      `SELECT * FROM ejemplar WHERE id=ANY($1::integer[])
       ORDER BY id`, [ids]
    )).rows;

    const anuncios = (await pool.query(
      `SELECT * FROM anuncio WHERE ejemplar_id=ANY($1::integer[])
       ORDER BY ejemplar_id`, [ids]
    )).rows;

    const reservas = (await pool.query(
      `SELECT * FROM reserva_activa WHERE operacion_id=$1
       ORDER BY ejemplar_id`, [id]
    )).rows;

    const eventos = (await pool.query(
      `SELECT * FROM evento_operacion WHERE operacion_id=$1
       ORDER BY id`, [id]
    )).rows;

    const eventosAnuncio = (await pool.query(
      `SELECT * FROM evento_anuncio
       WHERE anuncio_id=ANY($1::integer[]) ORDER BY id`,
      [anuncios.map(x => x.id)]
    )).rows;

    const avisos = (await pool.query(
      'SELECT * FROM aviso WHERE operacion_id=$1 ORDER BY id', [id]
    )).rows;

    const aceptaciones = (await pool.query(
      `SELECT * FROM aceptacion_intercambio
       WHERE operacion_id=$1 ORDER BY usuario_id`, [id]
    )).rows;

    return {
      operacion, items, ejemplares, anuncios,
      reservas, eventos, eventosAnuncio, avisos, aceptaciones
    };
  }

  function mostrar(nombre, f) {
    console.log('\nSQL:', nombre);
    console.log(JSON.stringify({
      operacion: f.operacion.id,
      estado: f.operacion.estado,
      entregada: f.operacion.entregada_en !== null,
      cerrada: f.operacion.cerrada_en !== null,
      reservas: f.reservas.length,
      aceptaciones: f.aceptaciones.length,
      items: f.items,
      ejemplares: f.ejemplares.map(e => ({
        id: e.id,
        estado: e.estado_servicio,
        propietario: e.propietario_usuario_id
      })),
      anuncios: f.anuncios.map(a => ({
        id: a.id,
        estado: a.estado_revision
      })),
      eventosEntrega: f.eventos.filter(e => e.accion === 'entregar').length,
      eventosCancelacion: f.eventos.filter(e => e.accion === 'cancelar').length,
      avisos: f.avisos.length
    }, null, 2));
  }

  async function prepararPareja() {
    const x = await anuncio(a), y = await anuncio(b);
    const acuerdo = await prepararAcuerdo(a, b, x, y);
    await acuerdo.aceptar();
    return acuerdo;
  }

  console.log('\nENTREGA Y CANCELACION CONJUNTAS');

  const acuerdo = await prepararPareja();
  const entrega = `/api/gestion/operaciones/${acuerdo.id}/entregar`;
  const cancelar = `/api/gestion/operaciones/${acuerdo.id}/cancelar`;

  // Dos aceptaciones no sustituyen las reservas docentes.
  const sinReserva = await foto(acuerdo.id);
  await comprobar('Entrega sin reserva', d, entrega, 409);
  assert.deepEqual(await foto(acuerdo.id), sinReserva);

  await comprobar(
    'Docente reserva la pareja', d,
    `/api/gestion/intercambios/${acuerdo.id}/reservar`, 200
  );

  const antes = await foto(acuerdo.id);
  assert.equal(antes.reservas.length, 2);

  await comprobar('Tercero intenta entregar', tercero, entrega, 403);
  assert.deepEqual(await foto(acuerdo.id), antes);

  await comprobar('Entrega sin CSRF', d, entrega, 403, false);
  assert.deepEqual(await foto(acuerdo.id), antes);

  await comprobar('Entrega conjunta docente', d, entrega, 200);
  const entregado = await foto(acuerdo.id);

  assert.equal(entregado.operacion.estado, 'completada');
  assert.ok(entregado.operacion.entregada_en);
  assert.ok(entregado.operacion.cerrada_en);
  assert.equal(entregado.reservas.length, 0);
  assert.ok(entregado.ejemplares.every(e => e.estado_servicio === 'retirado'));
  assert.ok(entregado.anuncios.every(a => a.estado_revision === 'retirado'));
  assert.deepEqual(entregado.items, antes.items);
  assert.deepEqual(entregado.aceptaciones, antes.aceptaciones);

  assert.deepEqual(
    entregado.ejemplares.map(e => e.propietario_usuario_id),
    antes.ejemplares.map(e => e.propietario_usuario_id)
  );

  assert.equal(entregado.eventos.length, antes.eventos.length + 1);
  assert.equal(
    entregado.eventos.filter(e => e.accion === 'entregar').length, 1
  );
  assert.equal(entregado.eventosAnuncio.length, antes.eventosAnuncio.length + 2);
  assert.equal(entregado.avisos.length, antes.avisos.length + 2);

  mostrar('tras entrega conjunta', entregado);

  await comprobar('Entrega repetida', d, entrega, 200);
  assert.deepEqual(await foto(acuerdo.id), entregado);
  console.log('SQL: repeticion sin nuevas escrituras.');

  const noCancelar = await post(d, cancelar, {
    motivo: 'Intento de cancelar una operacion completada'
  });
  console.log('\nCancelar intercambio completado: POST', cancelar);
  console.log('Esperado: 409 | Observado:', noCancelar.codigo);
  console.log(JSON.stringify(noCancelar.cuerpo));
  assert.equal(noCancelar.codigo, 409);
  assert.deepEqual(await foto(acuerdo.id), entregado);

  // Otro intercambio independiente para probar cancelación previa.
  const segundo = await prepararPareja();

  await comprobar(
    'Reserva para cancelacion', d,
    `/api/gestion/intercambios/${segundo.id}/reservar`, 200
  );

  const antesCancelar = await foto(segundo.id);
  assert.equal(antesCancelar.reservas.length, 2);
  const rutaCancelar =
    `/api/gestion/operaciones/${segundo.id}/cancelar`;

  const prohibida = await post(tercero, rutaCancelar, {
    motivo: 'Intento de un alumno'
  });
  assert.equal(prohibida.codigo, 403);
  assert.deepEqual(await foto(segundo.id), antesCancelar);
  console.log('\nCancelacion por tercero: esperado 403 | observado 403.');

  const cancelacion = await post(d, rutaCancelar, {
    motivo: 'Los participantes renuncian antes de entregar'
  });
  console.log('\nCancelacion docente: POST', rutaCancelar);
  console.log('Esperado: 200 | Observado:', cancelacion.codigo);
  console.log(JSON.stringify(cancelacion.cuerpo));
  assert.equal(cancelacion.codigo, 200);

  const cancelado = await foto(segundo.id);
  assert.equal(cancelado.operacion.estado, 'cancelada');
  assert.equal(cancelado.operacion.entregada_en, null);
  assert.ok(cancelado.operacion.cerrada_en);
  assert.equal(cancelado.reservas.length, 0);
  assert.deepEqual(cancelado.ejemplares, antesCancelar.ejemplares);
  assert.deepEqual(cancelado.anuncios, antesCancelar.anuncios);
  assert.deepEqual(cancelado.items, antesCancelar.items);
  assert.deepEqual(cancelado.aceptaciones, antesCancelar.aceptaciones);
  assert.equal(cancelado.eventos.length, antesCancelar.eventos.length + 1);
  assert.equal(cancelado.avisos.length, antesCancelar.avisos.length + 2);
  assert.equal(
    cancelado.eventos.filter(e => e.accion === 'cancelar').length, 1
  );

  mostrar('tras cancelacion: ambos ejemplares liberados', cancelado);

  const repetida = await post(d, rutaCancelar, {
    motivo: 'Repeticion de la cancelacion'
  });
  assert.equal(repetida.codigo, 409);
  assert.deepEqual(await foto(segundo.id), cancelado);
  console.log('\nCancelacion repetida: esperado 409 | observado 409.');

  await comprobar(
    'Entrega despues de cancelar', d,
    `/api/gestion/operaciones/${segundo.id}/entregar`, 409
  );
  assert.deepEqual(await foto(segundo.id), cancelado);

  console.log('\nRESULTADO: entrega y cancelacion conjuntas comprobadas.');
  console.log('Historial conservado; sin duplicados ni cambios de propietarios.');
  console.log('Los datos ficticios del ensayo permanecen en PostgreSQL.');
  } catch (error) {
  console.error('PRUEBA FALLIDA. Codigo:', error.code ?? 'sin codigo');
  if (error.code === 'ERR_ASSERTION') console.error('Comprobacion:', error.message);
  process.exitCode = 1;
} finally {
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  if (almacen) await almacen.close();
  await pool.end();
}
