/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 * Validación del alumno A02 por el docente D01.
 *
 * Utiliza las credenciales ficticias locales.
 * No imprime contraseñas, tokens ni cookies.
 */

import { readFile } from 'node:fs/promises';

const origen = 'http://127.0.0.1:3000';
const alumnoId = 5;
const cursoId = 2;

// Recuperar las credenciales del docente de ensayo.
const contenido = JSON.parse(
  await readFile('.cuentas-ensayo.json', 'utf8')
);

const docente = contenido.cuentas.find(
  cuenta => cuenta.alias === 'D01'
);

if (!docente) {
  throw new Error('No existe el docente D01');
}

// 1. Obtener CSRF y cookie inicial.
const respuestaCsrf = await fetch(`${origen}/api/csrf`);

const datosCsrf = await respuestaCsrf.json();

const cookieInicial = respuestaCsrf.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieInicial || !datosCsrf.token) {
  throw new Error('No se pudo preparar la sesión');
}

// 2. Iniciar sesión como docente.
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
  throw new Error('Falta la sesión docente autenticada');
}

// 3. Validar A02 y confirmar su curso.
const validacion = await fetch(
  `${origen}/api/gestion/usuarios/${alumnoId}/validar`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origen,
      'X-CSRF-Token': datosAcceso.token,
      Cookie: cookieAutenticada
    },
    body: JSON.stringify({
      cursoConfirmadoId: cursoId
    })
  }
);

const resultado = await validacion.json();

console.log('--- VALIDACIÓN DE ALUMNO T6 ---');
console.log('Docente: D01');
console.log('Alumno: A02');
console.log('Curso confirmado solicitado: 2');
console.log('HTTP esperado: 200');
console.log('HTTP observado:', validacion.status);
console.log('Resultado:', resultado);
console.log('Coincide:', validacion.status === 200);

if (validacion.status !== 200) {
  process.exitCode = 1;
}
