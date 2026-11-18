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
const resultadoIntercambio = document.querySelector('#resultado-intercambio');
const dialogo = document.querySelector('#dialogo-intercambio');
const formDialogo = document.querySelector('#form-intercambio');
const dialogoMensaje = document.querySelector('#dialogo-mensaje');
const ofrecidoSelect = document.querySelector('#ofrecido-select');
const ofrecidoDatos = document.querySelector('#ofrecido-datos');
const solicitadoDatos = document.querySelector('#solicitado-datos');
const confirmarPareja = document.querySelector('#confirmar-pareja');
const textoConfirmacion = document.querySelector('#texto-confirmacion');
const enviarPropuesta = document.querySelector('#enviar-propuesta');
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
let opcionesIntercambio = null;
let solicitadoActual = null;
let origenDialogo = null;

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
    && anuncio.es_propio !== true
    && Array.isArray(identidad?.roles)
    && identidad.roles.includes('alumno');
}

function puedeProponer(anuncio) {
  return anuncio.modalidad === 'intercambio'
    && anuncio.disponible === true
    && anuncio.es_propio !== true
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

function filaDato(dl, etiqueta, valor) {
  if (valor === undefined || valor === null || valor === '') return;
  const dt = document.createElement('dt');
  dt.textContent = etiqueta;
  const dd = document.createElement('dd');
  dd.textContent = String(valor);
  dl.append(dt, dd);
}

function pintarFicha(dl, datos) {
  dl.replaceChildren();
  if (!datos) {
    const dt = document.createElement('dt');
    dt.textContent = 'Sin ejemplar';
    const dd = document.createElement('dd');
    dd.textContent = 'No hay una publicación propia disponible para este intercambio.';
    dl.append(dt, dd);
    return;
  }
  filaDato(dl, 'Título', datos.titulo);
  filaDato(dl, 'Edición', datos.edicion);
  filaDato(dl, 'Conservación', datos.conservacion);
  filaDato(dl, 'Propietario', datos.propietarioAlias);
  filaDato(dl, 'Código', datos.codigo);
  filaDato(dl, 'Asignatura', datos.asignatura);
}

function ofertaSeleccionada() {
  if (!opcionesIntercambio || !Array.isArray(opcionesIntercambio.ofrecidos)) return null;
  return opcionesIntercambio.ofrecidos.find(
    (oferta) => String(oferta.ejemplarId) === ofrecidoSelect.value
  ) ?? null;
}

function actualizarConfirmacion() {
  const oferta = ofertaSeleccionada();
  if (oferta && solicitadoActual) {
    textoConfirmacion.textContent =
      'Confirmo que quiero intercambiar «' + oferta.titulo + '» por «' +
      solicitadoActual.titulo + '».';
  } else {
    textoConfirmacion.textContent = 'Confirmo el par elegido.';
  }
  enviarPropuesta.disabled = !(oferta && solicitadoActual && confirmarPareja.checked);
}

function cerrarDialogo() {
  if (dialogo.open) dialogo.close();
  if (origenDialogo && typeof origenDialogo.focus === 'function') origenDialogo.focus();
}

function mostrarResultadoIntercambio(datos) {
  const id = Number(datos?.id);
  resultadoIntercambio.replaceChildren();
  resultadoIntercambio.append(document.createTextNode(
    Number.isSafeInteger(id) && id > 0
      ? 'Propuesta #' + id + ' creada. Esperando aceptación del otro alumno. '
      : 'Propuesta de intercambio creada. Esperando aceptación. '
  ));
  if (Number.isSafeInteger(id) && id > 0) {
    const enlace = document.createElement('a');
    enlace.href = 'intercambios.html?operacion=' + id;
    enlace.textContent = 'Abrir intercambio';
    resultadoIntercambio.append(enlace);
  }
  resultadoIntercambio.hidden = false;
  resultadoIntercambio.focus();
}

async function cargarOpcionesIntercambio(anuncio) {
  opcionesIntercambio = null;
  solicitadoActual = null;
  confirmarPareja.checked = false;
  enviarPropuesta.disabled = true;
  ofrecidoSelect.disabled = true;
  ofrecidoSelect.replaceChildren();
  const cargando = document.createElement('option');
  cargando.value = '';
  cargando.textContent = 'Cargando…';
  ofrecidoSelect.append(cargando);
  pintarFicha(ofrecidoDatos, null);
  pintarFicha(solicitadoDatos, null);
  dialogoMensaje.textContent = 'Cargando ejemplares…';

  try {
    const respuesta = await pedir('/intercambios/opciones/' + anuncio.ejemplar_id);
    const cuerpo = await leerJson(respuesta);
    if (respuesta.status === 401) {
      irALogin();
      return;
    }
    if (!respuesta.ok) {
      dialogoMensaje.textContent = textoError(respuesta, cuerpo, 'el intercambio');
      dialogoMensaje.focus();
      return;
    }

    opcionesIntercambio = cuerpo?.datos ?? null;
    solicitadoActual = opcionesIntercambio?.solicitado ?? null;
    const ofrecidos = Array.isArray(opcionesIntercambio?.ofrecidos)
      ? opcionesIntercambio.ofrecidos
      : [];

    pintarFicha(solicitadoDatos, solicitadoActual);
    ofrecidoSelect.replaceChildren();
    if (!ofrecidos.length) {
      const vacio = document.createElement('option');
      vacio.value = '';
      vacio.textContent = 'No tienes publicaciones de intercambio disponibles';
      ofrecidoSelect.append(vacio);
      ofrecidoSelect.disabled = true;
      pintarFicha(ofrecidoDatos, null);
      dialogoMensaje.textContent =
        'Necesitas un anuncio propio de intercambio, publicado y disponible, para proponer este par.';
      dialogoMensaje.focus();
      return;
    }

    for (const oferta of ofrecidos) {
      const opcion = document.createElement('option');
      opcion.value = String(oferta.ejemplarId);
      opcion.textContent = [oferta.titulo, oferta.edicion].filter(Boolean).join(' · ');
      ofrecidoSelect.append(opcion);
    }
    ofrecidoSelect.disabled = false;
    ofrecidoSelect.selectedIndex = 0;
    pintarFicha(ofrecidoDatos, ofertaSeleccionada());
    dialogoMensaje.textContent = '';
    actualizarConfirmacion();
    ofrecidoSelect.focus();
  } catch {
    dialogoMensaje.textContent = 'No se pudo contactar con el servidor. Inténtalo de nuevo.';
    dialogoMensaje.focus();
  }
}

function abrirDialogo(anuncio, boton) {
  if (dialogo.open) return;
  origenDialogo = boton;
  resultadoIntercambio.hidden = true;
  formDialogo.reset();
  dialogoMensaje.textContent = '';
  if (typeof dialogo.showModal === 'function') {
    dialogo.showModal();
  } else {
    dialogo.setAttribute('open', '');
  }
  cargarOpcionesIntercambio(anuncio);
}

ofrecidoSelect.addEventListener('change', () => {
  pintarFicha(ofrecidoDatos, ofertaSeleccionada());
  actualizarConfirmacion();
});
confirmarPareja.addEventListener('change', actualizarConfirmacion);
document.querySelector('#cerrar-dialogo').addEventListener('click', cerrarDialogo);
document.querySelector('#cancelar-dialogo').addEventListener('click', cerrarDialogo);
dialogo.addEventListener('cancel', (evento) => {
  evento.preventDefault();
  cerrarDialogo();
});

formDialogo.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const oferta = ofertaSeleccionada();
  if (!oferta || !solicitadoActual || !confirmarPareja.checked) {
    dialogoMensaje.textContent = 'Selecciona un ejemplar y confirma expresamente el par elegido.';
    dialogoMensaje.focus();
    return;
  }
  enviarPropuesta.disabled = true;
  enviarPropuesta.textContent = 'Enviando…';
  dialogoMensaje.textContent = 'Enviando propuesta…';
  try {
    const respuesta = await enviar('/intercambios', {
      ejemplarOfrecidoId: oferta.ejemplarId,
      ejemplarSolicitadoId: solicitadoActual.ejemplarId,
      confirmoPropuesta: true
    });
    const cuerpo = await leerJson(respuesta);
    if (respuesta.status === 401) {
      irALogin();
      return;
    }
    if (!respuesta.ok) {
      enviarPropuesta.disabled = false;
      enviarPropuesta.textContent = 'Enviar propuesta';
      dialogoMensaje.textContent = textoError(respuesta, cuerpo, 'el intercambio');
      dialogoMensaje.focus();
      return;
    }
    dialogo.close();
    mostrarResultadoIntercambio(cuerpo?.datos);
  } catch {
    enviarPropuesta.disabled = false;
    enviarPropuesta.textContent = 'Enviar propuesta';
    dialogoMensaje.textContent = 'No se pudo contactar con el servidor. Inténtalo de nuevo.';
    dialogoMensaje.focus();
  }
});

function crearAnuncio(anuncio) {
  const tarjeta = crearTarjeta(normalizarLibro(anuncio));

  const disponibilidad = document.createElement('p');
  disponibilidad.className = 'disponibilidad';
  disponibilidad.textContent = anuncio.disponible === true
    ? 'Disponible'
    : 'No disponible en este momento';
  tarjeta.append(disponibilidad);

  if (anuncio.propietario_alias) {
    const propietario = document.createElement('p');
    propietario.className = 'metadatos';
    propietario.textContent = 'Propietario: ' + anuncio.propietario_alias;
    tarjeta.append(propietario);
  }

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

  if (puedeProponer(anuncio)) {
    const acciones = document.createElement('div');
    acciones.className = 'acciones-tarjeta';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton-sec';
    boton.textContent = 'Proponer intercambio';
    boton.addEventListener('click', () => abrirDialogo(anuncio, boton));
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
        ? 'No hay anuncios publicados que coincidan con los filtros. Cambia o limpia los filtros para ver más resultados.'
        : 'No hay anuncios publicados todavía. Publica un libro desde Mi espacio o vuelve más tarde.');
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
