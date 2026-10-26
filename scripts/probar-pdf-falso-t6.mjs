/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 * Prueba HTTP de archivo PDF falso.
 *
 * El archivo tiene extensión .pdf, pero
 * su contenido no corresponde a un PDF.
 *
 * Debe rechazarse sin crear un recurso.
 */

import { readFile } from 'node:fs/promises';

const origen = 'http://127.0.0.1:3000';

// Credenciales locales de ensayo.
const datos = JSON.parse(
  await readFile('.cuentas-ensayo.json', 'utf8')
);

const docente = datos.cuentas.find(
  cuenta => cuenta.alias === 'D01'
);

if (!docente) {
  throw new Error('No se encontró el docente D01');
}

// 1. Obtener CSRF.
console.log('PASO 1: solicitando CSRF');

const respuestaCsrf = await fetch(`${origen}/api/csrf`);
const datosCsrf = await respuestaCsrf.json();

const cookieInicial = respuestaCsrf.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieInicial || !datosCsrf.token) {
  throw new Error('No se pudo preparar la sesión');
}

// 2. Iniciar sesión docente.
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
  console.log('Error de autenticación:', acceso.status);
  process.exit(1);
}

const datosAcceso = await acceso.json();

const cookieAutenticada = acceso.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieAutenticada || !datosAcceso.token) {
  throw new Error('Falta la sesión docente');
}

// 3. Preparar archivo falso.
console.log('PASO 3: preparando archivo PDF falso');

const contenido = await readFile(
  'pruebas_t6/archivo_falso.pdf'
);

const formulario = new FormData();

formulario.append(
  'titulo',
  'T6 - Ensayo PDF falso'
);

formulario.append('categoriaId', '2');
formulario.append('cursoId', '1');
formulario.append('version', 'v1');

formulario.append(
  'archivo',
  new Blob([contenido], {
    type: 'application/pdf'
  }),
  'archivo_falso.pdf'
);

// 4. Enviar petición HTTP real.
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
console.log('--- PRUEBA PDF FALSO T6 ---');
console.log('Usuario: D01');
console.log('Archivo: archivo_falso.pdf');
console.log('Tamaño:', contenido.length, 'bytes');
console.log('HTTP observado:', respuesta.status);
console.log('Respuesta:', resultado);

const rechazado =
  respuesta.status >= 400 &&
  respuesta.status < 500 &&
  typeof resultado.error === 'string';

console.log('Rechazo controlado:', rechazado);

if (!rechazado) {
  process.exitCode = 1;
}
