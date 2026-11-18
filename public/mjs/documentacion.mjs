/* Documentación: búsqueda, filtros y paginación, como Biblioteca y Libros.
   La API aplica los filtros y devuelve el total para paginar. */
import { listo, pedir, leerJson, irALogin } from './shell.mjs';
import { crearTarjeta, puedeConsultar, textoError } from './catalogo-comun.mjs';
import { cargarCursos } from './filtros-catalogo.mjs';

const formulario = document.querySelector('#filtros-documentacion');
const busqueda = document.querySelector('#doc-q');
const curso = document.querySelector('#doc-curso');
const lista = document.querySelector('#doc-lista');
const cuenta = document.querySelector('#doc-cuenta');
const paginacion = document.querySelector('#doc-paginacion');
const anterior = document.querySelector('#doc-anterior');
const siguiente = document.querySelector('#doc-siguiente');
const paginaTexto = document.querySelector('#doc-pagina');

const limite = 20;
let identidad = null;
let pagina = 1;
let total = 0;
let ultimaSolicitud = 0;
let cursosCargados = false;

function mostrar(texto) {
  cuenta.textContent = texto ?? '';
}

function hayFiltros() {
  return Boolean(busqueda.value.trim() || curso.value);
}

function parametros() {
  const parametros = new URLSearchParams();
  const texto = busqueda.value.trim();
  if (texto) parametros.set('q', texto);
  if (curso.value) parametros.set('curso', curso.value);
  parametros.set('pagina', String(pagina));
  parametros.set('limite', String(limite));
  return parametros;
}

function actualizarPaginacion() {
  const paginas = Math.max(1, Math.ceil(total / limite));
  paginaTexto.textContent = 'Página ' + pagina + ' de ' + paginas;
  anterior.disabled = pagina <= 1 || total === 0;
  siguiente.disabled = pagina >= paginas || total === 0;
  paginacion.hidden = total === 0;
}

async function prepararCursos() {
  if (cursosCargados) return;
  try {
    await cargarCursos(curso);
    cursosCargados = true;
  } catch {
    // El filtro de curso se queda con "Todos los cursos"; la búsqueda sigue disponible.
  }
}

async function cargar() {
  if (!puedeConsultar(identidad)) {
    lista.replaceChildren();
    paginacion.hidden = true;
    mostrar(identidad
      ? 'Necesitas una cuenta activa de alumnado o docencia para consultar Documentación.'
      : '');
    return;
  }

  const solicitud = ++ultimaSolicitud;
  lista.replaceChildren();
  lista.setAttribute('aria-busy', 'true');
  anterior.disabled = true;
  siguiente.disabled = true;
  mostrar('Cargando…');

  try {
    const respuesta = await pedir('/documentacion?' + parametros().toString());
    const cuerpo = await leerJson(respuesta);
    if (solicitud !== ultimaSolicitud) return;

    if (respuesta.status === 401) {
      irALogin();
      return;
    }
    if (!respuesta.ok) {
      total = 0;
      paginacion.hidden = true;
      mostrar(textoError(respuesta, cuerpo, 'Documentación'));
      return;
    }

    const datos = Array.isArray(cuerpo?.datos) ? cuerpo.datos : [];
    total = Number.isSafeInteger(cuerpo?.total) ? cuerpo.total : datos.length;
    lista.replaceChildren(...datos.map(crearTarjeta));

    if (total === 0) {
      mostrar(hayFiltros()
        ? 'No hay documentos que coincidan con los filtros. Cambia o limpia los filtros para ver más documentos.'
        : 'No hay documentos publicados para tu curso. Vuelve más tarde o pregunta a tu docente.');
    } else {
      mostrar(total === 1 ? '1 documento encontrado.' : total + ' documentos encontrados.');
    }
    actualizarPaginacion();
  } catch {
    if (solicitud !== ultimaSolicitud) return;
    total = 0;
    paginacion.hidden = true;
    mostrar('No se pudo contactar con el servidor. Inténtalo de nuevo.');
  } finally {
    if (solicitud === ultimaSolicitud) lista.setAttribute('aria-busy', 'false');
  }
}

formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  pagina = 1;
  cargar();
});

formulario.addEventListener('reset', () => {
  setTimeout(() => {
    pagina = 1;
    cargar();
  }, 0);
});

anterior.addEventListener('click', () => {
  if (pagina > 1) {
    pagina -= 1;
    cargar();
  }
});

siguiente.addEventListener('click', () => {
  const paginas = Math.max(1, Math.ceil(total / limite));
  if (pagina < paginas) {
    pagina += 1;
    cargar();
  }
});

async function iniciar() {
  identidad = await listo;
  if (!identidad) return;
  await prepararCursos();
  await cargar();
}

document.addEventListener('aula:sesion', async (evento) => {
  identidad = evento.detail;
  if (!identidad) return;
  pagina = 1;
  await prepararCursos();
  await cargar();
});

iniciar();
