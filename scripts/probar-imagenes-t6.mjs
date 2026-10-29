/**
 * AULA CIRCULAR - T6
 * Área: Biblioteca y Documentos
 * Prueba HTTP de subida de imágenes PNG y JPG.
 * Ambas deben crear recursos en estado borrador.
 *
 * Ejecutar una sola vez para evitar duplicados.
 */

import { readFile } from 'node:fs/promises';

const origen = 'http://127.0.0.1:3000';

const pruebas = [
  {
    ruta: 'pruebas_t6/imagen_valida.png',
    nombre: 'imagen_valida.png',
    tipo: 'image/png',
    titulo: 'T6 - Ensayo imagen PNG'
  },
  {
    ruta: 'pruebas_t6/imagen_valida.jpg',
    nombre: 'imagen_valida.jpg',
    tipo: 'image/jpeg',
    titulo: 'T6 - Ensayo imagen JPG'
  }
];

// Credenciales ficticias del docente.
const datos = JSON.parse(
  await readFile('.cuentas-ensayo.json', 'utf8')
);

const docente = datos.cuentas.find(
  cuenta => cuenta.alias === 'D01'
);

if (!docente) {
  throw new Error('No se encontró el docente D01');
}

console.log('PASO 1: solicitando CSRF');

const csrfRespuesta = await fetch(`${origen}/api/csrf`);
const csrf = await csrfRespuesta.json();

const cookieInicial = csrfRespuesta.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieInicial || !csrf.token) {
  throw new Error('No se pudo preparar la sesión');
}

console.log('PASO 2: autenticando docente D01');

const acceso = await fetch(`${origen}/api/acceso`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origen,
    'X-CSRF-Token': csrf.token,
    Cookie: cookieInicial
  },
  body: JSON.stringify({
    correo: docente.correo,
    clave: docente.clave
  })
});

if (acceso.status !== 200) {
  console.log('Error de acceso:', acceso.status);
  process.exit(1);
}

const datosAcceso = await acceso.json();

const cookieAutenticada = acceso.headers
  .get('set-cookie')?.split(';')[0];

if (!cookieAutenticada || !datosAcceso.token) {
  throw new Error('Falta la sesión docente autenticada');
}

// Subir las dos imágenes mediante HTTP.
let correctas = 0;

for (const prueba of pruebas) {
  console.log(`PASO 3: subiendo ${prueba.nombre}`);

  const contenido = await readFile(prueba.ruta);

  const formulario = new FormData();

  formulario.append('titulo', prueba.titulo);
  formulario.append('categoriaId', '2');
  formulario.append('cursoId', '1');
  formulario.append('version', 'v1');

  formulario.append(
    'archivo',
    new Blob([contenido], { type: prueba.tipo }),
    prueba.nombre
  );

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

  const coincide =
    respuesta.status === 201 &&
    resultado.datos?.estado === 'borrador' &&
    resultado.datos?.formato ===
      (prueba.tipo === 'image/png' ? 'PNG' : 'JPG');

  console.log('');
  console.log(`--- ${prueba.nombre} ---`);
  console.log('HTTP esperado: 201');
  console.log('HTTP observado:', respuesta.status);
  console.log('Respuesta:', resultado);
  console.log('Resultado correcto:', coincide);

  if (coincide) {
    correctas++;
  } else {
    process.exitCode = 1;
  }
}

console.log('');
console.log('--- RESUMEN T6 ---');
console.log('Imágenes correctas:', correctas, 'de', pruebas.length);
console.log('Prueba completa:', correctas === pruebas.length);
