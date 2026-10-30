/* Utilidades compartidas por el catálogo de Inicio y las páginas de área.
   La API es la fuente de datos; aquí solo se normaliza y se pinta. */

export const modalidades = {
  prestamo: 'Préstamo',
  cesion: 'Cesión',
  intercambio: 'Intercambio',
  descarga: 'Documento del centro',
  digital: 'Consulta digital',
  enlace: 'Consulta en línea'
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
  if (respuesta.status === 403) return 'Necesitas una cuenta activa de alumnado o docencia para consultar ' + contexto + '.';
  return cuerpo?.mensaje ?? cuerpo?.error ?? 'No se pudo cargar ' + contexto + '.';
}

function tipoTexto(recurso) {
  if (recurso.tipo === 'enlace') {
    return ['Enlace', 't-digital'];
  }
  if (recurso.seccion === 'biblioteca' && recurso.tipo === 'fisico') {
    return ['Préstamo físico', 't-prestamo'];
  }
  if (recurso.seccion === 'biblioteca') {
    return ['Recurso digital', 't-digital'];
  }
  if (recurso.seccion === 'libros') {
    return ['Anuncio estudiantil', 't-anuncio'];
  }
  if (recurso.seccion === 'documentacion') {
    return ['Documentación', 't-digital'];
  }
  return ['Recurso digital', 't-digital'];
}

export function normalizarLibro(anuncio) {
  return {
    ...anuncio,
    seccion: 'libros',
    tipo: 'fisico',
    estado: 'publicado',
    procedencia: anuncio.procedencia ?? 'Estudiantil',
    detalle: anuncio.descripcion ?? anuncio.detalle ?? ''
  };
}

function parrafo(clase, texto) {
  const elemento = document.createElement('p');
  elemento.className = clase;
  elemento.textContent = texto;
  return elemento;
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
    recurso.asignatura ? 'Asignatura: ' + recurso.asignatura : null,
    recurso.edicion ? 'Edición: ' + recurso.edicion : null,
    recurso.isbn ? 'ISBN: ' + recurso.isbn : null,
    recurso.conservacion ? 'Conservación: ' + recurso.conservacion : null
  ].filter(Boolean).join(' · ');
  const metadatos = metadatosTexto ? parrafo('metadatos', metadatosTexto) : null;

  const detalleTexto = recurso.detalle ?? recurso.descripcion ?? '';
  const detalle = detalleTexto ? parrafo('detalle', detalleTexto) : null;

  tarjeta.append(...[etiqueta, insignia, titulo, modalidad, estado, codigo, metadatos, detalle]
    .filter(Boolean));
  return tarjeta;
}
