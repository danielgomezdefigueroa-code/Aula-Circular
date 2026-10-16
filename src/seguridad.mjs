// Funciones de seguridad sin dependencias externas: validación, contraseñas y CSRF.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derivar = promisify(scrypt);
const OPCIONES = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const MAX_DERIVACIONES = 2;   // limita la memoria usada por derivaciones simultáneas
let activas = 0;
const cola = [];

async function conCupo(tarea) {
  if (activas >= MAX_DERIVACIONES) await new Promise((seguir) => cola.push(seguir));
  activas++;
  try {
    return await tarea();
  } finally {
    activas--;
    cola.shift()?.();
  }
}

const longitud = (texto) => [...texto].length;   // caracteres Unicode, no unidades UTF-16

export async function crearHash(clave) {
  if (typeof clave !== 'string' || longitud(clave) < 15 || longitud(clave) > 128) {
    throw new Error('La contraseña debe tener entre 15 y 128 caracteres');
  }
  const sal = randomBytes(16).toString('hex');
  const hash = await conCupo(() => derivar(clave, sal, 64, OPCIONES));
  return ['scrypt', '131072', '8', '1', sal, hash.toString('hex')].join('$');
}

export async function comprobarClave(clave, guardado) {
  if (typeof clave !== 'string' || longitud(clave) > 128) return false;
  const partes = String(guardado).split('$');
  if (partes.length !== 6 || partes.slice(0, 4).join('$') !== 'scrypt$131072$8$1') return false;
  const [, , , , sal, hexadecimal] = partes;
  if (!/^[0-9a-f]{32}$/.test(sal) || !/^[0-9a-f]{128}$/.test(hexadecimal)) return false;
  const calculado = await conCupo(() => derivar(clave, sal, 64, OPCIONES));
  return timingSafeEqual(Buffer.from(hexadecimal, 'hex'), calculado);
}

// Hash de una contraseña inventada, calculado una sola vez. Se compara cuando la cuenta no existe
// para que "cuenta inexistente" y "contraseña incorrecta" tarden parecido.
let hashFicticio = null;
export function obtenerHashFicticio() {
  hashFicticio ??= crearHash('contraseña-ficticia-que-nadie-usa');
  return hashFicticio;
}

export const normalizarCorreo = (correo) => String(correo ?? '').trim().toLowerCase();

export function generarToken() {
  return randomBytes(32).toString('hex');
}

export function tokenCsrfValido(esperado, recibido) {
  if (typeof esperado !== 'string' || typeof recibido !== 'string') return false;
  const a = Buffer.from(esperado), b = Buffer.from(recibido);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Devuelve null si el cuerpo es válido, o { campo: mensaje } para el 422.
// Solo admite los cuatro campos acordados: rol, estado o curso confirmado nunca vienen del cliente.
export function validarRegistro(cuerpo) {
  const campos = {};
  const permitidos = ['alias', 'correo', 'contrasena', 'curso'];
  const datos = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? cuerpo : {};
  for (const clave of Object.keys(datos)) {
    if (!permitidos.includes(clave)) campos[clave] = 'Campo no admitido.';
  }
  const alias = typeof datos.alias === 'string' ? datos.alias.trim() : '';
  if (!alias) campos.alias = 'Escribe un alias.';
  else if (longitud(alias) > 40) campos.alias = 'El alias admite 40 caracteres como máximo.';
  const correo = normalizarCorreo(typeof datos.correo === 'string' ? datos.correo : '');
  if (!correo) campos.correo = 'Escribe un correo.';
  else if (correo.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) campos.correo = 'El correo no tiene un formato válido.';
  if (typeof datos.curso !== 'string' || !datos.curso.trim()) campos.curso = 'Elige el curso solicitado.';
  if (typeof datos.contrasena !== 'string' || !datos.contrasena) campos.contrasena = 'Escribe una contraseña.';
  else if (longitud(datos.contrasena) < 15) campos.contrasena = 'La contraseña debe tener al menos 15 caracteres.';
  else if (longitud(datos.contrasena) > 128) campos.contrasena = 'La contraseña admite 128 caracteres como máximo.';
  return Object.keys(campos).length ? campos : null;
}
