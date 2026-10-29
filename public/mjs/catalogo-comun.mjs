/* Utilidades compartidas por el catálogo de Inicio y las páginas de área.
   La API es la fuente de datos; aquí solo se normaliza y se pinta. */

export const modalidades = {
  prestamo: 'Préstamo',
  cesion: 'Cesión',
  intercambio: 'Intercambio',
  descarga: 'Documento descargable'
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
  const texto = normalizar(opciones.texto);
  return recursos.filter((recurso) => {
    const enSeccion = seccion === 'todas' || recurso.seccion === seccion;
    const coincide = normalizar(recurso.titulo + ' ' + (recurso.curso ?? '')).includes(texto);
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
  if (respuesta.status === 403) return 'Necesitas una cuenta activa de alumnado o docencia para consultar ' + contexto + '.';
  return cuerpo?.mensaje ?? cuerpo?.error ?? 'No se pudo cargar ' + contexto + '.';
}

function tipoTexto(recurso) {
  if (recurso.seccion === 'biblioteca' && recurso.tipo === 'fisico') {
    return ['Préstamo físico', 't-prestamo'];
  }
  if (recurso.seccion === 'biblioteca') {
    return ['Descarga digital', 't-digital'];
  }
  if (recurso.seccion === 'libros') {
    return ['Anuncio estudiantil', 't-anuncio'];
  }
  if (recurso.seccion === 'documentacion') {
    return ['Descarga digital', 't-digital'];
  }
  if (recurso.tipo === 'enlace') {
    return ['Enlace', 't-digital'];
  }
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
    detalle
  };
}

export function crearTarjeta(recurso) {
  const tarjeta = document.createElement('li');
  tarjeta.className = 'tarjeta';

  const etiqueta = document.createElement('p');
  etiqueta.className = 'etiqueta';
  etiqueta.textContent = [
    secciones[recurso.seccion] ?? recurso.seccion,
    recurso.curso
  ].filter(Boolean).join(' · ');

  const [tipo, clase] = tipoTexto(recurso);
  const insignia = document.createElement('p');
  insignia.className = 'insignia ' + clase;
  insignia.textContent = tipo;

  const titulo = document.createElement('h3');
  titulo.textContent = recurso.titulo;

  const modalidad = document.createElement('p');
  modalidad.textContent = modalidades[recurso.modalidad] ?? recurso.modalidad ?? '';

  const estado = document.createElement('p');
  estado.className = 'estado';
  estado.textContent = [
    estados[recurso.estado] ?? recurso.estado,
    Number.isSafeInteger(recurso.version) ? 'Versión ' + recurso.version : null
  ].filter(Boolean).join(' · ');

  const detalle = document.createElement('p');
  detalle.textContent = recurso.detalle ?? '';

  tarjeta.append(etiqueta, insignia, titulo, modalidad, estado, detalle);
  return tarjeta;
}
