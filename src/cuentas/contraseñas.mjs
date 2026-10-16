// Receta de API y permisos: scrypt asíncrono + una sal aleatoria por contraseña.
// Guardamos una derivación, NO la contraseña ni un cifrado reversible.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derivar = promisify(scrypt);
const opciones = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export function claveValida(clave) {
  return typeof clave === 'string' && [...clave].length >= 15 && [...clave].length <= 128;
}

export async function crearHash(clave) {
  if (!claveValida(clave)) throw new Error('La contraseña debe tener entre 15 y 128 caracteres');
  const sal = randomBytes(16).toString('hex');
  const hash = await derivar(clave, sal, 64, opciones);
  return ['scrypt', '131072', '8', '1', sal, hash.toString('hex')].join('$');
}

export async function comprobarClave(clave, guardado) {
  if (!claveValida(clave)) return false;
  const partes = String(guardado).split('$');
  if (partes.length !== 6 || partes.slice(0, 4).join('$') !== 'scrypt$131072$8$1') return false;
  const sal = partes[4];
  const hexadecimal = partes[5];
  if (!/^[0-9a-f]{32}$/.test(sal) || !/^[0-9a-f]{128}$/.test(hexadecimal)) return false;
  const calculado = await derivar(clave, sal, 64, opciones);
  return timingSafeEqual(Buffer.from(hexadecimal, 'hex'), calculado);
}
