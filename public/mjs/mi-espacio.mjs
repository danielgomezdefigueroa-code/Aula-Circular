/* --- Mi espacio ---
    Perfil de la cuenta y gestión de anuncios propios. La API decide
    permisos y estados; aquí solo se representa y se envían los datos. */
import {
  listo, pedir, enviar, leerJson, leerIdentidad, irALogin, puedeGestionarAnuncios
} from './shell.mjs';

const perfilDatos = document.querySelector('#perfil-datos');
const perfilEstado = document.querySelector('#perfil-estado');
const perfilRoles = document.querySelector('#perfil-roles');
const perfilCursoSolicitado = document.querySelector('#perfil-curso-solicitado');
const perfilCursoConfirmado = document.querySelector('#perfil-curso-confirmado');
const avisoAlumno = document.querySelector('#aviso-alumno');
const enlaceDocencia = document.querySelector('#enlace-docencia');
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
  seccionAnuncios.hidden = !alumno;
  campos.disabled = !alumno;
  avisoAlumno.hidden = alumno;
  enlaceDocencia.hidden = !(datos.estado === 'activo' && datos.roles.includes('docente'));

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
  seccionAnuncios.hidden = true;
  avisoAlumno.hidden = true;
  enlaceDocencia.hidden = true;
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
    mostrar(datos.length
      ? 'Mis anuncios:'
      : 'No hay anuncios propios en esta página.');

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
    if (!puedeGestionarAnuncios(nueva)) return;
    if (!cursosCargados) await cargarCursos();
    await cargar();
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
  }
  mostrarPerfil(identidad);
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
