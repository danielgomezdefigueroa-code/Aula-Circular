/* Utilidades compartidas por Inicio, Biblioteca, Libros y Documentación.
 * Integración de biblioteca-documentos + interfaz-y-accesibilidad.
 * La API determina permisos, disponibilidad y versiones autorizadas.
 */

import {
  enviar,
  irALogin,
  leerJson
} from './shell.mjs';

export const modalidades = {
  prestamo: 'Préstamo físico',
  cesion: 'Cesión',
  intercambio: 'Intercambio',
  descarga: 'Documento descargable',
  consulta: 'Material digital de consulta',
  digital: 'Consulta digital',
  enlace: 'Enlace educativo'
};

const secciones = {
  biblioteca: 'Biblioteca',
  libros: 'Libros',
  documentacion: 'Documentación'
};

const estados = {
  disponible: 'Disponible',
  publicado: 'Publicado',
  'no disponible': 'No disponible'
};

export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function filtrar(recursos, opciones = {}) {
  const seccion = opciones.seccion ?? 'todas';
  const tokens = normalizar(opciones.texto).split(/\s+/).filter(Boolean);

  return recursos.filter((recurso) => {
    const enSeccion = seccion === 'todas' || recurso.seccion === seccion;
    const campos = [
      recurso.titulo,
      recurso.curso,
      recurso.detalle,
      recurso.descripcion,
      recurso.asignatura,
      recurso.edicion,
      recurso.isbn,
      recurso.codigo,
      recurso.categoria,
      recurso.procedencia,
      modalidades[recurso.modalidad],
      recurso.tipo,
      ...(Array.isArray(recurso.codigos) ? recurso.codigos : [])
    ].filter(Boolean);
    const textoRecurso = normalizar(campos.join(' '));
    const coincide = tokens.every((token) => textoRecurso.includes(token));
    const disponible = !opciones.soloDisponibles ||
      ['disponible', 'publicado'].includes(recurso.estado);
    return enSeccion && coincide && disponible;
  });
}

export function puedeConsultar(identidad) {
  if (!identidad || identidad.estado !== 'activo' || !Array.isArray(identidad.roles)) return false;
  return identidad.roles.some((rol) => rol === 'alumno' || rol === 'docente');
}

export function textoError(respuesta, cuerpo, contexto = 'el catálogo') {
  if (respuesta.status === 401) return 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
  if (cuerpo?.error === 'MATERIAL_DE_OTRO_CURSO') return 'MATERIAL_DE_OTRO_CURSO';
  if (respuesta.status === 403) return 'Necesitas una cuenta activa de alumnado o docencia para consultar ' + contexto + '.';
  return cuerpo?.mensaje ?? cuerpo?.error ?? 'No se pudo cargar ' + contexto + '.';
}

function tipoTexto(recurso) {
  if (recurso.seccion === 'biblioteca') {
    if (recurso.tipo === 'fisico') return ['Préstamo físico', 't-prestamo'];
    if (recurso.tipo === 'enlace') return ['Enlace educativo', 't-digital'];
    if (recurso.tipo === 'digital') return ['Material digital', 't-digital'];
  }
  if (recurso.seccion === 'libros') return ['Anuncio estudiantil', 't-anuncio'];
  if (recurso.seccion === 'documentacion') return ['Documentación', 't-digital'];
  return ['Recurso digital', 't-digital'];
}

export function normalizarLibro(anuncio) {
  const detalle = [
    anuncio.asignatura,
    anuncio.edicion,
    'Conservación: ' + (anuncio.conservacion ?? 'sin indicar'),
    anuncio.isbn ? 'ISBN: ' + anuncio.isbn : '',
    anuncio.detalle ?? anuncio.descripcion ?? ''
  ].filter(Boolean).join(' · ');

  return {
    ...anuncio,
    seccion: 'libros',
    tipo: 'fisico',
    estado: 'publicado',
    procedencia: anuncio.procedencia ?? 'Estudiantil',
    detalle
  };
}

function parrafo(clase, texto) {
  const elemento = document.createElement('p');
  elemento.className = clase;
  elemento.textContent = texto;
  return elemento;
}

export function crearLineaEjemplar(ejemplar, identidad, mostrar) {
  const fila = document.createElement('p');
  fila.className = 't14-edicion-codigo';
  const codigo = document.createElement('span');
  codigo.textContent = ejemplar.codigo;
  const estado = document.createElement('span');
  fila.append(codigo, document.createTextNode(' · '), estado);

  if (ejemplar.solicitud_pendiente) {
    estado.textContent = 'Préstamo pendiente';
    return fila;
  }
  if (!ejemplar.disponible) {
    estado.textContent = ejemplar.estado_servicio === 'retirado'
      ? 'Retirado'
      : 'No disponible';
    return fila;
  }
  if (
    identidad?.estado !== 'activo' ||
    !Array.isArray(identidad.roles) ||
    !identidad.roles.includes('alumno')
  ) {
    estado.textContent = 'Disponible';
    return fila;
  }

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 't14-enlace-prestamo';
  let punteroSobre = false;
  let enfocado = false;
  const actualizarEtiqueta = () => {
    boton.textContent = boton.disabled
      ? 'Enviando…'
      : (punteroSobre || enfocado ? 'Solicitar préstamo' : 'Disponible');
  };
  boton.textContent = 'Disponible';
  boton.addEventListener('pointerenter', () => {
    punteroSobre = true;
    actualizarEtiqueta();
  });
  boton.addEventListener('pointerleave', () => {
    punteroSobre = false;
    actualizarEtiqueta();
  });
  boton.addEventListener('focus', () => {
    enfocado = true;
    actualizarEtiqueta();
  });
  boton.addEventListener('blur', () => {
    enfocado = false;
    actualizarEtiqueta();
  });
  boton.addEventListener('click', async () => {
    boton.disabled = true;
    actualizarEtiqueta();
    try {
      const respuesta = await enviar('/prestamos/solicitudes', {
        ejemplarId: ejemplar.id
      });
      const cuerpo = await leerJson(respuesta);
      if (respuesta.status === 401) {
        irALogin();
        return;
      }
      if (!respuesta.ok) {
        boton.disabled = false;
        actualizarEtiqueta();
        mostrar(textoError(respuesta, cuerpo, 'el préstamo'), true);
        return;
      }
      const pendiente = document.createElement('span');
      pendiente.textContent = 'Préstamo pendiente';
      boton.replaceWith(pendiente);
      mostrar('Solicitud de préstamo enviada. Un docente la revisará.');
    } catch {
      boton.disabled = false;
      actualizarEtiqueta();
      mostrar('No se pudo contactar con el servidor. Inténtalo de nuevo.', true);
    }
  });
  estado.replaceWith(boton);
  return fila;
}

export function crearTarjeta(recurso) {
  const tarjeta = document.createElement('li');
  tarjeta.className = 'tarjeta';

  const curso = recurso.curso ?? (recurso.seccion === 'biblioteca' ? 'General' : null);
  const etiqueta = parrafo('etiqueta', [
    secciones[recurso.seccion] ?? recurso.seccion,
    recurso.procedencia,
    curso
  ].filter(Boolean).join(' · '));

  const [tipo, clase] = tipoTexto(recurso);
  const insignia = parrafo('insignia ' + clase, tipo);
  const titulo = document.createElement('h3');
  titulo.textContent = recurso.titulo;

  const modalidadTexto = modalidades[recurso.modalidad] ?? recurso.modalidad ?? '';
  const modalidad = modalidadTexto
    ? parrafo('modalidad', (recurso.seccion === 'documentacion' ? 'Formato: ' : 'Modalidad: ') + modalidadTexto)
    : null;

  const estadoTexto = [
    estados[recurso.estado] ?? recurso.estado,
    Number.isSafeInteger(recurso.version) ? 'Versión ' + recurso.version : null
  ].filter(Boolean).join(' · ');
  const estado = estadoTexto ? parrafo('estado', 'Estado: ' + estadoTexto) : null;

  const codigos = Array.isArray(recurso.codigos)
    ? recurso.codigos.filter((codigo) => typeof codigo === 'string' && codigo)
    : (typeof recurso.codigo === 'string' && recurso.codigo ? [recurso.codigo] : []);
  const codigo = codigos.length
    ? parrafo('codigo', codigos.length === 1
      ? 'Código: ' + codigos[0]
      : 'Ejemplares (' + codigos.length + '): ' + codigos.join(', '))
    : null;

  const metadatosTexto = [
    recurso.categoria ? 'Categoría: ' + recurso.categoria : null,
    recurso.asignatura ? 'Asignatura: ' + recurso.asignatura : null,
    recurso.edicion ? 'Edición: ' + recurso.edicion : null,
    recurso.isbn ? 'ISBN: ' + recurso.isbn : null,
    recurso.conservacion ? 'Conservación: ' + recurso.conservacion : null,
    recurso.categoria_activa === false ? 'Categoría histórica (inactiva)' : null
  ].filter(Boolean).join(' · ');
  const metadatos = metadatosTexto
    ? parrafo(recurso.seccion === 'biblioteca' ? 'metadatos t14-metadatos' : 'metadatos', metadatosTexto)
    : null;

  const detalleTexto = recurso.detalle ?? recurso.descripcion ?? '';
  const detalle = detalleTexto ? parrafo('detalle', detalleTexto) : null;

  tarjeta.append(...[etiqueta, insignia, titulo, modalidad, estado, codigo, metadatos, detalle]
    .filter(Boolean));

  // Disponibilidad real: la API descuenta las reservas activas por ejemplar.
  if (recurso.seccion === 'biblioteca' && recurso.tipo === 'fisico' &&
      Number.isInteger(recurso.total_ejemplares) &&
      Number.isInteger(recurso.ejemplares_disponibles)) {
    const total = recurso.total_ejemplares;
    const disponibles = recurso.ejemplares_disponibles;
    tarjeta.append(parrafo('disponibilidad',
      `${disponibles} de ${total} ` +
      `${total === 1 ? 'ejemplar' : 'ejemplares'} ` +
      `${disponibles === 1 ? 'disponible' : 'disponibles'}`));
  }

  // Solo enlazar a la descarga protegida cuando la API aporta una versión autorizada.
  if (recurso.seccion === 'documentacion' && recurso.modalidad === 'descarga' &&
      Number.isSafeInteger(recurso.version_id) && recurso.version_id > 0) {
    const acciones = document.createElement('div');
    acciones.className = 'acciones-tarjeta';
    const enlace = document.createElement('a');
    enlace.className = 'boton-sec enlace-descarga';
    enlace.href = `/api/documentos/versiones/${recurso.version_id}/descargar`;
    enlace.textContent = 'Descargar PDF';
    acciones.append(enlace);
    tarjeta.append(acciones);
  }

  // El destino de un recurso externo debe ser una URL HTTP(S) válida.
  if (recurso.seccion === 'biblioteca' && recurso.tipo === 'enlace' && recurso.url_externa) {
    let destino = null;
    try { destino = new URL(recurso.url_externa); } catch { /* Enlace inválido: no mostrar acción. */ }
    if (destino && ['https:', 'http:'].includes(destino.protocol)) {
      const acciones = document.createElement('div');
      acciones.className = 'acciones-tarjeta';
      const enlace = document.createElement('a');
      enlace.className = 'boton-sec';
      enlace.href = destino.href;
      enlace.target = '_blank';
      enlace.rel = 'noopener noreferrer';
      enlace.textContent = 'Abrir enlace';
      acciones.append(enlace);
      tarjeta.append(acciones);
    }
  }

  // Convención de T14: gestion-inventario.mjs escucha clicks sobre
  // button[data-ver-ejemplares] dentro de .area-lista.
  if (recurso.seccion === 'biblioteca' && recurso.tipo === 'fisico' &&
      Number.isSafeInteger(recurso.id) && recurso.id > 0) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton-sec';
    boton.dataset.verEjemplares = String(recurso.id);
    boton.setAttribute('aria-expanded', 'false');
    boton.textContent = 'Ver ejemplares';
    const zona = document.createElement('div');
    zona.className = 't14-detalle-ejemplares';
    zona.dataset.listaEjemplares = '';
    zona.hidden = true;
    tarjeta.append(boton, zona);
  }

  return tarjeta;
}
