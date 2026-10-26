/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 * Registrar alumno ficticio A02 del curso 2.
 *
 * Utiliza POST /api/registro.
 * Guarda la contraseña aleatoria fuera de Git.
 */

import { randomBytes } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';

const origen = 'http://127.0.0.1:3000';
const rutaCredenciales = '.alumno-t6-ensayo.json';

// Generamos credenciales ficticias.
const alumno = {
  alias: 'A02',
  correo: 'alumno2-t6@example.test',
  clave: randomBytes(24).toString('hex'),
  cursoSolicitadoId: 2
};

// Comprobamos que no exista un archivo anterior
// de credenciales. No debemos sobrescribirlo.
try {
  await readFile(rutaCredenciales);
  throw new Error(
    'Ya existen credenciales A02. No repetir el registro.'
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// Guardamos las credenciales antes del registro.
// Así no se pierden si se interrumpe la petición.
await writeFile(
  rutaCredenciales,
  JSON.stringify(alumno, null, 2),
  { flag: 'wx', mode: 0o600 }
);

// Obtener cookie y CSRF.
const csrfRespuesta = await fetch(`${origen}/api/csrf`);
const csrf = await csrfRespuesta.json();

const cookie = csrfRespuesta.headers
  .get('set-cookie')?.split(';')[0];

if (!cookie || !csrf.token) {
  throw new Error('No se pudo preparar CSRF');
}

// Registrar mediante la API real.
const respuesta = await fetch(`${origen}/api/registro`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origen,
    'X-CSRF-Token': csrf.token,
    Cookie: cookie
  },
  body: JSON.stringify(alumno)
});

const resultado = await respuesta.json();

console.log('--- REGISTRO ALUMNO T6 ---');
console.log('Usuario: A02');
console.log('Curso solicitado: 2');
console.log('HTTP esperado: 202');
console.log('HTTP observado:', respuesta.status);
console.log('Resultado:', resultado);

if (respuesta.status !== 202) {
  process.exitCode = 1;
}
