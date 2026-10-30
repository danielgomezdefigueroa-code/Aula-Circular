/* Libros: anuncios publicados con búsqueda, filtros y paginación.
   La API decide el acceso y aplica los filtros. */
import { listo, pedir, leerJson, irALogin, enviar } from './shell.mjs';
import { crearTarjeta, normalizarLibro, puedeConsultar, textoError } from './catalogo-comun.mjs';
import { cargarCursos } from './filtros-catalogo.mjs';

const formulario = document.querySelector('#filtros-libros');
const busqueda = document.querySelector('#lib-q');
const curso = document.querySelector('#lib-curso');
const modalidad = document.querySelector('#lib-modalidad');
const disponibles = document.querySelector('#lib-disponible');
const mensaje = document.querySelector('#mensaje');
const lista = document.querySelector('#libros');
const paginacion = document.querySelector('#libros-paginacion');
const anterior = document.querySelector('#anterior');
const siguiente = document.querySelector('#siguiente');
const paginaTexto = document.querySelector('#pagina');

const limite = 20;
let identidad = null;
let pagina = 1;
let total = 0;
let ultimaSolicitud = 0;
let cursosCargados = false;

function mostrar(texto, enfocar = false) {
  mensaje.textContent = texto ?? '';
  if (enfocar) mensaje.focus();
}

function hayFiltros() {
  return Boolean(busqueda.value.trim() || curso.value || modalidad.value || disponibles.checked);
}

function parametros() {
  const parametros = new URLSearchParams();
  const texto = busqueda.value.trim();
  if (texto) parametros.set('q', texto);
  if (curso.value) parametros.set('curso', curso.value);
  if (modalidad.value) parametros.set('modalidad', modalidad.value);
  if (disponibles.checked) parametros.set('disponible', '1');
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
    // El filtro de curso se queda con la opción general; la búsqueda sigue disponible.
  }
}

function puedeSolicitar(anuncio) {
  return anuncio.modalidad === 'cesion'
    && anuncio.disponible === true
    && Array.isArray(identidad?.roles)
    && identidad.roles.includes('alumno');
}

async function solicitarCesion(anuncio, boton) {
  boton.disabled = true;
  boton.textContent = 'Enviando…';
  try {
    const respuesta = await enviar('/solicitudes', { ejemplarId: anuncio.ejemplar_id });
    const cuerpo = await leerJson(respuesta);
    if (respuesta.status === 401) {
      irALogin();
      return;
    }
    if (!respuesta.ok) {
      boton.disabled = false;
      boton.textContent = 'Solicitar cesión';
      mostrar(textoError(respuesta, cuerpo, 'la solicitud'), true);
      return;
    }
    boton.textContent = 'Solicitud enviada';
    mostrar('Solicitud de cesión enviada. Un docente la revisará.', true);
  } catch {
    boton.disabled = false;
    boton.textContent = 'Solicitar cesión';
    mostrar('No se pudo contactar con el servidor. Inténtalo de nuevo.', true);
  }
}

function crearAnuncio(anuncio) {
  const tarjeta = crearTarjeta(normalizarLibro(anuncio));

  const disponibilidad = document.createElement('p');
  disponibilidad.className = 'disponibilidad';
  disponibilidad.textContent = anuncio.disponible === true
    ? 'Disponible'
    : 'No disponible en este momento';
  tarjeta.append(disponibilidad);

  if (puedeSolicitar(anuncio)) {
    const acciones = document.createElement('div');
    acciones.className = 'acciones-tarjeta';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = 'Solicitar cesión';
    boton.addEventListener('click', () => solicitarCesion(anuncio, boton));
    acciones.append(boton);
    tarjeta.append(acciones);
  }

  return tarjeta;
}

async function cargar() {
  if (!puedeConsultar(identidad)) {
    lista.replaceChildren();
    paginacion.hidden = true;
    mostrar(identidad
      ? 'Necesitas una cuenta activa de alumnado o docencia para consultar Libros.'
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
    const respuesta = await pedir('/libros?' + parametros().toString());
    const cuerpo = await leerJson(respuesta);
    if (solicitud !== ultimaSolicitud) return;

    if (respuesta.status === 401) {
      irALogin();
      return;
    }
    if (!respuesta.ok) {
      total = 0;
      paginacion.hidden = true;
      mostrar(textoError(respuesta, cuerpo, 'Libros'), true);
      return;
    }

    const datos = Array.isArray(cuerpo?.datos) ? cuerpo.datos : [];
    total = Number.isSafeInteger(cuerpo?.total) ? cuerpo.total : datos.length;
    lista.replaceChildren(...datos.map(crearAnuncio));

    if (total === 0) {
      mostrar(hayFiltros()
        ? 'No hay anuncios publicados que coincidan con los filtros.'
        : 'No hay anuncios publicados.');
    } else {
      mostrar(total === 1 ? '1 anuncio encontrado.' : total + ' anuncios encontrados.');
    }
    actualizarPaginacion();
  } catch {
    if (solicitud !== ultimaSolicitud) return;
    total = 0;
    paginacion.hidden = true;
    mostrar('No se pudo contactar con el servidor. Inténtalo de nuevo.', true);
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
