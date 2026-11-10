import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';
import { eliminarArchivoPrivado } from '../src/documentos/archivos.mjs';

const ORIGEN = 'http://127.0.0.1:3000';
const CARPETA_PRIVADA = fileURLToPath(
  new URL('../almacen_privado/documentos/', import.meta.url)
);

async function archivosPrivados() {
  try {
    return (await readdir(CARPETA_PRIVADA)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function pdfValido(ancho) {
  const pdf = await PDFDocument.create();
  pdf.addPage([ancho, 200]);
  return Buffer.from(await pdf.save());
}

test('T11 - versiones, cargas HTTP y limpieza', async t => {
  const esquema = 'aula_t11_' + randomBytes(8).toString('hex');
  const admin = new pg.Pool({ max: 1 });
  let pool;
  let servidor;
  let almacen;
  let esquemaCreado = false;

  try {
    // Las pruebas no modifican el esquema public.
    await admin.query(`CREATE SCHEMA "${esquema}"`);
    esquemaCreado = true;

    pool = new pg.Pool({
      max: 5,
      options: `-c search_path=${esquema}`
    });

    const carpetaMigraciones = new URL('../sql/migraciones/', import.meta.url);
    const migraciones = (await readdir(carpetaMigraciones))
      .filter(nombre => nombre.endsWith('.sql'))
      .sort();

    for (const nombre of migraciones) {
      const contenido = await readFile(
        new URL(nombre, carpetaMigraciones), 'utf8'
      );
      await pool.query(contenido);
    }

    const clave = 'Frase segura para pruebas T11 2026';
    const hash = await crearHash(clave);

    for (const [alias, rol, curso] of [
      ['docente', 'docente', 1],
      ['alumno', 'alumno', 1],
      ['otro', 'alumno', 2]
    ]) {
      const creado = await pool.query(`
        INSERT INTO usuario (
          alias, correo, hash,
          curso_solicitado_id, curso_confirmado_id, estado
        )
        VALUES ($1, $2, $3, $4, $4, 'activo')
        RETURNING id
      `, [alias, `${alias}@example.invalid`, hash, curso]);

      await pool.query(
        'INSERT INTO usuario_rol(usuario_id, rol) VALUES ($1, $2)',
        [creado.rows[0].id, rol]
      );
    }

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

    async function pedir(sesion, ruta, opciones = {}) {
      const respuesta = await fetch(base + ruta, {
        ...opciones,
        headers: {
          Cookie: sesion.cookie ?? '',
          ...opciones.headers
        }
      });
      const cookie = respuesta.headers.getSetCookie()[0];
      if (cookie) sesion.cookie = cookie.split(';')[0];

      const tipo = respuesta.headers.get('content-type');
      const datos = tipo?.includes('application/json')
        ? await respuesta.json()
        : Buffer.from(await respuesta.arrayBuffer());
      if (datos?.token) sesion.token = datos.token;

      return { status: respuesta.status, datos };
    }

    async function acceder(alias) {
      const sesion = {};
      await pedir(sesion, '/api/csrf');
      const r = await pedir(sesion, '/api/acceso', {
        method: 'POST',
        headers: {
          Origin: ORIGEN,
          'Content-Type': 'application/json',
          'X-CSRF-Token': sesion.token
        },
        body: JSON.stringify({
          correo: `${alias}@example.invalid`, clave
        })
      });
      assert.equal(r.status, 200, JSON.stringify(r.datos));
      return sesion;
    }

    function formulario(buffer, nombre, inicial = false) {
      const form = new FormData();
      if (inicial) {
        form.set('titulo', 'Documento DAW1 para pruebas T11');
        form.set('cursoId', '1');
        form.set('version', 'v1');
      }
      // MIME deliberadamente declarado por el cliente:
      // el servidor debe comprobar el contenido real.
      form.set(
        'archivo',
        new Blob([buffer], { type: 'application/pdf' }),
        nombre
      );
      return form;
    }

    function escribir(sesion, ruta, metodo, body) {
      return pedir(sesion, ruta, {
        method: metodo,
        headers: {
          Origin: ORIGEN,
          'X-CSRF-Token': sesion.token
        },
        ...(body ? { body } : {})
      });
    }

    const docente = await acceder('docente');
    const alumno = await acceder('alumno');
    const otroCurso = await acceder('otro');
    const v1pdf = await pdfValido(300);
    const v2pdf = await pdfValido(350);
    let documentoId;
    let version1Id;

    await t.test('1. Crear y publicar v1 de DAW1', async () => {
      const alta = await escribir(
        docente, '/api/documentos', 'POST',
        formulario(v1pdf, 't11-v1.pdf', true)
      );
      assert.equal(alta.status, 201, JSON.stringify(alta.datos));
      documentoId = alta.datos.datos.documentoId;

      const publicacion = await escribir(
        docente, `/api/documentos/${documentoId}/publicar`, 'PATCH'
      );
      assert.equal(
        publicacion.status, 200, JSON.stringify(publicacion.datos)
      );
      version1Id = publicacion.datos.datos.versionId;

      const estado = await pool.query(`
        SELECT numero_version, estado_version, actual
        FROM documento_version
        WHERE documento_id = $1
      `, [documentoId]);

      assert.deepEqual(estado.rows, [{
        numero_version: 1,
        estado_version: 'vigente',
        actual: true
      }]);
    });

    await t.test('2. Subir v2 valida como borrador', async () => {
      const alta = await escribir(
        docente, `/api/documentos/${documentoId}/versiones`, 'POST',
        formulario(v2pdf, 't11-v2.pdf')
      );
      assert.equal(alta.status, 201, JSON.stringify(alta.datos));
      assert.equal(alta.datos.datos.version, 'v2');
      assert.equal(alta.datos.datos.estado, 'borrador');

      const versiones = await pool.query(`
        SELECT numero_version, estado_version, actual
        FROM documento_version
        WHERE documento_id = $1
        ORDER BY numero_version
      `, [documentoId]);
      assert.deepEqual(versiones.rows, [
        { numero_version: 1, estado_version: 'vigente', actual: true },
        { numero_version: 2, estado_version: 'borrador', actual: false }
      ]);
    });

    await t.test('3. Fallo de carga no crea v3 ni archivos huerfanos', async () => {
      const antes = await archivosPrivados();
      const archivoAntes = await pool.query(
        'SELECT COUNT(*)::int AS total FROM archivo'
      );
      const jpg = await sharp({
        create: {
          width: 100, height: 100, channels: 3,
          background: '#ffffff'
        }
      }).jpeg().toBuffer();

      const invalida = await escribir(
        docente, `/api/documentos/${documentoId}/versiones`, 'POST',
        formulario(jpg, 'imagen-renombrada.pdf')
      );
      assert.equal(invalida.status, 415, JSON.stringify(invalida.datos));
      assert.equal(invalida.datos.error, 'EXTENSION_NO_COINCIDE');

      const versiones = await pool.query(`
        SELECT numero_version, estado_version, actual
        FROM documento_version
        WHERE documento_id = $1
        ORDER BY numero_version
      `, [documentoId]);
      assert.deepEqual(versiones.rows, [
        { numero_version: 1, estado_version: 'vigente', actual: true },
        { numero_version: 2, estado_version: 'borrador', actual: false }
      ]);

      const archivoDespues = await pool.query(
        'SELECT COUNT(*)::int AS total FROM archivo'
      );
      assert.equal(archivoDespues.rows[0].total, archivoAntes.rows[0].total);
      assert.deepEqual(await archivosPrivados(), antes);
    });

    await t.test('4. v1 sigue descargable y v2 no es publica', async () => {
      const v1 = await pedir(
        alumno,
        `/api/documentos/versiones/${version1Id}/descargar`
      );
      assert.equal(v1.status, 200);
      assert.deepEqual(v1.datos, v1pdf);

      const versiones = await pool.query(`
        SELECT id FROM documento_version
        WHERE documento_id = $1 AND numero_version = 2
      `, [documentoId]);
      const v2 = await pedir(
        alumno,
        `/api/documentos/versiones/${versiones.rows[0].id}/descargar`
      );
      assert.equal(v2.status, 404);

      const catalogo = await pedir(alumno, '/api/documentacion');
      assert.equal(catalogo.status, 200);
      const ficha = catalogo.datos.datos.find(d => d.id === documentoId);
      assert.equal(ficha.version, 1);
      assert.equal(ficha.version_id, version1Id);
    });

    await t.test('5. Otro curso no descarga v1 restringida', async () => {
      const respuesta = await pedir(
        otroCurso,
        `/api/documentos/versiones/${version1Id}/descargar`
      );
      assert.equal(respuesta.status, 403);
      assert.equal(respuesta.datos.error, 'CURSO_NO_AUTORIZADO');
    });

    await t.test('6. Archivos de versiones fuera de public', async () => {
      const archivos = await pool.query(`
        SELECT a.ruta, a.almacenamiento_privado
        FROM archivo a
        JOIN documento_version v ON v.archivo_id = a.id
        WHERE v.documento_id = $1
      `, [documentoId]);
      assert.equal(archivos.rowCount, 2);
      const publica = fileURLToPath(new URL('../public/', import.meta.url));

      for (const archivo of archivos.rows) {
        assert.equal(archivo.almacenamiento_privado, true);
        assert.match(archivo.ruta, /^[0-9a-f-]{36}\.pdf$/);
        const ruta = path.join(CARPETA_PRIVADA, archivo.ruta);
        assert.ok((await stat(ruta)).isFile());
        assert.ok(!ruta.startsWith(publica + path.sep));
      }
    });

  } finally {
    if (servidor) {
      await new Promise((resolve, reject) => {
        servidor.close(error => error ? reject(error) : resolve());
        servidor.closeAllConnections();
      });
    }
    almacen?.stopExpiringSessions?.();

    if (pool) {
      // Se eliminan los ficheros creados en este esquema temporal.
      const resultado = await pool.query(
        'SELECT ruta FROM archivo WHERE almacenamiento_privado = true'
      ).catch(() => ({ rows: [] }));

      for (const { ruta } of resultado.rows) {
        await eliminarArchivoPrivado(ruta).catch(error => {
          console.error('No se pudo limpiar el archivo de prueba:', error.code);
        });
      }
      await pool.end();
    }
    if (esquemaCreado) {
      await admin.query(`DROP SCHEMA "${esquema}" CASCADE`);
    }
    await admin.end();
  }
});

