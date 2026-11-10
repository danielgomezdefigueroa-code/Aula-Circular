import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';

import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';

const ORIGEN = 'http://127.0.0.1:3000';

test('T11 - permisos de Biblioteca y disponibilidad por ejemplar', async t => {
  const esquema = 'aula_t11_' + randomBytes(8).toString('hex');
  const admin = new pg.Pool({ max: 1 });
  let pool;
  let servidor;
  let almacen;
  let esquemaCreado = false;

  try {
    await admin.query(`CREATE SCHEMA "${esquema}"`);
    esquemaCreado = true;
    pool = new pg.Pool({
      max: 5,
      options: `-c search_path=${esquema}`
    });

    const dir = new URL('../sql/migraciones/', import.meta.url);
    for (const nombre of (await readdir(dir))
      .filter(n => n.endsWith('.sql')).sort()) {
      await pool.query(await readFile(new URL(nombre, dir), 'utf8'));
    }

    const clave = 'Frase segura para prestamos T11 2026';
    const hash = await crearHash(clave);
    for (const [alias, rol, curso] of [
      ['alumno', 'alumno', 1],
      ['otro', 'alumno', 2],
      ['docente', 'docente', 1]
    ]) {
      const cuenta = await pool.query(`
        INSERT INTO usuario (
          alias, correo, hash, curso_solicitado_id,
          curso_confirmado_id, estado
        )
        VALUES ($1, $2, $3, $4, $4, 'activo')
        RETURNING id
      `, [alias, `${alias}@example.invalid`, hash, curso]);

      await pool.query(
        'INSERT INTO usuario_rol(usuario_id, rol) VALUES ($1, $2)',
        [cuenta.rows[0].id, rol]
      );
    }

    const recurso = await pool.query(`
      INSERT INTO recurso (
        origen, tipo, titulo, descripcion,
        curso_id, asignatura, edicion
      )
      VALUES (
        'centro', 'fisico', 'Calculadora T11 de ensayo',
        'Dos ejemplares independientes', 1, 'Matematicas', 'T11'
      )
      RETURNING id
    `);
    const recursoId = recurso.rows[0].id;
    const ejemplares = [];
    for (const codigo of ['T11-CAL-1', 'T11-CAL-2']) {
      const e = await pool.query(`
        INSERT INTO ejemplar (
          recurso_id, codigo, conservacion, estado_servicio
        )
        VALUES ($1, $2, 'Buen estado', 'habilitado')
        RETURNING id
      `, [recursoId, codigo]);
      ejemplares.push(e.rows[0].id);
    }

    // Ficha digital ficticia, sin ejemplares físicos.
    const digital = await pool.query(`
      INSERT INTO recurso (
        origen, tipo, titulo, descripcion, curso_id,
        asignatura, edicion
      )
      VALUES (
        'centro', 'digital', 'Manual digital T11 de ensayo',
        'Sin unidades prestables', 1, 'Bases de datos', 'T11'
      )
      RETURNING id
    `);
    const digitalId = digital.rows[0].id;

    const aplicacion = await crearAplicacion(pool, {
      origen: ORIGEN,
      secreto: randomBytes(32).toString('hex'),
      esquema,
      limitar: false
    });
    almacen = aplicacion.almacen;
    servidor = aplicacion.app.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const base = `http://127.0.0.1:${servidor.address().port}`;

    async function pedir(sesion, ruta, method = 'GET', cuerpo) {
      const headers = { Cookie: sesion.cookie ?? '' };
      if (method !== 'GET') {
        headers.Origin = ORIGEN;
        headers['X-CSRF-Token'] = sesion.token ?? '';
        headers['Content-Type'] = 'application/json';
      }
      const respuesta = await fetch(base + ruta, {
        method,
        headers,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
      });
      const cookie = respuesta.headers.getSetCookie()[0];
      if (cookie) sesion.cookie = cookie.split(';')[0];
      const datos = await respuesta.json();
      if (datos.token) sesion.token = datos.token;
      return { status: respuesta.status, datos };
    }

    async function acceder(alias) {
      const sesion = {};
      await pedir(sesion, '/api/csrf');
      const respuesta = await pedir(sesion, '/api/acceso', 'POST', {
        correo: `${alias}@example.invalid`, clave
      });
      assert.equal(respuesta.status, 200, JSON.stringify(respuesta.datos));
      return sesion;
    }

    const alumno = await acceder('alumno');
    const otro = await acceder('otro');
    const docente = await acceder('docente');

    const consultarEjemplares = () => pool.query(`
      SELECT e.id, e.codigo, e.estado_servicio,
             EXISTS (
               SELECT 1
               FROM reserva_activa ra
               WHERE ra.ejemplar_id = e.id
             ) AS reservado
      FROM ejemplar e
      WHERE e.recurso_id = $1
      ORDER BY e.codigo
    `, [recursoId]);

    await t.test('1. Biblioteca consultable por alumno de otro curso', async () => {
      const respuesta = await pedir(otro, '/api/biblioteca');
      assert.equal(respuesta.status, 200);
      const ficha = respuesta.datos.datos.find(r => r.id === recursoId);
      assert.ok(ficha);
      assert.equal(ficha.tipo, 'fisico');
      assert.equal(ficha.estado, 'disponible');
    });

    await t.test('2. Dos ejemplares disponibles antes de reservar', async () => {
      const registros = (await consultarEjemplares()).rows;
      assert.equal(registros.length, 2);
      assert.ok(registros.every(e =>
        e.estado_servicio === 'habilitado' && !e.reservado
      ));
    });

    await t.test('3. Manual digital no tiene unidades prestables', async () => {
      const unidades = await pool.query(
        'SELECT id FROM ejemplar WHERE recurso_id=$1',
        [digitalId]
      );
      assert.equal(unidades.rowCount, 0);
      const respuesta = await pedir(alumno, '/api/biblioteca');
      const ficha = respuesta.datos.datos.find(r => r.id === digitalId);
      assert.ok(ficha);
      assert.equal(ficha.tipo, 'digital');
      assert.notEqual(ficha.modalidad, 'prestamo');
    });

    let solicitudId;
    await t.test('4. Solicitar un ejemplar no equivale a reservarlo', async () => {
      const respuesta = await pedir(alumno, '/api/prestamos/solicitudes',
        'POST', { ejemplarId: ejemplares[0] });
      assert.equal(respuesta.status, 201, JSON.stringify(respuesta.datos));
      solicitudId = respuesta.datos.datos.id;
      assert.equal(
        (await pool.query(
          'SELECT COUNT(*)::int AS total FROM reserva_activa WHERE ejemplar_id=$1',
          [ejemplares[0]]
        )).rows[0].total, 0
      );
    });

    await t.test('5. Docente adjudica y reserva una sola unidad', async () => {
      const vencimiento = new Date(Date.now() + 7 * 86400000).toISOString();
      const respuesta = await pedir(
        docente,
        `/api/gestion/prestamos/solicitudes/${solicitudId}/adjudicar`,
        'POST',
        { motivo: 'Reserva de prueba T11', vencimiento }
      );
      assert.equal(respuesta.status, 201, JSON.stringify(respuesta.datos));

      const registros = (await consultarEjemplares()).rows;
      assert.equal(registros.length, 2);
      assert.equal(registros.filter(e => e.reservado).length, 1);
      assert.equal(
        registros.find(e => e.id === ejemplares[0]).reservado, true
      );
      assert.equal(
        registros.find(e => e.id === ejemplares[1]).reservado, false
      );

      const catalogo = await pedir(otro, '/api/biblioteca');
      assert.equal(catalogo.status, 200);
      const ficha = catalogo.datos.datos.find(r => r.id === recursoId);
      assert.equal(ficha.estado, 'disponible');
    });

    await t.test('6. La unidad reservada no admite otra solicitud', async () => {
      const ocupado = await pedir(
        otro, '/api/prestamos/solicitudes',
        'POST', { ejemplarId: ejemplares[0] }
      );
      assert.equal(ocupado.status, 409);
      const libre = await pedir(
        otro, '/api/prestamos/solicitudes',
        'POST', { ejemplarId: ejemplares[1] }
      );
      assert.equal(libre.status, 201, JSON.stringify(libre.datos));
    });

  } finally {
    if (servidor) {
      await new Promise((resolve, reject) => {
        servidor.close(error => error ? reject(error) : resolve());
        servidor.closeAllConnections();
      });
    }
    almacen?.stopExpiringSessions?.();
    if (pool) await pool.end();
    if (esquemaCreado) {
      await admin.query(`DROP SCHEMA "${esquema}" CASCADE`);
    }
    await admin.end();
  }
});

