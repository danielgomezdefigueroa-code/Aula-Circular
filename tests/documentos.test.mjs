
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';

import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';
import { eliminarArchivoPrivado } from '../src/documentos/archivos.mjs';

test('T6: documentos protegidos con PostgreSQL y HTTP', async t => {
  const esquema = 'aula_test_' + randomBytes(8).toString('hex');
  const origen = 'http://127.0.0.1:3000';

  const admin = new pg.Pool({ max: 1 });
  let pool;
  let servidor;
  let almacen;
  let nombreInterno;

  try {
    // Esquema temporal aislado.
    await admin.query(`CREATE SCHEMA "${esquema}"`);

    pool = new pg.Pool({
      max: 5,
      options: `-c search_path=${esquema}`
    });

    const carpeta = new URL(
      '../sql/migraciones/',
      import.meta.url
    );

    const migraciones = (await readdir(carpeta))
      .filter(nombre => nombre.endsWith('.sql'))
      .sort();

    for (const nombre of migraciones) {
      const sql = await readFile(
        new URL(nombre, carpeta),
        'utf8'
      );
      await pool.query(sql);
    }

    // Cuentas de ensayo.
    const clave = 'Frase segura para documentos 2026';
    const hash = await crearHash(clave);

    const cuentas = [
      ['docente', 'docente', 1],
      ['alumno', 'alumno', 1],
      ['otro', 'alumno', 2]
    ];

    for (const [nombre, rol, curso] of cuentas) {
      const resultado = await pool.query(`
        INSERT INTO usuario (
          alias,
          correo,
          hash,
          curso_solicitado_id,
          curso_confirmado_id,
          estado
        )
        VALUES ($1, $2, $3, $4, $4, 'activo')
        RETURNING id
      `, [
        nombre,
        `${nombre}@example.invalid`,
        hash,
        curso
      ]);

      await pool.query(
        'INSERT INTO usuario_rol VALUES ($1, $2)',
        [resultado.rows[0].id, rol]
      );
    }

    const aplicacion = await crearAplicacion(pool, {
      origen,
      secreto: randomBytes(32).toString('hex'),
      esquema,
      limitar: false
    });

    almacen = aplicacion.almacen;

    servidor = aplicacion.app.listen(
      0,
      '127.0.0.1'
    );

    await once(servidor, 'listening');

    const base =
      'http://127.0.0.1:' + servidor.address().port;

    // Peticiones que conservan la cookie de sesión.
    async function pedir(sesion, ruta, opciones = {}) {
      const headers = {
        Cookie: sesion.cookie ?? '',
        ...opciones.headers
      };

      const respuesta = await fetch(base + ruta, {
        ...opciones,
        headers
      });

      const cookie = respuesta.headers.getSetCookie()[0];

      if (cookie) {
        sesion.cookie = cookie.split(';')[0];
      }

      const tipo = respuesta.headers.get('content-type');

      const datos = tipo?.includes('application/json')
        ? await respuesta.json()
        : await respuesta.arrayBuffer();

      if (datos?.token) {
        sesion.token = datos.token;
      }

      return {
        status: respuesta.status,
        datos,
        headers: respuesta.headers
      };
    }

    async function acceder(nombre) {
      const sesion = {};

      await pedir(sesion, '/api/csrf');

      const respuesta = await pedir(
        sesion,
        '/api/acceso',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: origen,
            'X-CSRF-Token': sesion.token
          },
          body: JSON.stringify({
            correo: `${nombre}@example.invalid`,
            clave
          })
        }
      );

      assert.equal(respuesta.status, 200);
      return sesion;
    }

    const docente = await acceder('docente');
    const alumno = await acceder('alumno');
    const otro = await acceder('otro');

    // Generar un PDF auténtico para el ensayo.
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 200]);
    const pdfValido = Buffer.from(await pdf.save());

    function formulario(contenido, nombre = 'prueba.pdf') {
      const datos = new FormData();

      datos.set('titulo', 'Documento T6 de ensayo');
      datos.set('cursoId', '1');
      datos.set('version', 'v1');

      datos.set(
        'archivo',
        new Blob([contenido], {
          type: 'application/pdf'
        }),
        nombre
      );

      return datos;
    }

    async function subir(sesion, contenido, nombre) {
      return pedir(sesion, '/api/documentos', {
        method: 'POST',
        headers: {
          Origin: origen,
          'X-CSRF-Token': sesion.token ?? ''
        },
        body: formulario(contenido, nombre)
      });
    }

    
await t.test('Sin sesión y sin CSRF se rechaza', async () => {
    const respuesta = await subir(
      {},
      pdfValido,
      'prueba.pdf'
    );
  
    assert.equal(respuesta.status, 403);
  });
  
  await t.test('Con CSRF válido, pero sin sesión, se rechaza', async () => {
    const sesion = {};
  
    // Obtener un token CSRF, sin iniciar sesión.
    await pedir(sesion, '/api/csrf');
  
    const respuesta = await subir(
      sesion,
      pdfValido,
      'prueba.pdf'
    );
  
    assert.equal(respuesta.status, 401);
  });
  

    await t.test('Alumno no puede subir', async () => {
      const respuesta = await subir(
        alumno,
        pdfValido,
        'prueba.pdf'
      );

      assert.equal(respuesta.status, 403);
    });

    await t.test('Ejecutable renombrado se rechaza', async () => {
      const falso = Buffer.from(
        'MZ este contenido no es un PDF'
      );

      const respuesta = await subir(
        docente,
        falso,
        'ejecutable.pdf'
      );

      assert.equal(respuesta.status, 415);
    });

    let documentoId;
    let archivoId;

    await t.test('Docente sube PDF válido', async () => {
      const respuesta = await subir(
        docente,
        pdfValido,
        'prueba.pdf'
      );

      assert.equal(
        respuesta.status,
        201,
        JSON.stringify(respuesta.datos)
      );

      documentoId = respuesta.datos.datos.documentoId;
      archivoId = respuesta.datos.datos.archivoId;

      const registro = await pool.query(`
        SELECT
          a.ruta,
          a.sha256,
          a.almacenamiento_privado,
          d.estado_editorial
        FROM archivo a
        JOIN documento_version v
          ON v.archivo_id = a.id
        JOIN documento d
          ON d.id = v.documento_id
        WHERE a.id = $1
      `, [archivoId]);

      assert.equal(registro.rowCount, 1);
      assert.equal(
        registro.rows[0].estado_editorial,
        'borrador'
      );
      assert.equal(
        registro.rows[0].almacenamiento_privado,
        true
      );

      assert.equal(
        registro.rows[0].sha256,
        createHash('sha256')
          .update(pdfValido)
          .digest('hex')
      );

      nombreInterno = registro.rows[0].ruta;
    });

    const descargar = (sesion) =>
      pedir(
        sesion,
        `/api/documentos/${archivoId}/descargar`
      );

    await t.test('Borrador no descargable', async () => {
      const respuesta = await descargar(alumno);
      assert.equal(respuesta.status, 404);
    });

    await t.test('Alumno no puede publicar', async () => {
      const respuesta = await pedir(
        alumno,
        `/api/documentos/${documentoId}/publicar`,
        {
          method: 'PATCH',
          headers: {
            Origin: origen,
            'X-CSRF-Token': alumno.token
          }
        }
      );

      assert.equal(respuesta.status, 403);
    });

    await t.test('Docente publica documento', async () => {
      const respuesta = await pedir(
        docente,
        `/api/documentos/${documentoId}/publicar`,
        {
          method: 'PATCH',
          headers: {
            Origin: origen,
            'X-CSRF-Token': docente.token
          }
        }
      );

      assert.equal(
        respuesta.status,
        200,
        JSON.stringify(respuesta.datos)
      );
    });

    await t.test('Alumno autorizado descarga PDF', async () => {
      const respuesta = await descargar(alumno);

      assert.equal(respuesta.status, 200);

      assert.deepEqual(
        Buffer.from(respuesta.datos),
        pdfValido
      );
    });

    await t.test('Otro curso no puede descargar', async () => {
      const respuesta = await descargar(otro);
      assert.equal(respuesta.status, 403);
    });

    await t.test('Sin sesión no puede descargar', async () => {
      const respuesta = await descargar({});
      assert.equal(respuesta.status, 401);
    });

    await t.test('Hash incorrecto bloquea descarga', async () => {
      await pool.query(`
        UPDATE archivo
        SET sha256 = $2
        WHERE id = $1
      `, [
        archivoId,
        '0'.repeat(64)
      ]);

      const respuesta = await descargar(alumno);

      assert.equal(respuesta.status, 404);
    });

  } finally {
    if (servidor) {
      await new Promise((resolve, reject) => {
        servidor.close(error =>
          error ? reject(error) : resolve()
        );
        servidor.closeAllConnections();
      });
    }

    almacen?.stopExpiringSessions?.();

    // Retirar el PDF generado por este ensayo.
    if (nombreInterno) {
      await eliminarArchivoPrivado(nombreInterno);
    }

    if (pool) {
      await pool.end();
    }

    await admin.query(
      `DROP SCHEMA IF EXISTS "${esquema}" CASCADE`
    );

    await admin.end();
  }
});
