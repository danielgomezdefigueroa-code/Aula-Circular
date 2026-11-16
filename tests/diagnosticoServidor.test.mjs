
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';

import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';

const ORIGEN = 'http://127.0.0.1:3000';

test('T13 - Diagnostico de consultas de Biblioteca', async t => {
  const esquema = 'aula_t13_' + randomBytes(8).toString('hex');
  const admin = new pg.Pool({ max: 1 });
  let pool, servidor, almacen;
  let esquemaCreado = false;

  try {
    // Preparar base de pruebas independiente.
    await admin.query(`CREATE SCHEMA "${esquema}"`);
    esquemaCreado = true;

    pool = new pg.Pool({
      max: 5,
      options: `-c search_path=${esquema}`
    });

    const carpeta = new URL('../sql/migraciones/', import.meta.url);

    for (const nombre of (await readdir(carpeta))
      .filter(n => n.endsWith('.sql')).sort()) {
      await pool.query(
        await readFile(new URL(nombre, carpeta), 'utf8')
      );
    }

    // Preparar una cuenta ficticia activa.
    const clave = 'Frase segura para T13 2026';
    const hash = await crearHash(clave);

    const usuario = await pool.query(`
      INSERT INTO usuario (
        alias, correo, hash, curso_solicitado_id,
        curso_confirmado_id, estado
      )
      VALUES (
        'Alumno T13', 'alumno-t13@example.invalid',
        $1, 1, 1, 'activo'
      )
      RETURNING id
    `, [hash]);

    await pool.query(
      "INSERT INTO usuario_rol(usuario_id, rol) VALUES ($1, 'alumno')",
      [usuario.rows[0].id]
    );

    // Crear un recurso conocido.
    const recurso = await pool.query(`
      INSERT INTO recurso (
        origen, tipo, titulo, descripcion,
        curso_id, asignatura, edicion
      )
      VALUES (
        'centro', 'fisico', 'Calculadora T13',
        'Recurso ficticio para diagnostico',
        1, 'Matematicas', '2026'
      )
      RETURNING id
    `);

    const recursoId = recurso.rows[0].id;

    // Arrancar la aplicación con HTTP real.
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

    async function pedir(sesion, ruta, metodo = 'GET', cuerpo) {
      const headers = {};

      if (sesion.cookie) headers.Cookie = sesion.cookie;

      if (metodo !== 'GET') {
        headers.Origin = ORIGEN;
        headers['Content-Type'] = 'application/json';
        headers['X-CSRF-Token'] = sesion.token;
      }

      const respuesta = await fetch(base + ruta, {
        method: metodo,
        headers,
        body: cuerpo === undefined
          ? undefined
          : JSON.stringify(cuerpo)
      });

      const cookie = respuesta.headers.getSetCookie()[0];
      if (cookie) sesion.cookie = cookie.split(';')[0];

      const datos = await respuesta.json();
      if (datos.token) sesion.token = datos.token;

      return { estado: respuesta.status, datos };
    }

    // Autenticar la cuenta de prueba.
    const sesion = {};
    await pedir(sesion, '/api/csrf');

    const acceso = await pedir(sesion, '/api/acceso', 'POST', {
      correo: 'alumno-t13@example.invalid',
      clave
    });

    assert.equal(acceso.estado, 200);

    await t.test('1. ID existente devuelve 200', async () => {
      const respuesta = await pedir(
        sesion, `/api/biblioteca/${recursoId}`
      );

      assert.equal(respuesta.estado, 200);
      assert.equal(respuesta.datos.datos.id, recursoId);
      assert.equal(respuesta.datos.datos.titulo, 'Calculadora T13');
    });

    await t.test('2. ID inexistente devuelve 404', async () => {
      const respuesta = await pedir(
        sesion, '/api/biblioteca/999999999'
      );

      assert.equal(respuesta.estado, 404);
      assert.deepEqual(respuesta.datos, {
        error: 'RECURSO_NO_ENCONTRADO'
      });
    });

    await t.test('3. ID mal formado devuelve 400', async () => {
      for (const id of ['abc', '2abc', '-1', '0']) {
        const respuesta = await pedir(
          sesion, `/api/biblioteca/${id}`
        );

        assert.equal(respuesta.estado, 400);
        assert.deepEqual(respuesta.datos, {
          error: 'ID_INVALIDO'
        });
      }
    });

    await t.test('4. Sin sesion devuelve 401', async () => {
      const respuesta = await pedir(
        {}, `/api/biblioteca/${recursoId}`
      );

      assert.equal(respuesta.estado, 401);
      assert.deepEqual(respuesta.datos, {
        error: 'SIN_SESION'
      });
    });

    await t.test('5. El catalogo general sigue funcionando', async () => {
      const respuesta = await pedir(sesion, '/api/biblioteca');

      assert.equal(respuesta.estado, 200);
      assert.ok(
        respuesta.datos.datos.some(r => r.id === recursoId)
      );
    });

  } finally {
    // Liberar servidor y eliminar los datos de prueba.
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
