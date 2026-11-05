
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';

import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';
import {
  eliminarArchivoPrivado
} from '../src/documentos/archivos.mjs';

// ============================================================
// T8 - GESTIONAR VERSIONES Y DESCARGAS AUTORIZADAS
// Prueba HTTP y PostgreSQL con esquema temporal.
// ============================================================

test('T8: versiones y descargas autorizadas', async t => {
  const esquema =
    'aula_t8_' + randomBytes(8).toString('hex');

  const origen = 'http://127.0.0.1:3000';
  const admin = new pg.Pool({ max: 1 });

  let pool;
  let servidor;
  let almacen;

  // Archivos que eliminaremos después del ensayo.
  const archivosCreados = new Set();

  const sha256 = contenido =>
    createHash('sha256')
      .update(contenido)
      .digest('hex');

  try {
    // 1. Preparar esquema temporal.
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

    // 2. Preparar cuentas ficticias.
    const clave = 'Frase segura para versiones T8 2026';
    const hash = await crearHash(clave);

    const cuentas = [
      ['docente_t8', 'docente', 1],
      ['alumno_t8', 'alumno', 1],
      ['otro_t8', 'alumno', 2],
      ['admin_t8', 'admin', 1]
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

    // 3. Arrancar una instancia HTTP de ensayo.
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

    // 4. Cliente HTTP con cookie y token CSRF.
    async function pedir(sesion, ruta, opciones = {}) {
      const headers = {
        Cookie: sesion.cookie ?? '',
        ...opciones.headers
      };

      const respuesta = await fetch(base + ruta, {
        ...opciones,
        headers
      });

      const cookie =
        respuesta.headers.getSetCookie()[0];

      if (cookie) {
        sesion.cookie = cookie.split(';')[0];
      }

      const tipo = respuesta.headers.get(
        'content-type'
      );

      const datos = tipo?.includes('application/json')
        ? await respuesta.json()
        : Buffer.from(await respuesta.arrayBuffer());

      if (datos?.token) {
        sesion.token = datos.token;
      }

      return {
        status: respuesta.status,
        datos
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

    const docente = await acceder('docente_t8');
    const alumno = await acceder('alumno_t8');
    const otro = await acceder('otro_t8');
    const adminSesion = await acceder('admin_t8');

    // 5. Dos documentos PDF con bytes diferentes.
    async function generarPdf(ancho) {
      const pdf = await PDFDocument.create();
      pdf.addPage([ancho, 200]);

      return Buffer.from(await pdf.save());
    }

    const pdfV1 = await generarPdf(300);
    const pdfV2 = await generarPdf(400);

    const hashV1 = sha256(pdfV1);
    const hashV2 = sha256(pdfV2);

    assert.notEqual(hashV1, hashV2);

    function formulario(contenido, inicial = false) {
      const datos = new FormData();

      if (inicial) {
        datos.set('titulo', 'Guía T8 de ensayo');
        datos.set('cursoId', '1');
        datos.set('version', 'v1');
      }

      datos.set(
        'archivo',
        new Blob(
          [contenido],
          { type: 'application/pdf' }
        ),
        'documento.pdf'
      );

      return datos;
    }

    async function enviar(sesion, ruta, metodo, body) {
      return pedir(sesion, ruta, {
        method: metodo,
        headers: {
          Origin: origen,
          'X-CSRF-Token': sesion.token
        },
        ...(body ? { body } : {})
      });
    }

    async function descargar(sesion, versionId) {
      return pedir(
        sesion,
        `/api/documentos/versiones/${versionId}/descargar`
      );
    }

    async function consultarVersiones(sesion, documentoId) {
      return pedir(
        sesion,
        `/api/documentos/${documentoId}/versiones`
      );
    }

    async function registrarArchivo(archivoId) {
      const resultado = await pool.query(`
        SELECT ruta
        FROM archivo
        WHERE id = $1
      `, [archivoId]);

      assert.equal(resultado.rowCount, 1);

      archivosCreados.add(resultado.rows[0].ruta);
    }

    let documentoId;
    let versionIdV1;
    let versionIdV2;
    let archivoIdV1;
    let archivoIdV2;

    // ========================================================
    // CASO 1 - Crear v1 en borrador.
    // ========================================================
    await t.test('Crear v1 en borrador', async () => {
      const respuesta = await enviar(
        docente,
        '/api/documentos',
        'POST',
        formulario(pdfV1, true)
      );

      assert.equal(
        respuesta.status,
        201,
        JSON.stringify(respuesta.datos)
      );

      documentoId = respuesta.datos.datos.documentoId;
      archivoIdV1 = respuesta.datos.datos.archivoId;

      await registrarArchivo(archivoIdV1);

      const resultado = await pool.query(`
        SELECT id, actual, estado_version
        FROM documento_version
        WHERE documento_id = $1
          AND numero_version = 1
      `, [documentoId]);

      assert.equal(resultado.rowCount, 1);
      assert.equal(resultado.rows[0].actual, false);
      assert.equal(
        resultado.rows[0].estado_version,
        'borrador'
      );

      versionIdV1 = resultado.rows[0].id;
    });

    // ========================================================
    // CASO 2 - Publicar v1.
    // ========================================================
    await t.test('Publicar v1', async () => {
      const respuesta = await enviar(
        docente,
        `/api/documentos/${documentoId}/publicar`,
        'PATCH'
      );

      assert.equal(
        respuesta.status,
        200,
        JSON.stringify(respuesta.datos)
      );

      const descarga = await descargar(
        alumno,
        versionIdV1
      );

      assert.equal(descarga.status, 200);
      assert.equal(sha256(descarga.datos), hashV1);
    });

    // ========================================================
    // CASO 3 - Crear v2 sin modificar v1.
    // ========================================================
    await t.test('Crear v2 en borrador', async () => {
      const respuesta = await enviar(
        docente,
        `/api/documentos/${documentoId}/versiones`,
        'POST',
        formulario(pdfV2)
      );

      assert.equal(
        respuesta.status,
        201,
        JSON.stringify(respuesta.datos)
      );

      versionIdV2 = respuesta.datos.datos.versionId;
      archivoIdV2 = respuesta.datos.datos.archivoId;

      await registrarArchivo(archivoIdV2);

      assert.notEqual(archivoIdV1, archivoIdV2);
      assert.notEqual(versionIdV1, versionIdV2);

      const listado = await consultarVersiones(
        alumno,
        documentoId
      );

      assert.equal(listado.status, 200);
      assert.equal(listado.datos.datos.versiones.length, 1);
      assert.equal(
        listado.datos.datos.versiones[0].version_id,
        versionIdV1
      );

      const borrador = await descargar(
        alumno,
        versionIdV2
      );

      assert.equal(borrador.status, 404);
    });

    // ========================================================
    // CASO 4 - Publicar v2 de forma atómica.
    // ========================================================
    await t.test('Publicar v2 y conservar v1', async () => {
      const respuesta = await enviar(
        docente,
        `/api/documentos/${documentoId}/versiones/${versionIdV2}/publicar`,
        'PATCH'
      );

      assert.equal(
        respuesta.status,
        200,
        JSON.stringify(respuesta.datos)
      );

      const versiones = await pool.query(`
        SELECT
          v.numero_version,
          v.actual,
          v.estado_version,
          a.sha256
        FROM documento_version v
        JOIN archivo a ON a.id = v.archivo_id
        WHERE v.documento_id = $1
        ORDER BY v.numero_version
      `, [documentoId]);

      assert.equal(versiones.rowCount, 2);

      assert.equal(
        versiones.rows[0].estado_version,
        'historica'
      );
      assert.equal(versiones.rows[0].actual, false);
      assert.equal(versiones.rows[0].sha256, hashV1);

      assert.equal(
        versiones.rows[1].estado_version,
        'vigente'
      );
      assert.equal(versiones.rows[1].actual, true);
      assert.equal(versiones.rows[1].sha256, hashV2);

      assert.equal(
        versiones.rows.filter(v => v.actual).length,
        1
      );
    });

    // ========================================================
    // CASO 5 - Alumno descarga v2.
    // ========================================================
    await t.test('Alumno descarga v2 vigente', async () => {
      const respuesta = await descargar(
        alumno,
        versionIdV2
      );

      assert.equal(respuesta.status, 200);
      assert.deepEqual(respuesta.datos, pdfV2);
      assert.equal(sha256(respuesta.datos), hashV2);
    });

    // ========================================================
    // CASO 6 - Alumno no descarga v1 histórica.
    // ========================================================
    await t.test('Alumno no accede a v1 histórica', async () => {
      const respuesta = await descargar(
        alumno,
        versionIdV1
      );

      assert.equal(respuesta.status, 404);
    });

    // ========================================================
    // CASO 7 - Alumno de otro curso.
    // ========================================================
    await t.test('Otro curso no descarga v2', async () => {
      const respuesta = await descargar(
        otro,
        versionIdV2
      );

      assert.equal(respuesta.status, 403);
    });

    // ========================================================
    // CASO 8 - Sin sesión.
    // ========================================================
    await t.test('Sin sesión no descarga v2', async () => {
      const respuesta = await descargar(
        {},
        versionIdV2
      );

      assert.equal(respuesta.status, 401);
    });

    // ========================================================
    // CASO 9 - Docente consulta y descarga el histórico.
    // ========================================================
    await t.test('Docente recupera v1 histórica', async () => {
      const listado = await consultarVersiones(
        docente,
        documentoId
      );

      assert.equal(listado.status, 200);
      assert.equal(listado.datos.datos.versiones.length, 2);

      const respuesta = await descargar(
        docente,
        versionIdV1
      );

      assert.equal(respuesta.status, 200);
      assert.deepEqual(respuesta.datos, pdfV1);
      assert.equal(sha256(respuesta.datos), hashV1);
    });

    // ========================================================
    // CASO 10 - El alumno solo ve la versión vigente.
    // ========================================================
    await t.test('Alumno solo consulta v2', async () => {
      const respuesta = await consultarVersiones(
        alumno,
        documentoId
      );

      assert.equal(respuesta.status, 200);

      const versiones = respuesta.datos.datos.versiones;

      assert.equal(versiones.length, 1);
      assert.equal(versiones[0].version_id, versionIdV2);
      assert.equal(versiones[0].estado_version, 'vigente');
    });

    
    // ========================================================
    // CASO 11 - Archivo alterado impide publicar v3.
    // ========================================================
    await t.test(
      'Archivo alterado no reemplaza la versión vigente',
      async () => {

        // Crear una tercera versión en borrador.
        const creacion = await enviar(
          docente,
          `/api/documentos/${documentoId}/versiones`,
          'POST',
          formulario(pdfV1)
        );

        assert.equal(creacion.status, 201);

        const versionIdV3 = creacion.datos.datos.versionId;
        const archivoIdV3 = creacion.datos.datos.archivoId;

        await registrarArchivo(archivoIdV3);

        // Simular una alteración de integridad.
        await pool.query(`
          UPDATE archivo
          SET sha256 = $2
          WHERE id = $1
        `, [
          archivoIdV3,
          '0'.repeat(64)
        ]);

        // Intentar publicar la versión alterada.
        const publicacion = await enviar(
          docente,
          `/api/documentos/${documentoId}/versiones/${versionIdV3}/publicar`,
          'PATCH'
        );

        assert.equal(publicacion.status, 409);

        // Comprobar que v2 continúa vigente.
        const vigente = await pool.query(`
          SELECT id, estado_version
          FROM documento_version
          WHERE documento_id = $1
            AND actual = true
        `, [documentoId]);

        assert.equal(vigente.rowCount, 1);
        assert.equal(vigente.rows[0].id, versionIdV2);
        assert.equal(
          vigente.rows[0].estado_version,
          'vigente'
        );

        // v3 permanece en borrador.
        const borrador = await pool.query(`
          SELECT estado_version, actual
          FROM documento_version
          WHERE id = $1
        `, [versionIdV3]);

        assert.equal(
          borrador.rows[0].estado_version,
          'borrador'
        );

        assert.equal(borrador.rows[0].actual, false);

        console.log(
          'T8: publicación rechazada; v2 sigue vigente.'
        );
      }
    );


    
    // ========================================================
    // CASO 12 - Documentos generales.
    // ========================================================
    await t.test(
      'Documento general accesible desde distintos cursos',
      async () => {

        const datos = formulario(pdfV1, true);

        // Sin curso asignado = documento general.
        datos.set('cursoId', '');
        datos.set(
          'titulo',
          'Documento general T8 de ensayo'
        );

        const creacion = await enviar(
          docente,
          '/api/documentos',
          'POST',
          datos
        );

        assert.equal(creacion.status, 201);

        const generalId =
          creacion.datos.datos.documentoId;

        const archivoGeneralId =
          creacion.datos.datos.archivoId;

        await registrarArchivo(archivoGeneralId);

        // Publicar el documento general.
        const publicacion = await enviar(
          docente,
          `/api/documentos/${generalId}/publicar`,
          'PATCH'
        );

        assert.equal(publicacion.status, 200);

        const resultado = await pool.query(`
          SELECT v.id AS version_id
          FROM documento_version v
          WHERE v.documento_id = $1
            AND v.estado_version = 'vigente'
        `, [generalId]);

        assert.equal(resultado.rowCount, 1);

        const versionGeneralId =
          resultado.rows[0].version_id;

        // Alumno del curso 1.
        const descarga1 = await descargar(
          alumno,
          versionGeneralId
        );

        assert.equal(descarga1.status, 200);
        assert.equal(sha256(descarga1.datos), hashV1);

        // Alumno del curso 2.
        const descarga2 = await descargar(
          otro,
          versionGeneralId
        );

        assert.equal(descarga2.status, 200);
        assert.equal(sha256(descarga2.datos), hashV1);

        console.log(
          'T8: documento general autorizado en ambos cursos.'
        );
      }
    );


    
    // ========================================================
    // CASO 13 - No republicar una versión histórica.
    // ========================================================
    await t.test(
      'No se permite republicar v1 histórica',
      async () => {

        const respuesta = await enviar(
          docente,
          `/api/documentos/${documentoId}/versiones/${versionIdV1}/publicar`,
          'PATCH'
        );

        assert.equal(respuesta.status, 409);

        // Confirmar que v2 sigue siendo vigente.
        const resultado = await pool.query(`
          SELECT id
          FROM documento_version
          WHERE documento_id = $1
            AND actual = true
        `, [documentoId]);

        assert.equal(resultado.rowCount, 1);
        assert.equal(resultado.rows[0].id, versionIdV2);
      }
    );


    
    // ========================================================
    // CASO 14 - Administrador sin rol docente.
    // ========================================================
    await t.test(
      'Administrador sin rol docente no accede al histórico',
      async () => {

        // Intentar descargar v1 histórica.
        const descarga = await descargar(
          adminSesion,
          versionIdV1
        );

        assert.equal(descarga.status, 403);

        // Intentar consultar el historial.
        const listado = await consultarVersiones(
          adminSesion,
          documentoId
        );

        assert.equal(listado.status, 403);

        // Intentar consultar el catálogo.
        const catalogo = await pedir(
          adminSesion,
          '/api/documentacion'
        );

        assert.equal(catalogo.status, 403);

        console.log(
          'T8: administrador sin rol docente rechazado.'
        );
      }
    );


    
    // ========================================================
    // CASO 15 - Catálogo documental.
    // ========================================================
    await t.test(
      'Catálogo muestra únicamente la versión vigente',
      async () => {

        const respuesta = await pedir(
          alumno,
          '/api/documentacion'
        );

        assert.equal(respuesta.status, 200);

        const documentos = respuesta.datos.datos;

        const documento = documentos.find(
          item => Number(item.id) === documentoId
        );

        assert.ok(
          documento,
          'El documento debe aparecer en el catálogo'
        );

        assert.equal(Number(documento.version), 2);

        assert.equal(
          Number(documento.version_id),
          versionIdV2
        );

        assert.equal(
          documento.estado,
          'publicado'
        );

        // Comprobar que el documento aparece una sola vez.
        assert.equal(
          documentos.filter(
            item => Number(item.id) === documentoId
          ).length,
          1
        );

        // El catálogo no debe devolver la versión histórica.
        assert.notEqual(
          Number(documento.version_id),
          versionIdV1
        );

        console.log(
          'T8: catálogo muestra v2 vigente correctamente.'
        );
      }
    );


    
    // ========================================================
    // CASO 16 - Compatibilidad con T6.
    // ========================================================
    await t.test(
      'Ruta antigua no permite descargar v1 histórica',
      async () => {

        const respuesta = await pedir(
          alumno,
          `/api/documentos/${archivoIdV1}/descargar`
        );

        assert.equal(respuesta.status, 404);

        // La ruta antigua sigue permitiendo descargar
        // el archivo vigente del curso autorizado.
        const vigente = await pedir(
          alumno,
          `/api/documentos/${archivoIdV2}/descargar`
        );

        assert.equal(vigente.status, 200);
        assert.equal(
          sha256(vigente.datos),
          hashV2
        );

        console.log(
          'T8: compatibilidad con descargas T6 verificada.'
        );
      }
    );

    console.log('\n--- HUELLAS T8 ---');
    console.log('SHA-256 v1:', hashV1);
    console.log('SHA-256 v2:', hashV2);
    console.log('Documento:', documentoId);
    console.log('Versión histórica:', versionIdV1);
    console.log('Versión vigente:', versionIdV2);

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

    for (const nombre of archivosCreados) {
      await eliminarArchivoPrivado(nombre);
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
