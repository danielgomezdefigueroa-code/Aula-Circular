/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 * Prueba HTTP de descarga autorizada.
 *
 * Usuario A01: alumno activo del curso 1.
 * Documento: recurso 5, publicado para el curso 1.
 *
 * Comprueba el código HTTP y compara el PDF
 * descargado con el original mediante SHA-256.
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const origen = 'http://127.0.0.1:3000';

const archivoId =
  '2113b360-eb1b-4f13-bd39-410c4b8882a3';

// Credenciales ficticias locales.
const datosLocales = JSON.parse(
  await readFile('.cuentas-ensayo.json', 'utf8')
);

const alumno = datosLocales.cuentas.find(
  cuenta => cuenta.alias === 'A01'
);

if (!alumno) {
  throw new Error('No existe el alumno A01');
}

// 1. Obtener cookie y CSRF.
console.log('PASO 1: solicitando token CSRF');
const respuestaCsrf = await fetch(`${origen}/api/csrf`);

const datosCsrf = await respuestaCsrf.json();

const cookieInicial = respuestaCsrf.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieInicial || !datosCsrf.token) {
  throw new Error('No se pudo preparar la sesión');
}

console.log('PASO 2: iniciando sesión como A01');
// 2. Iniciar sesión como alumno.
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
  console.log('Error de autenticación:', acceso.status);
  process.exit(1);
}

const cookieAutenticada = acceso.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieAutenticada) {
  throw new Error('Falta la cookie autenticada');
}

console.log('PASO 3: descargando PDF autorizado');
// 3. Solicitar la descarga real.
const descarga = await fetch(
  `${origen}/api/documentos/${archivoId}/descargar`,
  {
    method: 'GET',
    headers: {
      Cookie: cookieAutenticada
    }
  }
);

const contenido = Buffer.from(
  await descarga.arrayBuffer()
);

console.log('--- DESCARGA AUTORIZADA T6 ---');
console.log('Usuario: A01');
console.log('Rol: alumno');
console.log('Curso confirmado: 1');
console.log('HTTP esperado: 200');
console.log('HTTP observado:', descarga.status);
console.log('Content-Type:', descarga.headers.get('content-type'));
console.log('Bytes recibidos:', contenido.length);

if (descarga.status === 200) {
  const original = await readFile(
    'documentos/DOC-001_Guia_inicio_curso_v1.pdf'
  );

  const hash = buffer =>
    createHash('sha256').update(buffer).digest('hex');

  const coincide = hash(original) === hash(contenido);

  console.log('Contenido idéntico al original:', coincide);
  console.log(
    'Resultado correcto:',
    descarga.status === 200 && coincide
  );

  if (!coincide) process.exitCode = 1;
} else {
  console.log(
    'Respuesta:',
    contenido.toString('utf8')
  );
  process.exitCode = 1;
}
