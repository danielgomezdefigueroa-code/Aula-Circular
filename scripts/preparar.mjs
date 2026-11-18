// Configuración local: nunca muestra ni sustituye las contraseñas existentes.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const ruta = new URL('../.env', import.meta.url);
const plantilla = new URL('../.env.example', import.meta.url);
let contenido;
try {
  contenido = await readFile(ruta, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  contenido = await readFile(plantilla, 'utf8');
}
const marcador = /^SESSION_SECRET=GENERAR_UN_SECRETO_LOCAL_CON_EL_SCRIPT_PREPARAR\r?$/m;
if (marcador.test(contenido)) contenido=contenido.replace(marcador,`SESSION_SECRET=${randomBytes(32).toString('hex')}`);
const lineas = [];
if (!/^SESSION_SECRET=.+$/m.test(contenido)) lineas.push(`SESSION_SECRET=${randomBytes(32).toString('hex')}`);
if (!/^APP_ORIGIN=.+$/m.test(contenido)) lineas.push('APP_ORIGIN=http://127.0.0.1:3000');
if (lineas.length) contenido+='\n'+lineas.join('\n')+'\n';
await writeFile(ruta,contenido,'utf8');
console.log('Configuración local preparada; no se han mostrado secretos.');
