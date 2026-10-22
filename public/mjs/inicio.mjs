/* --- Catálogo de Inicio ---
    Consulta las tres áreas en la API y mantiene los filtros de área,
    texto y disponibilidad. Sustituye al antiguo catálogo local. */
import { listo, pedir, leerJson, irALogin } from './shell.mjs';
import { filtrar, crearTarjeta, puedeConsultar, textoError } from './catalogo-comun.mjs';

const seccion = document.querySelector('#lab-seccion');
const busqueda = document.querySelector('#lab-busqueda');
const disponibles = document.querySelector('#lab-disponibles');
const cuenta = document.querySelector('#lab-cuenta');
const lista = document.querySelector('#lab-catalogo');

let datos = [];
let identidad = null;

function mostrar(texto) {
  cuenta.textContent = texto ?? '';
}

function dibujar() {
  const filtrados = filtrar(datos, {
    seccion: seccion.value,
    texto: busqueda.value,
    soloDisponibles: disponibles.checked
  });
  lista.replaceChildren(...filtrados.map(crearTarjeta));
  mostrar(filtrados.length
    ? filtrados.length + (filtrados.length === 1 ? ' recurso encontrado' : ' recursos encontrados')
    : 'No hay recursos que coincidan con los filtros.');
}

async function leerArea(ruta, contexto) {
  const respuesta = await pedir(ruta);
  const cuerpo = await leerJson(respuesta);
  if (respuesta.status === 401) {
    irALogin();
    throw new Error('Sesión caducada.');
  }
  if (!respuesta.ok) throw new Error(textoError(respuesta, cuerpo, contexto));
  return Array.isArray(cuerpo?.datos) ? cuerpo.datos : [];
}

async function cargar() {
  if (!puedeConsultar(identidad)) {
    datos = [];
    lista.replaceChildren();
    mostrar(identidad
      ? 'Necesitas una cuenta activa de alumnado o docencia para consultar el catálogo.'
      : '');
    return;
  }

  lista.replaceChildren();
  mostrar('Cargando catálogo…');
  try {
    const [biblioteca, libros, documentacion] = await Promise.all([
      leerArea('/biblioteca', 'Biblioteca'),
      leerArea('/libros?pagina=1&limite=20', 'Libros'),
      leerArea('/documentacion', 'Documentación')
    ]);
    datos = [
      ...biblioteca.map((recurso) => ({ ...recurso, seccion: 'biblioteca' })),
      ...libros.map((recurso) => ({
        ...recurso,
        seccion: 'libros',
        tipo: 'fisico',
        estado: 'publicado',
        detalle: recurso.detalle ?? recurso.descripcion ?? ''
      })),
      ...documentacion.map((recurso) => ({ ...recurso, seccion: 'documentacion' }))
    ];
    dibujar();
  } catch (error) {
    datos = [];
    lista.replaceChildren();
    mostrar(error.message);
  }
}

for (const control of [seccion, busqueda, disponibles]) {
  control.addEventListener('input', dibujar);
  control.addEventListener('change', dibujar);
}

document.addEventListener('aula:sesion', async (evento) => {
  identidad = evento.detail;
  await cargar();
});

try {
  identidad = await listo;
  if (identidad) await cargar();
} catch (error) {
  mostrar(error.message);
}
