/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 *
 * Prueba HTTP del límite de subida.
 * Archivo de 11 MiB frente al máximo de 10 MiB.
 *
 * Resultado esperado:
 * HTTP 413 ARCHIVO_DEMASIADO_GRANDE
 */

import { readFile } from 'node:fs/promises';

const origen = 'http://127.0.0.1:3000';

// 1. Recuperar credenciales docentes locales.
const datos = JSON.parse(
  await readFile('.cuentas-ensayo.json', 'utf8')
);

const docente = datos.cuentas.find(
  cuenta => cuenta.alias === 'D01'
);

if (!docente) {
  throw new Error('No se encontró el docente D01');
}

// 2. Preparar sesión y CSRF.
console.log('PASO 1: solicitando CSRF');

const respuestaCsrf = await fetch(`${origen}/api/csrf`);
const datosCsrf = await respuestaCsrf.json();

const cookieInicial = respuestaCsrf.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieInicial || !datosCsrf.token) {
  throw new Error('No se pudo preparar la sesión');
}

// 3. Autenticarse como docente.
console.log('PASO 2: autenticando docente D01');

const acceso = await fetch(`${origen}/api/acceso`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origen,
    'X-CSRF-Token': datosCsrf.token,
    Cookie: cookieInicial
  },
  body: JSON.stringify({
    correo: docente.correo,
    clave: docente.clave
  })
});

if (acceso.status !== 200) {
  console.log('HTTP acceso:', acceso.status);
  process.exit(1);
}

const datosAcceso = await acceso.json();

const cookieAutenticada = acceso.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieAutenticada || !datosAcceso.token) {
  throw new Error('Falta la sesión docente');
}

// 4. Leer el archivo de 11 MiB.
console.log('PASO 3: preparando archivo de 11 MiB');

const contenido = await readFile(
  'pruebas_t6/pdf_demasiado_grande.pdf'
);

const formulario = new FormData();

formulario.append(
  'titulo',
  'T6 - Ensayo archivo demasiado grande'
);

formulario.append('categoriaId', '2');
formulario.append('cursoId', '1');
formulario.append('version', 'v1');

formulario.append(
  'archivo',
  new Blob([contenido], {
    type: 'application/pdf'
  }),
  'pdf_demasiado_grande.pdf'
);

// 5. Realizar petición HTTP.
console.log('PASO 4: enviando POST /api/documentos');

const respuesta = await fetch(
  `${origen}/api/documentos`,
  {
    method: 'POST',
    headers: {
      Origin: origen,
      'X-CSRF-Token': datosAcceso.token,
      Cookie: cookieAutenticada
    },
    body: formulario
  }
);

const resultado = await respuesta.json();

console.log('');
console.log('--- PRUEBA ARCHIVO GRANDE T6 ---');
console.log('Usuario: D01');
console.log('Tamaño:', contenido.length, 'bytes');
console.log('Límite: 10485760 bytes');
console.log('HTTP esperado: 413');
console.log('HTTP observado:', respuesta.status);
console.log('Error recibido:', resultado.error);

const coincide =
  respuesta.status === 413 &&
  resultado.error === 'ARCHIVO_DEMASIADO_GRANDE';

console.log('Resultado correcto:', coincide);

if (!coincide) {
  process.exitCode = 1;
}
