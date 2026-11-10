
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

import {
  validarArchivo,
  guardarArchivoPrivado,
  eliminarArchivoPrivado,
  ErrorArchivo
} from '../src/documentos/archivos.mjs';

const MiB = 1024 * 1024;

const carpetaPrivada = fileURLToPath(
  new URL('../almacen_privado/documentos/', import.meta.url)
);

function prepararArchivo(buffer, nombre, mime = 'application/pdf') {
  return {
    buffer,
    size: buffer.length,
    originalname: nombre,
    mimetype: mime
  };
}

async function listarPrivados() {
  try {
    return (await readdir(carpetaPrivada)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function comprobarRechazo(archivo, codigos) {
  const antes = await listarPrivados();

  await assert.rejects(
    guardarArchivoPrivado(archivo),
    error => {
      assert.ok(error instanceof ErrorArchivo);
      assert.ok(codigos.includes(error.codigo));
      return true;
    }
  );

  const despues = await listarPrivados();
  assert.deepEqual(despues, antes);
}

test('T11 - Validacion de cargas adversas', async t => {
  // PDF auténtico generado para estas pruebas.
  const documento = await PDFDocument.create();
  documento.addPage([300, 200]);
  const pdfValido = Buffer.from(await documento.save());

  await t.test('1. PDF valido aceptado', async () => {
    const datos = await validarArchivo(
      prepararArchivo(pdfValido, 'documento.pdf')
    );

    assert.equal(datos.formato, 'PDF');
    assert.equal(datos.paginas, 1);
    assert.ok(datos.tamano <= 10 * MiB);
  });

  await t.test('2. JPG renombrado como PDF rechazado', async () => {
    const jpg = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: '#ffffff'
      }
    }).jpeg().toBuffer();

    await comprobarRechazo(
      prepararArchivo(jpg, 'imagen-falsa.pdf'),
      ['EXTENSION_NO_COINCIDE']
    );
  });

  await t.test('3. Archivo superior a 10 MiB rechazado', async () => {
    const grande = Buffer.alloc(10 * MiB + 1);
    grande.write('%PDF-', 0, 'ascii');

    await comprobarRechazo(
      prepararArchivo(grande, 'demasiado-grande.pdf'),
      ['ARCHIVO_DEMASIADO_GRANDE']
    );
  });

  await t.test('4. PNG superior a 12 MP rechazado', async () => {
    const png = await sharp({
      create: {
        width: 4000,
        height: 3001,
        channels: 3,
        background: '#ffffff'
      }
    }).png().toBuffer();

    assert.ok(png.length <= 5 * MiB);
    assert.ok(4000 * 3001 > 12_000_000);

    await comprobarRechazo(
      prepararArchivo(png, 'imagen-12mp.png', 'image/png'),
      ['IMAGEN_INVALIDA', 'DIMENSIONES_NO_PERMITIDAS']
    );
  });

  await t.test('5. Nombre inesperado almacenado de forma segura', async () => {
    const antes = await listarPrivados();

    const archivo = prepararArchivo(
      pdfValido,
      '../../¿¡ informe [v2] <T11>.pdf'
    );

    let guardado;

    try {
      guardado = await guardarArchivoPrivado(archivo);

      assert.match(
        guardado.nombreInterno,
        /^[0-9a-f-]{36}\.pdf$/
      );

      const ruta = path.join(
        carpetaPrivada,
        guardado.nombreInterno
      );

      assert.deepEqual(await readFile(ruta), pdfValido);

      const carpetaPublica = fileURLToPath(
        new URL('../public/', import.meta.url)
      );

      assert.ok(
        !ruta.startsWith(carpetaPublica + path.sep)
      );
    } finally {
      if (guardado) {
        await eliminarArchivoPrivado(guardado.nombreInterno);
      }
    }

    assert.deepEqual(await listarPrivados(), antes);
  });
});
