// Pruebas HTTP reales. No imprime contraseñas, cookies ni tokens.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = 'http://127.0.0.1:3000';
const datos = JSON.parse(readFileSync('.cuentas-ensayo.json', 'utf8'));

function nuevoCliente() {
  return { cookies: new Map(), token: null };
}

async function peticion(cliente, metodo, ruta, cuerpo, conCsrf = true) {
  const headers = {};

  if (cliente.cookies.size) {
    headers.Cookie = [...cliente.cookies]
      .map(([nombre, valor]) => `${nombre}=${valor}`)
      .join('; ');
  }

  if (metodo !== 'GET') {
    headers.Origin = base;
    headers['Content-Type'] = 'application/json';
    if (conCsrf && cliente.token) {
      headers['X-CSRF-Token'] = cliente.token;
    }
  }

  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });

  for (const cabecera of respuesta.headers.getSetCookie()) {
    const pareja = cabecera.split(';')[0];
    const separador = pareja.indexOf('=');
    const nombre = pareja.slice(0, separador);
    const valor = pareja.slice(separador + 1);
    if (valor) cliente.cookies.set(nombre, valor);
    else cliente.cookies.delete(nombre);
  }

  const texto = await respuesta.text();
  const contenido = texto ? JSON.parse(texto) : null;

  if (contenido?.token) cliente.token = contenido.token;

  return { codigo: respuesta.status, contenido };
}

function comprobar(nombre, metodo, ruta, resultado, esperado) {
  // Elimina el token únicamente de la salida visible.
  const visible = resultado.contenido
    ? { ...resultado.contenido }
    : null;
  if (visible) delete visible.token;

  console.log(`\n${nombre}`);
  console.log(`${metodo} ${ruta}`);
  console.log(`Esperado: ${esperado} | Observado: ${resultado.codigo}`);
  console.log(JSON.stringify(visible, null, 2));
  assert.equal(resultado.codigo, esperado, nombre);
}

async function acceder(alias) {
  const cuenta = datos.cuentas.find(c => c.alias === alias);
  assert.ok(cuenta, `Falta la cuenta ${alias}`);

  const cliente = nuevoCliente();
  const csrf = await peticion(cliente, 'GET', '/api/csrf');
  assert.equal(csrf.codigo, 200);

  const resultado = await peticion(cliente, 'POST', '/api/acceso', {
    correo: cuenta.correo,
    clave: cuenta.clave
  });

  comprobar(`Acceso de ${alias}`, 'POST', '/api/acceso', resultado, 200);
  return cliente;
}

// Clave errónea: sesión y CSRF preparados, credenciales incorrectas.
const incorrecto = nuevoCliente();
await peticion(incorrecto, 'GET', '/api/csrf');
const alumno = datos.cuentas.find(c => c.alias === 'A01');

comprobar(
  'Clave incorrecta',
  'POST',
  '/api/acceso',
  await peticion(incorrecto, 'POST', '/api/acceso', {
    correo: alumno.correo,
    clave: 'Clave incorrecta de ensayo'
  }),
  401
);

// Sin token válido, ni siquiera se permite efectuar el acceso.
const sinToken = nuevoCliente();
await peticion(sinToken, 'GET', '/api/csrf');

comprobar(
  'Acceso sin token CSRF',
  'POST',
  '/api/acceso',
  await peticion(sinToken, 'POST', '/api/acceso', {
    correo: alumno.correo,
    clave: alumno.clave
  }, false),
  403
);

// Dos sesiones independientes.
const pendiente = await acceder('P01');
const activo = await acceder('A01');

comprobar(
  'Pendiente puede consultar su identidad',
  'GET',
  '/api/yo',
  await peticion(pendiente, 'GET', '/api/yo'),
  200
);

comprobar(
  'Pendiente no puede consultar el catálogo',
  'GET',
  '/api/biblioteca',
  await peticion(pendiente, 'GET', '/api/biblioteca'),
  403
);

comprobar(
  'Alumno activo consulta el catálogo',
  'GET',
  '/api/biblioteca',
  await peticion(activo, 'GET', '/api/biblioteca'),
  200
);

// Conserva una copia de la cookie anterior para probar su invalidación.
const sesionAnterior = {
  cookies: new Map(activo.cookies),
  token: activo.token
};

comprobar(
  'Salida del alumno',
  'POST',
  '/api/salida',
  await peticion(activo, 'POST', '/api/salida', {}),
  204
);

comprobar(
  'La sesión anterior ya no permite acceder',
  'GET',
  '/api/yo',
  await peticion(sesionAnterior, 'GET', '/api/yo'),
  401
);

console.log('\nTodas las comprobaciones de acceso pasaron.');