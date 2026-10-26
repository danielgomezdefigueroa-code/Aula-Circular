/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 * Inicio de sesión docente para pruebas HTTP.
 *
 * Utiliza las credenciales ficticias almacenadas
 * localmente, sin imprimirlas.
 */

import { readFile } from 'node:fs/promises';

const origen = 'http://127.0.0.1:3000';

const contenido = await readFile(
  '.cuentas-ensayo.json',
  'utf8'
);

const cuentas = JSON.parse(contenido);

const docente = cuentas.cuentas.find(
  cuenta => cuenta.alias === 'D01'
);

if (!docente) {
  throw new Error('No existe la cuenta docente de ensayo');
}

// Obtenemos cookie y token CSRF del servidor.
const respuestaCsrf = await fetch(`${origen}/api/csrf`);

const { token } = await respuestaCsrf.json();

const cookie = respuestaCsrf.headers.get('set-cookie');

if (!cookie || !token) {
  throw new Error('No se pudo preparar la sesión');
}

// Iniciamos sesión con las credenciales locales.
const respuesta = await fetch(`${origen}/api/acceso`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': origen,
    'X-CSRF-Token': token,
    'Cookie': cookie.split(';')[0]
  },
  body: JSON.stringify({
    correo: docente.correo,
    clave: docente.clave
  })
});

const datos = await respuesta.json();

console.log('Código HTTP:', respuesta.status);
console.log('Usuario:', datos.datos?.alias ?? 'No autenticado');
console.log('Estado:', datos.datos?.estado ?? 'Sin acceso');

if (respuesta.status !== 200) {
  process.exitCode = 1;
}


/**
 * T6 - Prueba de carga real con docente autenticado.
 *
 * Utilizamos la cookie y el CSRF devueltos
 * por el inicio de sesión, no los anteriores.
 */

if (respuesta.status === 200) {
    const cookieAutenticada = respuesta.headers.get('set-cookie');
    const tokenAutenticado = datos.token;
  
    if (!cookieAutenticada || !tokenAutenticado) {
      throw new Error('Falta la sesión autenticada o el CSRF');
    }
  
    const contenidoPdf = await readFile(
      'documentos/DOC-001_Guia_inicio_curso_v1.pdf'
    );
  
    const formulario = new FormData();
  
    formulario.append('titulo', 'T6 - Prueba de archivo ausente');
    formulario.append('categoriaId', '2');
    formulario.append('cursoId', '1');
    formulario.append('version', 'v1');
  
    formulario.append(
      'archivo',
      new Blob([contenidoPdf], { type: 'application/pdf' }),
      'DOC-001_Guia_inicio_curso_v1.pdf'
    );
  
    const carga = await fetch(`${origen}/api/documentos`, {
      method: 'POST',
      headers: {
        Origin: origen,
        'X-CSRF-Token': tokenAutenticado,
        Cookie: cookieAutenticada.split(';')[0]
      },
      body: formulario
    });
  
    const resultado = await carga.json();
  
    console.log('\n--- CARGA DOCUMENTAL T6 ---');
    console.log('HTTP:', carga.status);
    console.log('Resultado:', resultado);
  }
  