/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 * Prueba controlada de publicación con tamaño incorrecto.
 * Guarda el PDF original, lo sustituye temporalmente
 * y lo restaura siempre al finalizar.
 */

import {
    readFile,
    writeFile,
    rename
  } from 'node:fs/promises';

  import { spawnSync } from 'node:child_process';
  import { fileURLToPath } from 'node:url';

  const nombre =
    'e0857be8-f956-491c-b46a-94bcf00713f2.pdf';

  const rutaOriginal = fileURLToPath(
    new URL(`../almacen_privado/documentos/${nombre}`, import.meta.url)
  );

  const rutaRespaldo = fileURLToPath(
    new URL(`../almacen_privado/documentos/${nombre}.respaldo-t6`, import.meta.url)
  );

  // Validación previa.
  const original = await readFile(rutaOriginal);

  if (original.length !== 72702) {
    throw new Error(
      `Tamaño inesperado: ${original.length} bytes. No se ejecuta la prueba.`
    );
  }

  let respaldoCreado = false;

  try {
    // Mover el original, sin modificar sus bytes.
    await rename(rutaOriginal, rutaRespaldo);
    respaldoCreado = true;

    // Crear un archivo ficticio de tamaño incorrecto.
    await writeFile(
      rutaOriginal,
      Buffer.alloc(100, 65),
      { flag: 'wx' }
    );

    console.log('--- PRUEBA DE INTEGRIDAD T6 ---');
    console.log('Tamaño esperado en BD: 72702 bytes');
    console.log('Tamaño temporal: 100 bytes');

    // Ejecutar el script HTTP existente.
    const proceso = spawnSync(
      process.execPath,
      ['scripts/probar-publicacion-alterada-t6.mjs'],
      {
        encoding: 'utf8',
        timeout: 30000
      }
    );

    if (proceso.stdout) {
      console.log(proceso.stdout);
    }

    if (proceso.stderr) {
      console.error(proceso.stderr);
    }

    if (proceso.error) {
      console.error('Error de ejecución:', proceso.error.message);
    }

    console.log(
      'Código de salida de la prueba:',
      proceso.status
    );

  } finally {
    if (respaldoCreado) {
      // Eliminar el archivo temporal si existe y
      // restaurar el original.
      const { rm } = await import('node:fs/promises');

      await rm(rutaOriginal, { force: true });
      await rename(rutaRespaldo, rutaOriginal);

      const restaurado = await readFile(rutaOriginal);

      console.log(
        'PDF original restaurado:',
        restaurado.equals(original)
      );

      console.log(
        'Bytes restaurados:',
        restaurado.length
      );
    }
  }
