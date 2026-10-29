import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derivar = promisify(scrypt);
const opciones = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
let ocupadas = 0;
export class Ocupado extends Error {}
async function calcular(clave, sal) {
  if (ocupadas >= 2) throw new Ocupado('Vuelve a intentarlo en unos segundos');
  ocupadas++;
  try { return await derivar(clave, sal, 64, opciones); }
  finally { ocupadas--; }
}
export function claveValida(clave) {
  return typeof clave === 'string' && [...clave].length >= 15 && [...clave].length <= 128;
}
export async function crearHash(clave) {
  if (!claveValida(clave)) throw new Error('Contraseña fuera de los límites');
  const sal = randomBytes(16).toString('hex');
  const hash = await calcular(clave, sal);
  return `scrypt$131072$8$1$${sal}$${hash.toString('hex')}`;
}
export async function comprobarClave(clave, guardado) {
  if (!claveValida(clave)) return false;
  const partes = String(guardado).split('$');
  if (partes.length !== 6 || partes.slice(0,4).join('$') !== 'scrypt$131072$8$1' ||
      !/^[a-f0-9]{32}$/.test(partes[4]) || !/^[a-f0-9]{128}$/.test(partes[5])) return false;
  const hash = await calcular(clave, partes[4]);
  return timingSafeEqual(hash, Buffer.from(partes[5], 'hex'));
}
