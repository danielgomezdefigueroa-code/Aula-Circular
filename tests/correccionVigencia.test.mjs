
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

// ============================================================
// AULA CIRCULAR - T15
// Explicar una corrección y sus pruebas
//
// Corrección original: 9f0d17c
// Migración: 011_vigencia_predeterminada_documentos.sql
//
// Reproducción controlada del estado intermedio entre
// las migraciones 010 y 011.
// ============================================================

test('T15 - Corrección de vigencia documental', async t => {
  const esquema = 'aula_t15_' + randomBytes(8).toString('hex');

  const admin = new pg.Pool({ max: 1 });

  let pool;
  let esquemaCreado = false;

  const carpeta = new URL(
    '../sql/migraciones/',
    import.meta.url
  );

  const correccion =
    '011_vigencia_predeterminada_documentos.sql';

  async function aplicarMigracion(nombre) {
    const sql = await readFile(
      new URL(nombre, carpeta),
      'utf8'
    );

    await pool.query(sql);
  }

  async function consultarPredeterminados() {
    const resultado = await pool.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = 'documento_version'
        AND column_name IN ('actual', 'estado_version')
      ORDER BY column_name
    `, [esquema]);

    return resultado.rows;
  }

  async function crearArchivo(nombre) {
    const resultado = await pool.query(`
      INSERT INTO archivo (
        nombre,
        tipo_mime,
        ruta
      )
      VALUES ($1, 'application/pdf', $1)
      RETURNING id
    `, [nombre]);

    return resultado.rows[0].id;
  }

  async function insertarVersion(documentoId, archivoId, numero) {
    // Se omiten intencionadamente los campos
    // actual y estado_version para probar sus defaults.

    const resultado = await pool.query(`
      INSERT INTO documento_version (
        documento_id,
        numero_version,
        fecha,
        archivo_id
      )
      VALUES ($1, $2, CURRENT_DATE, $3)
      RETURNING numero_version, estado_version, actual
    `, [documentoId, numero, archivoId]);

    return resultado.rows[0];
  }

  async function consultarVersiones(documentoId) {
    const resultado = await pool.query(`
      SELECT numero_version, estado_version, actual
      FROM documento_version
      WHERE documento_id = $1
      ORDER BY numero_version
    `, [documentoId]);

    return resultado.rows;
  }

  try {
    await admin.query(`CREATE SCHEMA "${esquema}"`);
    esquemaCreado = true;

    pool = new pg.Pool({
      max: 1,
      options: `-c search_path=${esquema}`
    });

    console.log('\n==========================================');
    console.log('T15 - CORRECCIÓN DE VIGENCIA DOCUMENTAL');
    console.log('Commit original: 9f0d17c');
    console.log('Esquema temporal:', esquema);
    console.log('==========================================');

    // Reconstrucción del estado anterior a la migración 011.

    const migraciones = (await readdir(carpeta))
      .filter(nombre => nombre.endsWith('.sql'))
      .sort();

    const anteriores = migraciones.filter(nombre =>
      nombre < correccion
    );

    assert.ok(migraciones.includes(correccion));

    for (const nombre of anteriores) {
      await aplicarMigracion(nombre);
    }

    console.log('\nMigraciones aplicadas:');
    console.log(anteriores.join('\n'));

    const documento = await pool.query(`
      INSERT INTO documento (
        codigo,
        titulo,
        estado_editorial
      )
      VALUES (
        'DOC-T15-001',
        'Documento de ensayo T15',
        'borrador'
      )
      RETURNING id
    `);

    const documentoId = documento.rows[0].id;

    const archivoV1 = await crearArchivo('t15-v1.pdf');
    const archivoV2 = await crearArchivo('t15-v2.pdf');
    const archivoV3 = await crearArchivo('t15-v3.pdf');

    // ========================================================
    // P1 - ANTES DE LA CORRECCIÓN
    // ========================================================

    await t.test('P1 - Reproducir el defecto anterior', async () => {
      console.log('\n--- P1: ANTES DE LA CORRECCIÓN ---');

      console.table(await consultarPredeterminados());

      console.log('Entrada: crear V1 sin actual ni estado_version.');
      console.log('Esperado por la regla: borrador y actual=false.');
      console.log('Predicción del defecto: error SQLSTATE 23514.');

      await assert.rejects(
        () => insertarVersion(documentoId, archivoV1, 1),
        error => {
          console.log('Observado:', error.code);
          console.log('Restricción:', error.constraint);

          assert.equal(error.code, '23514');
          assert.equal(
            error.constraint,
            'documento_version_vigencia_coherente'
          );

          return true;
        }
      );

      const versiones = await consultarVersiones(documentoId);

      assert.equal(versiones.length, 0);

      console.log('Versiones creadas:', versiones.length);
      console.log('Defecto reproducido correctamente.');
    });

    // ========================================================
    // P2 - DESPUÉS DE LA CORRECCIÓN
    // ========================================================

    await t.test('P2 - Aplicar y verificar la corrección', async () => {
      console.log('\n--- P2: DESPUÉS DE LA CORRECCIÓN ---');

      await aplicarMigracion(correccion);

      console.log('Migración aplicada:', correccion);

      console.table(await consultarPredeterminados());

      console.log('Entrada: exactamente la misma inserción de V1.');
      console.log('Esperado: borrador y actual=false.');

      const resultado = await insertarVersion(
        documentoId,
        archivoV1,
        1
      );

      console.log('Observado:');
      console.table([resultado]);

      assert.deepEqual(resultado, {
        numero_version: 1,
        estado_version: 'borrador',
        actual: false
      });

      console.log('Corrección verificada.');
    });

    // ========================================================
    // P3 - VARIANTE: EXISTE UNA VERSIÓN VIGENTE
    // ========================================================

    await t.test('P3 - Crear V2 conservando V1 vigente', async () => {
      console.log('\n--- P3: VARIANTE ---');

      // Preparar el nuevo estado inicial de ensayo.
      // No se está probando aquí la ruta HTTP de publicación.

      await pool.query(`
        UPDATE documento_version
        SET actual = true,
            estado_version = 'vigente'
        WHERE documento_id = $1
          AND numero_version = 1
      `, [documentoId]);

      await pool.query(`
        UPDATE documento
        SET estado_editorial = 'publicado'
        WHERE id = $1
      `, [documentoId]);

      console.log('Estado inicial:');
      console.table(await consultarVersiones(documentoId));

      console.log('Variación: existe una V1 vigente.');
      console.log('Entrada: crear V2 sin indicar estado ni vigencia.');
      console.log('Predicción: V1 vigente y V2 borrador.');

      await insertarVersion(documentoId, archivoV2, 2);

      const resultado = await consultarVersiones(documentoId);

      console.log('Observado:');
      console.table(resultado);

      assert.deepEqual(resultado, [
        {
          numero_version: 1,
          estado_version: 'vigente',
          actual: true
        },
        {
          numero_version: 2,
          estado_version: 'borrador',
          actual: false
        }
      ]);

      assert.equal(
        resultado.filter(version => version.actual).length,
        1
      );

      console.log('Variante superada correctamente.');
    });

    // ========================================================
    // P4 - CONTROL NEGATIVO
    // ========================================================

    await t.test('P4 - La restricción sigue activa', async () => {
      console.log('\n--- P4: CONTROL NEGATIVO ---');

      console.log('Entrada: V3 con borrador y actual=true.');
      console.log('Esperado: rechazo por incoherencia.');

      await assert.rejects(
        () => pool.query(`
          INSERT INTO documento_version (
            documento_id,
            numero_version,
            fecha,
            archivo_id,
            estado_version,
            actual
          )
          VALUES (
            $1, 3, CURRENT_DATE, $2,
            'borrador', true
          )
        `, [documentoId, archivoV3]),
        error => {
          console.log('Observado:', error.code);
          console.log('Restricción:', error.constraint);

          assert.equal(error.code, '23514');
          assert.equal(
            error.constraint,
            'documento_version_vigencia_coherente'
          );

          return true;
        }
      );

      const resultado = await consultarVersiones(documentoId);

      assert.deepEqual(resultado, [
        {
          numero_version: 1,
          estado_version: 'vigente',
          actual: true
        },
        {
          numero_version: 2,
          estado_version: 'borrador',
          actual: false
        }
      ]);

      console.log('Estado final de las versiones:');
      console.table(resultado);

      console.log('La corrección no elimina la restricción.');
    });

  } finally {
    try {
      if (pool) {
        await pool.end();
      }

      if (esquemaCreado) {
        await admin.query(
          `DROP SCHEMA "${esquema}" CASCADE`
        );

        console.log('\nEsquema temporal eliminado.');
      }
    } finally {
      await admin.end();
    }
  }
});
