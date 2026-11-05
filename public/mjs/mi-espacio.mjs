/* --- Mi espacio ---
    Perfil de la cuenta y gestión de anuncios propios. La API decide
    permisos y estados; aquí solo se representa y se envían los datos. */
import {
  listo, pedir, enviar, leerJson, leerIdentidad, irALogin, puedeGestionarAnuncios,
  puedeVerAreas
} from './shell.mjs';

const perfilDatos = document.querySelector('#perfil-datos');
const perfilEstado = document.querySelector('#perfil-estado');
const perfilRoles = document.querySelector('#perfil-roles');
const perfilCursoSolicitado = document.querySelector('#perfil-curso-solicitado');
const perfilCursoConfirmado = document.querySelector('#perfil-curso-confirmado');
const avisoAlumno = document.querySelector('#aviso-alumno');
const seccionAnuncios = document.querySelector('#seccion-anuncios');
const form = document.querySelector('#anuncio');
const campos = document.querySelector('#campos');
const leyenda = document.querySelector('#leyenda');
const guardar = document.querySelector('#guardar');
const mensaje = document.querySelector('#mensaje');
const lista = document.querySelector('#anuncios');
const actualizar = document.querySelector('#actualizar');
const anterior = document.querySelector('#anterior');
const siguiente = document.querySelector('#siguiente');
const paginaTexto = document.querySelector('#pagina');
const detalle = document.querySelector('#detalle');
const historial = document.querySelector('#historial');
const seccionPanel = document.querySelector('#seccion-panel');
const panelMensaje = document.querySelector('#panel-mensaje');
const actualizarPanel = document.querySelector('#actualizar-panel');
const listasPanel = {
  publicaciones: document.querySelector('#lista-publicaciones'),
  solicitudes: document.querySelector('#lista-solicitudes'),
  prestamos: document.querySelector('#lista-prestamos'),
  avisos: document.querySelector('#lista-avisos')
};
const resumenesPanel = {
  publicaciones: document.querySelector('#resumen-publicaciones'),
  solicitudes: document.querySelector('#resumen-solicitudes'),
  prestamos: document.querySelector('#resumen-prestamos'),
  avisos: document.querySelector('#resumen-avisos')
};

const estados = {
  borrador: 'Borrador',
  pendiente: 'Pendiente de revisión',
  publicado: 'Publicado',
  rechazado: 'Rechazado',
  retirado: 'Retirado'
};
const estadosCuenta = {
  pendiente: 'Pendiente de validación',
  activo: 'Activa',
  suspendido: 'Suspendida'
};
const modalidades = {
  cesion: 'Cesión',
  prestamo: 'Préstamo',
  intercambio: 'Intercambio'
};
const estadosSolicitud = {
  pendiente: 'Pendiente',
  adjudicada: 'Adjudicada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada'
};
const estadosOperacion = {
  propuesta: 'Propuesta',
  reservada: 'Reservada',
  prestada: 'Prestada',
  completada: 'Completada',
  cancelada: 'Cancelada',
  cerrada_por_incidencia: 'Cerrada por incidencia'
};
const tiposOperacion = {
  cesion: 'Cesión',
  prestamo: 'Préstamo',
  intercambio: 'Intercambio'
};

let identidad = null;
let edicion = null;
let pagina = 1;
let cursosCargados = false;
let cargando = false;

function mostrar(texto, enfocar = false) {
  mensaje.textContent = texto ?? '';
  if (enfocar) mensaje.focus();
}

function textoError(respuesta, cuerpo) {
  if (respuesta.status === 401) return 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
  if (respuesta.status === 403) return cuerpo?.mensaje ?? 'No tienes permiso para realizar esta acción.';
  if (cuerpo?.campos) {
    return Object.entries(cuerpo.campos)
      .map(([campo, texto]) => campo + ': ' + texto)
      .join('\n');
  }
  return cuerpo?.mensaje ?? cuerpo?.error ?? 'No se pudo completar la acción.';
}

async function leerRespuesta(respuesta) {
  const cuerpo = await leerJson(respuesta);
  if (respuesta.status === 401) {
    irALogin();
    throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión.');
  }
  if (!respuesta.ok) throw new Error(textoError(respuesta, cuerpo));
  return cuerpo ?? {};
}

function fecha(valor) {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? String(valor ?? '') : d.toLocaleString('es-ES');
}

function limpiarPanel() {
  for (const lista of Object.values(listasPanel)) lista.replaceChildren();
  for (const resumen of Object.values(resumenesPanel)) resumen.textContent = '';
  panelMensaje.textContent = '';
}

function textoResumen(total, pendientes, acciones, singular, plural) {
  if (!total) return 'Sin ' + plural + '.';
  const partes = [total + ' ' + (total === 1 ? singular : plural)];
  if (pendientes) partes.push(pendientes + (pendientes === 1 ? ' pendiente' : ' pendientes'));
  if (acciones) partes.push(acciones + (acciones === 1 ? ' requiere tu acción' : ' requieren tu acción'));
  return partes.join(' · ');
}

function estadoOperacionTexto(prestamo) {
  if (prestamo.tipo === 'intercambio') {
    if (prestamo.estado === 'propuesta') {
      return Number(prestamo.aceptaciones) >= 2
        ? 'Esperando confirmación docente'
        : 'Esperando aceptación';
    }
    if (prestamo.estado === 'reservada') return 'Reservado';
    if (prestamo.estado === 'completada') return 'Completado';
    if (prestamo.estado === 'cancelada') return 'Cancelado';
  }
  return estadosOperacion[prestamo.estado] ?? prestamo.estado ?? '';
}

function fechaPanel(valor, etiqueta = 'Fecha') {
  if (!valor) return null;
  const texto = fecha(valor);
  if (!texto) return null;
  const p = document.createElement('p');
  p.className = 'panel-fecha';
  p.textContent = etiqueta + ': ' + texto;
  return p;
}

function vacioPanel(lista, texto) {
  const li = document.createElement('li');
  li.className = 'panel-vacio';
  li.textContent = texto;
  lista.append(li);
}

function contarPanel(totales, seccion, datos) {
  const total = Number(totales?.[seccion]?.total);
  return {
    total: Number.isSafeInteger(total) ? total : datos.length,
    pendientes: Number(totales?.[seccion]?.pendientes) || 0,
    acciones: Number(totales?.[seccion]?.requieren_accion) || 0
  };
}

function renderPanel(cuerpo) {
  const datos = cuerpo?.datos ?? {};
  const totales = cuerpo?.totales ?? {};
  const publicaciones = Array.isArray(datos.publicaciones) ? datos.publicaciones : [];
  const solicitudes = Array.isArray(datos.solicitudes) ? datos.solicitudes : [];
  const prestamos = Array.isArray(datos.prestamos) ? datos.prestamos : [];
  const avisos = Array.isArray(datos.avisos) ? datos.avisos : [];

  const cuentaPublicaciones = contarPanel(totales, 'publicaciones', publicaciones);
  const cuentaSolicitudes = contarPanel(totales, 'solicitudes', solicitudes);
  const cuentaPrestamos = contarPanel(totales, 'prestamos', prestamos);
  const cuentaAvisos = contarPanel(totales, 'avisos', avisos);

  resumenesPanel.publicaciones.textContent = textoResumen(
    cuentaPublicaciones.total, cuentaPublicaciones.pendientes, cuentaPublicaciones.acciones,
    'publicación', 'publicaciones'
  );
  resumenesPanel.solicitudes.textContent = textoResumen(
    cuentaSolicitudes.total, cuentaSolicitudes.pendientes, cuentaSolicitudes.acciones,
    'solicitud', 'solicitudes'
  );
  resumenesPanel.prestamos.textContent = textoResumen(
    cuentaPrestamos.total, cuentaPrestamos.pendientes, cuentaPrestamos.acciones,
    'operación', 'operaciones'
  );
  resumenesPanel.avisos.textContent = textoResumen(
    cuentaAvisos.total, cuentaAvisos.pendientes, cuentaAvisos.acciones,
    'aviso', 'avisos'
  );

  listasPanel.publicaciones.replaceChildren();
  listasPanel.solicitudes.replaceChildren();
  listasPanel.prestamos.replaceChildren();
  listasPanel.avisos.replaceChildren();

  if (!publicaciones.length) vacioPanel(listasPanel.publicaciones, 'No tienes publicaciones.');
  for (const publicacion of publicaciones) {
    const li = document.createElement('li');
    li.className = 'panel-item';
    li.dataset.pendiente = publicacion.requiere_accion ? 'true' : 'false';

    const titulo = document.createElement('h4');
    titulo.textContent = publicacion.titulo ?? 'Publicación';
    const estado = document.createElement('p');
    estado.className = 'etiqueta';
    estado.textContent = (estados[publicacion.estado_revision] ?? publicacion.estado_revision ?? '') +
      (publicacion.requiere_accion ? ' · requiere tu acción' : '');
    const meta = document.createElement('p');
    meta.className = 'metadatos';
    meta.textContent = [
      modalidades[publicacion.modalidad] ?? publicacion.modalidad,
      publicacion.curso,
      publicacion.codigo ? 'Ejemplar: ' + publicacion.codigo : ''
    ].filter(Boolean).join(' · ');

    li.append(titulo, estado, meta);
    const fechaPublicacion = fechaPanel(publicacion.actualizada_en);
    if (fechaPublicacion) li.append(fechaPublicacion);

    const acciones = document.createElement('div');
    acciones.className = 'panel-acciones';
    const ver = document.createElement('button');
    ver.type = 'button';
    ver.className = 'boton-sec';
    ver.textContent = 'Ver detalle';
    ver.addEventListener('click', async () => {
      try {
        await abrir(publicacion.id, false);
        seccionAnuncios.scrollIntoView({ behavior: 'smooth' });
      } catch (error) {
        mostrar(error.message, true);
      }
    });
    acciones.append(ver);
    li.append(acciones);
    listasPanel.publicaciones.append(li);
  }

  if (!solicitudes.length) vacioPanel(listasPanel.solicitudes, 'No tienes solicitudes.');
  for (const solicitud of solicitudes) {
    const li = document.createElement('li');
    li.className = 'panel-item';
    li.dataset.pendiente = solicitud.requiere_accion ? 'true' : 'false';

    const titulo = document.createElement('h4');
    titulo.textContent = solicitud.titulo ?? 'Solicitud';
    const estado = document.createElement('p');
    estado.className = 'etiqueta';
    estado.textContent = (estadosSolicitud[solicitud.estado] ?? solicitud.estado ?? '') +
      (solicitud.requiere_accion ? ' · requiere tu acción' : '');
    const meta = document.createElement('p');
    meta.className = 'metadatos';
    meta.textContent = [
      solicitud.curso,
      solicitud.codigo ? 'Ejemplar: ' + solicitud.codigo : '',
      modalidades[solicitud.modalidad] ?? solicitud.modalidad
    ].filter(Boolean).join(' · ');

    li.append(titulo, estado, meta);
    const fechaSolicitud = fechaPanel(solicitud.creada_en);
    if (fechaSolicitud) li.append(fechaSolicitud);

    if (solicitud.estado === 'pendiente') {
      const acciones = document.createElement('div');
      acciones.className = 'panel-acciones';
      const cancelar = document.createElement('button');
      cancelar.type = 'button';
      cancelar.className = 'boton-sec';
      cancelar.textContent = 'Cancelar solicitud';
      cancelar.addEventListener('click', () => cancelarSolicitud(solicitud.id, cancelar));
      acciones.append(cancelar);
      li.append(acciones);
    }
    listasPanel.solicitudes.append(li);
  }

  if (!prestamos.length) vacioPanel(listasPanel.prestamos, 'No tienes préstamos ni intercambios.');
  for (const prestamo of prestamos) {
    const li = document.createElement('li');
    li.className = 'panel-item';
    li.dataset.pendiente = prestamo.requiere_accion ? 'true' : 'false';

    const titulo = document.createElement('h4');
    titulo.textContent = prestamo.titulos || ('Operación #' + prestamo.id);
    const estado = document.createElement('p');
    estado.className = 'etiqueta';
    const estadoTexto = estadoOperacionTexto(prestamo);
    const aceptaciones = prestamo.tipo === 'intercambio' && prestamo.estado === 'propuesta'
      ? ' · ' + (Number(prestamo.aceptaciones) || 0) + ' de 2 aceptaciones'
      : '';
    estado.textContent = [
      tiposOperacion[prestamo.tipo] ?? prestamo.tipo,
      estadoTexto + aceptaciones
    ].filter(Boolean).join(': ') + (prestamo.requiere_accion ? ' · requiere tu acción' : '');
    const meta = document.createElement('p');
    meta.className = 'metadatos';
    meta.textContent = [
      prestamo.rol === 'intercambio' ? 'Intercambio' :
        prestamo.rol === 'origen' ? 'Como origen' : 'Como destinatario',
      'Operación #' + prestamo.id
    ].filter(Boolean).join(' · ');

    li.append(titulo, estado, meta);
    const fechaPrestamo = fechaPanel(prestamo.creada_en);
    if (fechaPrestamo) li.append(fechaPrestamo);
    if (prestamo.entregada_en) {
      const entrega = fechaPanel(prestamo.entregada_en, 'Entrega');
      if (entrega) li.append(entrega);
    }

    const acciones = document.createElement('div');
    acciones.className = 'panel-acciones';
    const enlace = document.createElement('a');
    const esIntercambio = prestamo.tipo === 'intercambio';
    enlace.href = esIntercambio
      ? 'intercambios.html?operacion=' + prestamo.id
      : 'cesiones.html';
    enlace.textContent = esIntercambio
      ? (prestamo.requiere_accion ? 'Revisar intercambio' : 'Ver intercambio')
      : (prestamo.requiere_accion ? 'Revisar propuesta' : 'Ver en Cesiones');
    acciones.append(enlace);
    li.append(acciones);
    listasPanel.prestamos.append(li);
  }

  if (!avisos.length) vacioPanel(listasPanel.avisos, 'No tienes avisos.');
  for (const aviso of avisos) {
    const li = document.createElement('li');
    li.className = 'panel-item';
    li.dataset.pendiente = 'false';

    const mensajeAviso = document.createElement('p');
    mensajeAviso.className = 'detalle';
    mensajeAviso.textContent = aviso.mensaje ?? '';
    li.append(mensajeAviso);
    const fechaAviso = fechaPanel(aviso.creado_en);
    if (fechaAviso) li.append(fechaAviso);
    if (aviso.operacion_id) {
      const acciones = document.createElement('div');
      acciones.className = 'panel-acciones';
      const enlace = document.createElement('a');
      enlace.href = 'cesiones.html';
      enlace.textContent = 'Ver operación #' + aviso.operacion_id;
      acciones.append(enlace);
      li.append(acciones);
    }
    listasPanel.avisos.append(li);
  }
}

async function cargarPanel() {
  if (!identidad || identidad.estado !== 'activo' || !puedeVerAreas(identidad)) {
    seccionPanel.hidden = true;
    limpiarPanel();
    return;
  }
  seccionPanel.hidden = false;
  panelMensaje.textContent = 'Cargando resumen…';
  try {
    const respuesta = await pedir('/mi-espacio/panel');
    renderPanel(await leerRespuesta(respuesta));
    panelMensaje.textContent = '';
  } catch (error) {
    panelMensaje.textContent = error.message;
  }
}

async function cancelarSolicitud(id, boton) {
  if (!confirm('¿Cancelar esta solicitud?')) return;
  boton.disabled = true;
  try {
    await leerRespuesta(await enviar('/solicitudes/' + id + '/cancelar', {}));
    await cargarPanel();
    mostrar('Solicitud cancelada.');
  } catch (error) {
    mostrar(error.message, true);
    boton.disabled = false;
  }
}

function limpiarLista() {
  lista.replaceChildren();
  historial.replaceChildren();
  detalle.hidden = true;
  pagina = 1;
  paginaTexto.textContent = '';
  anterior.disabled = true;
  siguiente.disabled = true;
}

function nuevo() {
  edicion = null;
  form.reset();
  leyenda.textContent = 'Nuevo borrador';
  guardar.textContent = 'Guardar borrador';
  detalle.hidden = true;
  historial.replaceChildren();
}

function mostrarPerfil(datos) {
  perfilDatos.hidden = false;
  perfilEstado.textContent = estadosCuenta[datos.estado] ?? datos.estado ?? '';
  perfilRoles.textContent = datos.roles.length ? datos.roles.join(', ') : 'Sin roles';
  perfilCursoSolicitado.textContent = datos.curso_solicitado ?? 'Sin curso solicitado';
  perfilCursoConfirmado.textContent = datos.curso_confirmado ?? 'Pendiente de confirmación';

  const alumno = puedeGestionarAnuncios(datos);
  const panel = datos.estado === 'activo' && puedeVerAreas(datos);
  seccionPanel.hidden = !panel;
  if (!panel) limpiarPanel();
  seccionAnuncios.hidden = !alumno;
  campos.disabled = !alumno;
  avisoAlumno.hidden = alumno;

  if (!alumno) {
    avisoAlumno.textContent = datos.estado === 'suspendido'
      ? 'Tu cuenta está suspendida. Consulta con el profesorado.'
      : datos.estado !== 'activo'
        ? 'Tu cuenta está pendiente de validación. Cuando se active podrás gestionar anuncios.'
        : 'La gestión de anuncios está disponible para cuentas de alumnado activas.';
    limpiarLista();
    nuevo();
    mostrar('');
  }
}

function limpiarTodo() {
  perfilDatos.hidden = true;
  seccionPanel.hidden = true;
  seccionAnuncios.hidden = true;
  avisoAlumno.hidden = true;
  limpiarPanel();
  limpiarLista();
  nuevo();
  mostrar('');
}

async function cargarCursos() {
  const cuerpo = await leerRespuesta(await pedir('/cursos'));
  const cursos = Array.isArray(cuerpo.datos) ? cuerpo.datos : [];
  const select = document.querySelector('#curso');
  select.replaceChildren();
  const inicial = document.createElement('option');
  inicial.value = '';
  inicial.textContent = 'Selecciona un curso';
  select.append(inicial);
  let validos = 0;
  for (const curso of cursos) {
    if (!Number.isSafeInteger(curso.id) || typeof curso.nombre !== 'string') continue;
    const opcion = document.createElement('option');
    opcion.value = String(curso.id);
    opcion.textContent = curso.nombre;
    select.append(opcion);
    validos += 1;
  }
  cursosCargados = validos > 0;
  select.disabled = !cursosCargados;
  guardar.disabled = !cursosCargados;
  if (!cursosCargados) throw new Error('No hay cursos activos para crear anuncios.');
}

async function refrescarIdentidad() {
  const cuerpo = await leerRespuesta(await pedir('/yo'));
  const nueva = leerIdentidad(cuerpo);
  const cambiaUsuario = nueva.id !== identidad?.id;
  identidad = nueva;
  if (cambiaUsuario) {
    pagina = 1;
    nuevo();
    limpiarPanel();
  }
  mostrarPerfil(identidad);
  return identidad;
}

async function cargar() {
  if (!identidad || !puedeGestionarAnuncios(identidad) || cargando) return;
  cargando = true;
  anterior.disabled = true;
  siguiente.disabled = true;
  try {
    const respuesta = await pedir('/mi-espacio?' + new URLSearchParams({ pagina, limite: 20 }));
    const cuerpo = await leerRespuesta(respuesta);
    const datos = Array.isArray(cuerpo.datos) ? cuerpo.datos : [];
    lista.replaceChildren();
    detalle.hidden = true;
    historial.replaceChildren();
    paginaTexto.textContent = 'Página ' + pagina;
    anterior.disabled = pagina === 1;
    siguiente.disabled = datos.length < 20;
    mostrar(datos.length ? '' : 'No hay anuncios propios en esta página.');

    for (const anuncio of datos) {
      const tarjeta = document.createElement('li');
      tarjeta.className = 'tarjeta';
      const titulo = document.createElement('h3');
      titulo.textContent = anuncio.titulo;
      const estado = document.createElement('p');
      estado.className = 'etiqueta';
      estado.textContent = estados[anuncio.estado_revision] ?? anuncio.estado_revision;
      const datosAnuncio = document.createElement('p');
      datosAnuncio.textContent = [
        modalidades[anuncio.modalidad] ?? anuncio.modalidad,
        anuncio.curso,
        'versión ' + anuncio.version
      ].filter(Boolean).join(' · ');
      const codigo = document.createElement('p');
      codigo.textContent = 'Ejemplar: ' + anuncio.codigo;
      tarjeta.append(titulo, estado, datosAnuncio, codigo);
      if (anuncio.motivo) {
        const motivo = document.createElement('p');
        motivo.textContent = 'Motivo de revisión anterior: ' + anuncio.motivo;
        tarjeta.append(motivo);
      }

      const acciones = document.createElement('div');
      acciones.className = 'acciones-tarjeta';
      const ver = document.createElement('button');
      ver.type = 'button';
      ver.className = 'boton-sec';
      ver.textContent = 'Ver detalle e historial';
      ver.addEventListener('click', () => abrir(anuncio.id, false).catch((error) => mostrar(error.message, true)));
      acciones.append(ver);

      if (['borrador', 'rechazado', 'publicado'].includes(anuncio.estado_revision)) {
        const editar = document.createElement('button');
        editar.type = 'button';
        editar.className = 'boton-sec';
        editar.textContent = 'Editar';
        editar.addEventListener('click', () => abrir(anuncio.id, true).catch((error) => mostrar(error.message, true)));
        acciones.append(editar);
      }

      if (['borrador', 'rechazado'].includes(anuncio.estado_revision)) {
        const enviarRevision = document.createElement('button');
        enviarRevision.type = 'button';
        enviarRevision.textContent = 'Enviar a revisión';
        enviarRevision.addEventListener('click', async () => {
          enviarRevision.disabled = true;
          try {
            const respuestaEnvio = await enviar(
              '/anuncios/' + anuncio.id + '/enviar',
              { version: anuncio.version }
            );
            const cuerpoEnvio = await leerRespuesta(respuestaEnvio);
            if (edicion?.id === anuncio.id) nuevo();
            await cargar();
            await cargarPanel();
            mostrar(cuerpoEnvio.mensaje ?? 'Enviado a revisión.');
          } catch (error) {
            mostrar(error.message, true);
            enviarRevision.disabled = false;
          }
        });
        acciones.append(enviarRevision);
      }

      tarjeta.append(acciones);
      lista.append(tarjeta);
    }
  } finally {
    cargando = false;
  }
}

async function abrir(id, enEdicion) {
  // Ver el detalle de otro anuncio no debe reutilizar el formulario de edición anterior.
  if (!enEdicion) nuevo();
  else edicion = null;
  const cuerpo = await leerRespuesta(await pedir('/anuncios/' + id));
  const anuncio = cuerpo.datos;
  const eventos = Array.isArray(cuerpo.historial) ? cuerpo.historial : [];
  historial.replaceChildren();
  for (const evento of eventos) {
    const item = document.createElement('li');
    item.textContent = [
      fecha(evento.creada_en),
      evento.accion + ': ' + (estados[evento.estado_anterior] ?? 'inicio') +
        ' → ' + (estados[evento.estado_nuevo] ?? evento.estado_nuevo),
      evento.motivo ? '. ' + evento.motivo : ''
    ].join(' ');
    historial.append(item);
  }
  detalle.hidden = false;

  if (enEdicion) {
    for (const nombre of ['titulo', 'descripcion', 'cursoId', 'asignatura', 'edicion', 'isbn', 'conservacion', 'modalidad']) {
      const campo = form.elements.namedItem(nombre);
      if (campo) campo.value = anuncio[nombre] ?? '';
    }
    edicion = { id: anuncio.id, version: anuncio.version };
    leyenda.textContent = 'Editar anuncio ' + anuncio.id;
    guardar.textContent = 'Guardar cambios';
    form.scrollIntoView({ behavior: 'smooth' });
    if (anuncio.estado_revision === 'publicado') {
      mostrar('Si cambias sus datos, dejará de aparecer en Libros y necesitará una nueva revisión.');
    }
  } else {
    mostrar(`Anuncio ${anuncio.id}: ${anuncio.titulo}. ` +
      `${estados[anuncio.estado_revision] ?? anuncio.estado_revision}. ` +
      `${anuncio.conservacion}`);
  }
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  guardar.disabled = true;
  const datos = Object.fromEntries(new FormData(form));
  datos.cursoId = Number(datos.cursoId);
  try {
    if (edicion) datos.version = edicion.version;
    const respuesta = await enviar(
      edicion ? '/anuncios/' + edicion.id : '/anuncios',
      datos,
      edicion ? 'PATCH' : 'POST'
    );
    const cuerpo = await leerRespuesta(respuesta);
    nuevo();
    pagina = 1;
    await cargar();
    await cargarPanel();
    mostrar(cuerpo.mensaje ?? 'Anuncio guardado.');
  } catch (error) {
    mostrar(error.message, true);
  } finally {
    guardar.disabled = false;
  }
});

document.querySelector('#nuevo').addEventListener('click', nuevo);
actualizar.addEventListener('click', async () => {
  try {
    const nueva = await refrescarIdentidad();
    await cargarPanel();
    if (!puedeGestionarAnuncios(nueva)) return;
    if (!cursosCargados) await cargarCursos();
    await cargar();
  } catch (error) {
    mostrar(error.message, true);
  }
});

actualizarPanel.addEventListener('click', async () => {
  try {
    await refrescarIdentidad();
    await cargarPanel();
  } catch (error) {
    mostrar(error.message, true);
  }
});

anterior.addEventListener('click', async () => {
  if (pagina === 1) return;
  pagina -= 1;
  try {
    await cargar();
  } catch (error) {
    mostrar(error.message, true);
  }
});

siguiente.addEventListener('click', async () => {
  pagina += 1;
  try {
    await cargar();
  } catch (error) {
    mostrar(error.message, true);
  }
});

document.addEventListener('aula:sesion', async (evento) => {
  const nueva = evento.detail;
  if (!nueva) {
    identidad = null;
    limpiarTodo();
    return;
  }
  const cambiaUsuario = nueva.id !== identidad?.id;
  identidad = nueva;
  if (cambiaUsuario) {
    pagina = 1;
    nuevo();
    limpiarPanel();
  }
  mostrarPerfil(identidad);
  await cargarPanel();
  if (!puedeGestionarAnuncios(identidad)) return;
  if (!cursosCargados) {
    try {
      await cargarCursos();
    } catch (error) {
      mostrar(error.message, true);
    }
  }
  try {
    await cargar();
  } catch (error) {
    mostrar(error.message, true);
  }
});

try {
  identidad = await listo;
  if (identidad) {
    mostrarPerfil(identidad);
    await cargarPanel();
    if (puedeGestionarAnuncios(identidad)) {
      try {
        await cargarCursos();
      } catch (error) {
        mostrar(error.message, true);
      }
      try {
        await cargar();
      } catch (error) {
        mostrar(error.message, true);
      }
    }
  }
} catch (error) {
  mostrar(error.message, true);
}
