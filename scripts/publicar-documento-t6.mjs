/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 * Prueba HTTP de publicación documental.
 *
 * Autenticación docente con credenciales
 * ficticias guardadas localmente.
 */

import { readFile } from 'node:fs/promises';

const origen = 'http://127.0.0.1:3000';
const recursoId = 5;

const contenido = JSON.parse(
  await readFile('.cuentas-ensayo.json', 'utf8')
);

const docente = contenido.cuentas.find(
  cuenta => cuenta.alias === 'D01'
);

if (!docente) {
  throw new Error('No existe D01');
}

// 1. Obtener token CSRF y cookie inicial.
const csrfRespuesta = await fetch(`${origen}/api/csrf`);
const csrfDatos = await csrfRespuesta.json();

const cookieInicial = csrfRespuesta.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieInicial || !csrfDatos.token) {
  throw new Error('No se pudo obtener CSRF');
}

// 2. Iniciar sesión como docente.
const acceso = await fetch(`${origen}/api/acceso`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origen,
    'X-CSRF-Token': csrfDatos.token,
    Cookie: cookieInicial
  },
  body: JSON.stringify({
    correo: docente.correo,
    clave: docente.clave
  })
});

const datosAcceso = await acceso.json();

if (acceso.status !== 200) {
  console.log('Acceso HTTP:', acceso.status);
  console.log('No se realiza la publicación');
  process.exit(1);
}

const cookieAutenticada = acceso.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieAutenticada || !datosAcceso.token) {
  throw new Error('Falta sesión autenticada');
}

// 3. Publicar el documento 5.
const publicacion = await fetch(
  `${origen}/api/documentos/${recursoId}/publicar`,
  {
    method: 'PATCH',
    headers: {
      Origin: origen,
      'X-CSRF-Token': datosAcceso.token,
      Cookie: cookieAutenticada
    }
  }
);

const resultado = await publicacion.json();

console.log('--- PUBLICACIÓN T6 ---');
console.log('HTTP:', publicacion.status);
console.log('Resultado:', resultado);

if (publicacion.status !== 200) {
  process.exitCode = 1;
}
