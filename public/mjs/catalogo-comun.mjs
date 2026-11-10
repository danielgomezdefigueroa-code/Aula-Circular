/* Utilidades compartidas por el catálogo de Inicio y las páginas de área.
   La API es la fuente de datos; aquí solo se normaliza y se pinta. */

export const modalidades = {
  prestamo: 'Préstamo físico',
  cesion: 'Cesión',
  intercambio: 'Intercambio',
  descarga: 'Documento descargable',
  consulta: 'Material digital de consulta',
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
  if (recurso.seccion === 'biblioteca') {
    if (recurso.tipo === 'fisico') {
      return ['Préstamo físico', 't-prestamo'];
    }

    if (recurso.tipo === 'enlace') {
      return ['Enlace educativo', 't-digital'];
    }

    if (recurso.tipo === 'digital') {
      return ['Material digital', 't-digital'];
    }
  }

  if (recurso.seccion === 'libros') {
    return ['Anuncio estudiantil', 't-anuncio'];
  }

  if (recurso.seccion === 'documentacion') {
    return ['Descarga digital', 't-digital'];
  }

  return ['Recurso', 't-digital'];
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

  if (
  recurso.seccion === 'biblioteca' &&
  recurso.tipo === 'fisico' &&
  Number.isInteger(recurso.total_ejemplares) &&
  Number.isInteger(recurso.ejemplares_disponibles)
) {
  const disponibilidad = document.createElement('p');
  disponibilidad.className = 'disponibilidad';

  const total = recurso.total_ejemplares;
  const disponibles = recurso.ejemplares_disponibles;

  disponibilidad.textContent =
    `${disponibles} de ${total} ` +
    `${total === 1 ? 'ejemplar' : 'ejemplares'} ` +
    `${disponibles === 1 ? 'disponible' : 'disponibles'}`;

  tarjeta.append(disponibilidad);
}

  // Descarga autorizada de la versión vigente.
  if (
    recurso.seccion === 'documentacion' &&
    recurso.modalidad === 'descarga' &&
    Number.isSafeInteger(recurso.version_id)
  ) {
    const acciones = document.createElement('div');
    acciones.className = 'acciones-tarjeta';

    const enlace = document.createElement('a');
    enlace.className = 'boton-sec enlace-descarga';
    enlace.href =
      `/api/documentos/versiones/${recurso.version_id}/descargar`;
    enlace.textContent = 'Descargar PDF';

    acciones.append(enlace);
    tarjeta.append(acciones);
  }

  // Acción segura para enlaces educativos.
  if (
    recurso.seccion === 'biblioteca' &&
    recurso.tipo === 'enlace' &&
    recurso.url_externa
  ) {
    let destino;

    try {
      destino = new URL(recurso.url_externa);
    } catch {
      destino = null;
    }

    if (
      destino &&
      ['https:', 'http:'].includes(destino.protocol)
    ) {
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

  return tarjeta;

}
