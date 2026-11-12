import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/aplicacion.mjs';
import { crearHash } from '../src/claves.mjs';

test('Intercambios: propuesta, aceptación, rechazo y estado obsoleto', async t => {
  const esquema = 'aula_test_' + randomBytes(8).toString('hex');
  const admin = new pg.Pool({ max: 1, connectionTimeoutMillis: 3000 });
  let pool, servidor, almacen;
  try {
    await admin.query(`CREATE SCHEMA ${esquema}`);
    pool = new pg.Pool({ max: 5, options: `-c search_path=${esquema}`, connectionTimeoutMillis: 3000 });
    const dir = new URL('../sql/', import.meta.url);
    for (const nombre of (await readdir(dir)).filter(n => n.endsWith('.sql') && n !== '001_laboratorio.sql').sort()) {
      await pool.query(await readFile(new URL(nombre, dir), 'utf8'));
    }

    const clave = 'Frase de ensayo para intercambios 2026';
    const hash = await crearHash(clave);
    const ids = {};
    for (const [nombre, rol] of [['a', 'alumno'], ['b', 'alumno'], ['c', 'alumno'], ['d', 'docente']]) {
      const r = await pool.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,estado)
        VALUES($1,$2,$3,1,'activo') RETURNING id`, ['Cuenta ' + nombre, nombre + '@example.invalid', hash]);
      ids[nombre] = r.rows[0].id;
      await pool.query('INSERT INTO usuario_rol VALUES($1,$2)', [ids[nombre], rol]);
    }

    const resultado = await crearAplicacion(pool, {
      origen: 'http://127.0.0.1:3000',
      secreto: randomBytes(32).toString('hex'),
      esquema,
      limitar: false
    });
    almacen = resultado.almacen;
    servidor = resultado.app.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const base = 'http://127.0.0.1:' + servidor.address().port;

    async function pedir(s, ruta, method = 'GET', body, conCsrf = true) {
      const headers = { Cookie: s.cookie ?? '' };
      if (method !== 'GET') {
        Object.assign(headers, {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:3000',
          ...(conCsrf ? { 'X-CSRF-Token': s.token } : {})
        });
      }
      const r = await fetch(base + ruta, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (r.headers.getSetCookie().length) s.cookie = r.headers.getSetCookie()[0].split(';')[0];
      const b = await r.json();
      if (b.token) s.token = b.token;
      return { status: r.status, ...b };
    }

    const sesiones = {};
    for (const nombre of Object.keys(ids)) {
      const s = {};
      await pedir(s, '/api/csrf');
      assert.equal((await pedir(s, '/api/acceso', 'POST', { correo: nombre + '@example.invalid', clave })).status, 200);
      sesiones[nombre] = s;
    }
    const { a, b, c, d } = sesiones;
    const post = (s, url, body = {}) => pedir(s, url, 'POST', body);

    async function crearAnuncio(s, titulo) {
      const x = await post(s, '/api/anuncios', {
        titulo,
        descripcion: 'Datos ficticios',
        cursoId: 1,
        asignatura: 'Programación',
        edicion: '2026',
        isbn: '',
        conservacion: 'Buen estado',
        modalidad: 'intercambio'
      });
      assert.equal(x.status, 201);
      const enviado = await post(s, `/api/anuncios/${x.datos.id}/enviar`, { version: x.datos.version });
      assert.equal(enviado.status, 200);
      assert.equal((await post(d, `/api/gestion/anuncios/${x.datos.id}/revision`, {
        version: enviado.datos.version, decision: 'aprobar', motivo: ''
      })).status, 200);
      const detalle = await pedir(s, `/api/anuncios/${x.datos.id}`);
      assert.equal(detalle.status, 200);
      return { id: x.datos.id, ejemplar: detalle.datos.ejemplar_id, version: detalle.datos.version };
    }

    const datos = {};
    await t.test('Propuesta: sesión, alias, solo participantes y sin reserva', async () => {
      datos.A1 = await crearAnuncio(a, 'Intercambio A1');
      datos.B1 = await crearAnuncio(b, 'Intercambio B1');
      datos.C1 = await crearAnuncio(c, 'Intercambio C1');

      const propuesta = await post(a, '/api/intercambios', {
        ejemplarOfrecidoId: datos.A1.ejemplar,
        ejemplarSolicitadoId: datos.B1.ejemplar,
        confirmoPropuesta: true
      });
      assert.equal(propuesta.status, 201);
      datos.id = propuesta.datos.id;
      assert.equal(propuesta.datos.estado, 'propuesta');
      assert.equal(propuesta.datos.aceptaciones, 1);
      assert.equal(propuesta.datos.tituloOfrecido, 'Intercambio A1');
      assert.equal(propuesta.datos.tituloSolicitado, 'Intercambio B1');
      assert.equal(propuesta.datos.proponenteAlias, 'Cuenta a');
      assert.equal(propuesta.datos.receptorAlias, 'Cuenta b');
      assert.ok(!JSON.stringify(propuesta.datos).includes('@example.invalid'));

      const listaA = await pedir(a, '/api/intercambios');
      const listaB = await pedir(b, '/api/intercambios');
      const listaC = await pedir(c, '/api/intercambios');
      assert.ok(listaA.datos.some(x => x.id === datos.id));
      assert.ok(listaB.datos.some(x => x.id === datos.id));
      assert.ok(!listaC.datos.some(x => x.id === datos.id));
      assert.equal((await pedir(c, `/api/intercambios/${datos.id}`)).status, 404);
      assert.equal((await post(c, `/api/intercambios/${datos.id}/cancelar`, {})).status, 403);

      assert.equal((await pool.query('SELECT count(*)::int AS n FROM reserva_activa')).rows[0].n, 0);
      const repetida = await post(a, '/api/intercambios', {
        ejemplarOfrecidoId: datos.A1.ejemplar,
        ejemplarSolicitadoId: datos.B1.ejemplar,
        confirmoPropuesta: true
      });
      assert.equal(repetida.status, 409);
      assert.equal(repetida.error, 'PROPUESTA_YA_EXISTENTE');
      assert.equal((await post(a, `/api/intercambios/${datos.id}/aceptar`, {
        ejemplarOfrecidoId: datos.A1.ejemplar,
        ejemplarSolicitadoId: datos.B1.ejemplar,
        versionOfrecida: datos.A1.version,
        versionSolicitada: datos.B1.version,
        confirmoAceptacion: true
      })).status, 403);
    });

    await t.test('Aceptación exacta, idempotencia y acuerdo desactualizado', async () => {
      const entrada = {
        ejemplarOfrecidoId: datos.A1.ejemplar,
        ejemplarSolicitadoId: datos.B1.ejemplar,
        versionOfrecida: datos.A1.version,
        versionSolicitada: datos.B1.version,
        confirmoAceptacion: true
      };
      const aceptada = await post(b, `/api/intercambios/${datos.id}/aceptar`, entrada);
      assert.equal(aceptada.status, 200);
      assert.equal(aceptada.datos.aceptaciones, 2);
      assert.equal(aceptada.datos.estado, 'propuesta');
      assert.equal((await post(b, `/api/intercambios/${datos.id}/aceptar`, entrada)).status, 200);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM reserva_activa')).rows[0].n, 0);

      await pool.query('UPDATE anuncio SET version=version+1 WHERE id=$1', [datos.A1.id]);
      const obsoleta = await post(b, `/api/intercambios/${datos.id}/aceptar`, entrada);
      assert.equal(obsoleta.status, 409);
      assert.equal(obsoleta.error, 'ACUERDO_DESACTUALIZADO');
    });

    await t.test('Cancelación del proponente y rechazo del receptor', async () => {
      const A2 = await crearAnuncio(a, 'Intercambio A2');
      const B2 = await crearAnuncio(b, 'Intercambio B2');
      const entrada = {
        ejemplarOfrecidoId: A2.ejemplar,
        ejemplarSolicitadoId: B2.ejemplar,
        confirmoPropuesta: true
      };

      const primera = await post(a, '/api/intercambios', entrada);
      assert.equal(primera.status, 201);
      const cancelada = await post(a, `/api/intercambios/${primera.datos.id}/cancelar`, {});
      assert.equal(cancelada.status, 200);
      assert.equal(cancelada.datos.estado, 'cancelada');
      assert.equal((await pool.query(
        "SELECT count(*)::int AS n FROM evento_operacion WHERE operacion_id=$1 AND accion='cancelar_intercambio'",
        [primera.datos.id])).rows[0].n, 1);

      const segunda = await post(a, '/api/intercambios', entrada);
      assert.equal(segunda.status, 201);
      const rechazada = await post(b, `/api/intercambios/${segunda.datos.id}/cancelar`, {});
      assert.equal(rechazada.status, 200);
      assert.equal(rechazada.datos.estado, 'cancelada');
      assert.equal((await pool.query(
        "SELECT count(*)::int AS n FROM evento_operacion WHERE operacion_id=$1 AND accion='rechazar_intercambio'",
        [segunda.datos.id])).rows[0].n, 1);
      assert.equal((await pool.query(
        'SELECT count(*)::int AS n FROM aviso WHERE operacion_id=$1 AND destinatario_id=$2',
        [segunda.datos.id, ids.a])).rows[0].n, 1);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM reserva_activa')).rows[0].n, 0);
    });
  } finally {
    if (servidor) await new Promise((ok, fallo) => servidor.close(e => e ? fallo(e) : ok()));
    if (almacen) await almacen.close();
    if (pool) await pool.end();
    if (/^aula_test_[a-f0-9]{16}$/.test(esquema)) await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await admin.end();
  }
});
