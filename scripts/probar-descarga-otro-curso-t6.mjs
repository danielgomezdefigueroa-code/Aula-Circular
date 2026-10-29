/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 * Prueba HTTP:
 * Alumno A02 (curso 2) intenta descargar
 * un documento publicado del curso 1.
 *
 * Esperado: HTTP 403 CURSO_NO_AUTORIZADO.
 * Ningún byte del PDF debe entregarse.
 */

import { readFile } from 'node:fs/promises';

const origen = 'http://127.0.0.1:3000';

const archivoId =
  '2113b360-eb1b-4f13-bd39-410c4b8882a3';

// Credenciales del alumno ficticio A02.
const alumno = JSON.parse(
  await readFile('.alumno-t6-ensayo.json', 'utf8')
);

// 1. Preparar sesión.
console.log('PASO 1: solicitando CSRF');

const respuestaCsrf = await fetch(`${origen}/api/csrf`);

const datosCsrf = await respuestaCsrf.json();

const cookieInicial = respuestaCsrf.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieInicial || !datosCsrf.token) {
  throw new Error('No se pudo preparar la sesión');
}

// 2. Iniciar sesión como A02.
console.log('PASO 2: iniciando sesión como A02');

const acceso = await fetch(`${origen}/api/acceso`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origen,
    'X-CSRF-Token': datosCsrf.token,
    Cookie: cookieInicial
  },
  body: JSON.stringify({
    correo: alumno.correo,
    clave: alumno.clave
  })
});

if (acceso.status !== 200) {
  console.log('HTTP acceso:', acceso.status);
  console.log('Respuesta:', await acceso.text());
  process.exit(1);
}

const cookieAutenticada = acceso.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieAutenticada) {
  throw new Error('No se recibió la cookie autenticada');
}

// 3. Solicitar el documento del curso 1.
console.log('PASO 3: solicitando PDF del curso 1');

const descarga = await fetch(
  `${origen}/api/documentos/${archivoId}/descargar`,
  {
    headers: {
      Cookie: cookieAutenticada
    }
  }
);

const contenido = Buffer.from(
  await descarga.arrayBuffer()
);

let respuestaJson = null;

try {
  respuestaJson = JSON.parse(
    contenido.toString('utf8')
  );
} catch {
  // Si el servidor devuelve bytes binarios,
  // lo detectaremos en las comprobaciones.
}

const codigoCorrecto = descarga.status === 403;

const errorCorrecto =
  respuestaJson?.error === 'CURSO_NO_AUTORIZADO';

const firmaPdf = contenido.subarray(0, 5)
  .toString('ascii') === '%PDF-';

const tipoRespuesta = descarga.headers
  .get('content-type') ?? '';

const sinPdf =
  !firmaPdf &&
  !tipoRespuesta.startsWith('application/pdf');

console.log('');
console.log('--- DESCARGA OTRO CURSO T6 ---');
console.log('Usuario: A02');
console.log('Curso confirmado: 2');
console.log('Documento solicitado: curso 1');
console.log('HTTP esperado: 403');
console.log('HTTP observado:', descarga.status);
console.log('Error recibido:', respuestaJson?.error);
console.log('Content-Type:', tipoRespuesta);
console.log('Bytes totales de respuesta:', contenido.length);
console.log('Firma PDF presente:', firmaPdf);
console.log('HTTP correcto:', codigoCorrecto);
console.log('Error correcto:', errorCorrecto);
console.log('Sin contenido PDF:', sinPdf);

const coincide =
  codigoCorrecto &&
  errorCorrecto &&
  sinPdf;

console.log('Resultado correcto:', coincide);

if (!coincide) {
  process.exitCode = 1;
}
