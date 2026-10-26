/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 * Comprobar que un alumno no puede publicar documentos.
 */

import { readFile } from 'node:fs/promises';

const origen = 'http://127.0.0.1:3000';

const contenido = JSON.parse(
  await readFile('.cuentas-ensayo.json', 'utf8')
);

const alumno = contenido.cuentas.find(
  cuenta => cuenta.alias === 'A01'
);

if (!alumno) {
  throw new Error('No existe la cuenta A01');
}

// Obtener cookie y CSRF iniciales.
const csrf = await fetch(`${origen}/api/csrf`);
const csrfDatos = await csrf.json();
const cookieInicial = csrf.headers.get('set-cookie')?.split(';')[0];

if (!cookieInicial || !csrfDatos.token) {
  throw new Error('No se pudo preparar el acceso');
}

// Autenticación real del alumno.
const acceso = await fetch(`${origen}/api/acceso`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origen,
    'X-CSRF-Token': csrfDatos.token,
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

const datosAcceso = await acceso.json();
const cookie = acceso.headers.get('set-cookie')?.split(';')[0];

// Intentar publicar como alumno.
const respuesta = await fetch(
  `${origen}/api/documentos/5/publicar`,
  {
    method: 'PATCH',
    headers: {
      Origin: origen,
      'X-CSRF-Token': datosAcceso.token,
      Cookie: cookie
    }
  }
);

const resultado = await respuesta.json();

console.log('--- PRUEBA PERMISOS T6 ---');
console.log('Usuario: A01');
console.log('Rol: alumno');
console.log('Esperado: 403');
console.log('Observado:', respuesta.status);
console.log('Respuesta:', resultado);
console.log('Coincide:', respuesta.status === 403);

if (respuesta.status !== 403) {
  process.exitCode = 1;
}
