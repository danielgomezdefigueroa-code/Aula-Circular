/* Intercambios: propuestas, aceptación, rechazo y gestión docente.
   La sesión, la propiedad, la disponibilidad y las reservas las decide
   el servidor; aquí solo se representan y se envían acciones. */
import {
  listo, pedir, enviar, leerJson, irALogin, leerIdentidad
} from './shell.mjs';

const mensaje = document.querySelector('#mensaje');
const lista = document.querySelector('#lista-intercambios');
const paginacion = document.querySelector('#paginacion');
const anterior = document.querySelector('#anterior');
const siguiente = document.querySelector('#siguiente');
const paginaTexto = document.querySelector('#pagina');
const actualizar = document.querySelector('#actualizar');
const ayudaLista = document.querySelector('#ayuda-lista');
const tituloLista = document.querySelector('#titulo-lista');
const detalle = document.querySelector('#detalle');
const detalleTitulo = document.querySelector('#detalle-titulo');
const detalleEstado = document.querySelector('#detalle-estado');
const detalleMensaje = document.querySelector('#detalle-mensaje');
const datosOfrecido = document.querySelector('#datos-ofrecido');
const datosSolicitado = document.querySelector('#datos-solicitado');
const acciones = document.querySelector('#acciones-intercambio');
const cerrarDetalle = document.querySelector('#cerrar-detalle');

const limite = 20;
let identidad = null;
let pagina = 1;
let ultimoDisparador = null;
let abriendo = false;

const etiquetas = {
  propuesta: 'Propuesta',
  reservada: 'Reservado',
  completada: 'Completado',
  cancelada: 'Cancelado'
};

function mostrar(texto, enfocar = false) {
  mensaje.textContent = texto ?? '';
  if (enfocar) mensaje.focus();
}

function mensajeError(cuerpo) {
  const codigo = cuerpo?.mensaje ?? cuerpo?.error ?? 'No se pudo completar la acción.';
  const traducciones = {
    ACUERDO_DESACTUALIZADO: 'El acuerdo ha cambiado. Actualiza el detalle antes de repetir la acción.',
    PROPUESTA_NO_VIGENTE: 'La propuesta ya no está vigente. Actualiza el detalle.',
    PROPUESTA_YA_ACEPTADA: 'Ya has aceptado esta propuesta. No puedes rechazarla después.',
    PROPUESTA_YA_EXISTENTE: 'Ya existe una propuesta igual pendiente.',
    EJEMPLAR_OCUPADO: 'Uno de los ejemplares ya está ocupado. Actualiza el detalle.',
    PARTICIPANTES_NO_ACTIVOS: 'Una de las cuentas ya no está activa. La operación no se puede completar.',
    PERMISO_INSUFICIENTE: 'No tienes permiso para realizar esta acción.',
    OPERACION_NO_RESERVADA: 'La operación no está reservada.',
    DATOS_INVALIDOS: 'La petición no tiene los datos esperados.'
  };
  return traducciones[cuerpo?.error] ?? codigo;
}

function estadoTexto(datos) {
  const aceptaciones = Number(datos.aceptaciones) || 0;
  if (datos.estado === 'propuesta') {
    return aceptaciones >= 2
      ? 'Esperando confirmación docente · 2 de 2 aceptaciones'
      : 'Esperando aceptación · ' + aceptaciones + ' de 2 aceptaciones';
  }
  if (datos.estado === 'reservada') return 'Reservado para entrega';
  if (datos.estado === 'completada') return 'Completado';
  if (datos.estado === 'cancelada') return 'Cancelado';
  return etiquetas[datos.estado] ?? datos.estado ?? 'Estado desconocido';
}

function fila(dl, etiqueta, valor) {
  if (valor === undefined || valor === null || valor === '') return;
  const dt = document.createElement('dt');
  dt.textContent = etiqueta;
  const dd = document.createElement('dd');
  dd.textContent = String(valor);
  dl.append(dt, dd);
}

function pintarFicha(dl, datos, lado) {
  dl.replaceChildren();
  if (!datos) return;
  const titulo = lado === 'ofrecido' ? datos.tituloOfrecido : datos.tituloSolicitado;
  const edicion = lado === 'ofrecido' ? datos.edicionOfrecida : datos.edicionSolicitada;
  const conservacion = lado === 'ofrecido' ? datos.conservacionOfrecida : datos.conservacionSolicitada;
  const propietario = lado === 'ofrecido' ? datos.propietarioOfrecido : datos.propietarioSolicitado;
  const codigo = lado === 'ofrecido' ? datos.codigoOfrecido : datos.codigoSolicitado;
  const asignatura = lado === 'ofrecido' ? datos.asignaturaOfrecida : datos.asignaturaSolicitada;
  fila(dl, 'Título', titulo);
  fila(dl, 'Edición', edicion);
  fila(dl, 'Conservación', conservacion);
  fila(dl, 'Propietario', propietario);
  fila(dl, 'Código', codigo);
  fila(dl, 'Asignatura', asignatura);
}

function esDocente() {
  return Array.isArray(identidad?.roles) && identidad.roles.includes('docente');
}

function esAlumno() {
  return Array.isArray(identidad?.roles) && identidad.roles.includes('alumno');
}

function crearBoton(texto, clase, accion) {
  const boton = document.createElement('button');
  boton.type = 'button';
  if (clase) boton.className = clase;
  boton.textContent = texto;
  boton.addEventListener('click', () => accion(boton));
  return boton;
}

async function ejecutar(accion, boton, textoOcupado) {
  const original = boton.textContent;
  boton.disabled = true;
  boton.textContent = textoOcupado;
  detalleMensaje.textContent = '';
  try {
    const respuesta = await accion();
    const cuerpo = await leerJson(respuesta);
    if (respuesta.status === 401) {
      irALogin();
      return;
    }
    if (!respuesta.ok) {
      detalleMensaje.textContent = mensajeError(cuerpo);
      detalleMensaje.focus();
      return false;
    }
    return cuerpo;
  } catch {
    detalleMensaje.textContent = 'No se pudo contactar con el servidor. Inténtalo de nuevo.';
    detalleMensaje.focus();
    return false;
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
}

function crearAcciones(datos) {
  acciones.replaceChildren();
  const id = datos.id;
  if (esDocente()) {
    if (datos.estado === 'propuesta' && Number(datos.aceptaciones) >= 2) {
      acciones.append(crearBoton('Reservar intercambio', '', async (boton) => {
        const cuerpo = await ejecutar(
          () => enviar('/gestion/intercambios/' + id + '/reservar', {}), boton, 'Reservando…'
        );
        if (!cuerpo) return;
        await abrirDetalle(id, ultimoDisparador, 'Intercambio reservado por el docente.');
      }));
    }
    if (datos.estado === 'reservada') {
      acciones.append(crearBoton('Confirmar entrega definitiva', '', async (boton) => {
        if (!confirm('¿Confirmas que se han entregado los dos ejemplares definitivamente?')) return;
        const cuerpo = await ejecutar(
          () => enviar('/gestion/operaciones/' + id + '/entregar', {}), boton, 'Confirmando…'
        );
        if (!cuerpo) return;
        await abrirDetalle(id, ultimoDisparador, 'Entrega confirmada. Intercambio completado.');
      }));
      acciones.append(crearBoton('Cancelar reserva', 'boton-sec', async (boton) => {
        const motivo = prompt('Motivo de la cancelación antes de la entrega:');
        if (motivo === null) return;
        if (!motivo.trim()) {
          detalleMensaje.textContent = 'Escribe un motivo para cancelar la reserva.';
          detalleMensaje.focus();
          return;
        }
        const cuerpo = await ejecutar(
          () => enviar('/gestion/operaciones/' + id + '/cancelar', { motivo: motivo.trim() }),
          boton, 'Cancelando…'
        );
        if (!cuerpo) return;
        await abrirDetalle(id, ultimoDisparador, 'Reserva cancelada. Los ejemplares quedan libres.');
      }));
    }
    if (datos.estado === 'propuesta' && Number(datos.aceptaciones) < 2) {
      const espera = document.createElement('p');
      espera.className = 'ayuda';
      espera.textContent = 'Todavía falta la aceptación del receptor. No se puede reservar.';
      acciones.append(espera);
    }
    return;
  }

  if (datos.puedeAceptar) {
    acciones.append(crearBoton('Aceptar intercambio', '', async (boton) => {
      const cuerpo = await ejecutar(() => enviar('/intercambios/' + id + '/aceptar', {
        ejemplarOfrecidoId: datos.ejemplarOfrecidoId,
        ejemplarSolicitadoId: datos.ejemplarSolicitadoId,
        versionOfrecida: datos.versionOfrecida,
        versionSolicitada: datos.versionSolicitada,
        confirmoAceptacion: true
      }), boton, 'Aceptando…');
      if (!cuerpo) return;
      await abrirDetalle(id, ultimoDisparador, 'Aceptación registrada. Pendiente de confirmación docente.');
    }));
    acciones.append(crearBoton('Rechazar propuesta', 'boton-sec', async (boton) => {
      if (!confirm('¿Rechazar esta propuesta de intercambio?')) return;
      const cuerpo = await ejecutar(
        () => enviar('/intercambios/' + id + '/rechazar', {}), boton, 'Rechazando…'
      );
      if (!cuerpo) return;
      await abrirDetalle(id, ultimoDisparador, 'Propuesta rechazada. El servidor la ha cancelado.');
    }));
  } else if (datos.esReceptor && datos.estado === 'propuesta') {
    const espera = document.createElement('p');
    espera.className = 'ayuda';
    espera.textContent = 'Has aceptado. Esperando la confirmación del docente.';
    acciones.append(espera);
  } else if (datos.esProponente && datos.estado === 'propuesta') {
    const espera = document.createElement('p');
    espera.className = 'ayuda';
    espera.textContent = 'Esperando la aceptación del receptor.';
    acciones.append(espera);
  }
}

async function cargarDetalle(id) {
  const respuesta = await pedir('/intercambios/' + id);
  const cuerpo = await leerJson(respuesta);
  if (respuesta.status === 401) {
    irALogin();
    return null;
  }
  if (!respuesta.ok) {
    detalleMensaje.textContent = mensajeError(cuerpo);
    detalleMensaje.focus();
    return null;
  }
  return cuerpo?.datos ?? null;
}

function pintarDetalle(datos) {
  detalleTitulo.textContent = 'Intercambio #' + datos.id;
  detalleEstado.textContent = estadoTexto(datos);
  pintarFicha(datosOfrecido, datos, 'ofrecido');
  pintarFicha(datosSolicitado, datos, 'solicitado');
  crearAcciones(datos);
}

async function abrirDetalle(id, disparador = null, textoConfirmacion = '') {
  if (abriendo) return;
  abriendo = true;
  if (disparador) ultimoDisparador = disparador;
  detalle.hidden = false;
  detalleMensaje.textContent = 'Cargando detalle…';
  detalleTitulo.focus();
  try {
    const datos = await cargarDetalle(id);
    if (!datos) return;
    pintarDetalle(datos);
    detalleMensaje.textContent = textoConfirmacion;
    if (textoConfirmacion) {
      cerrarDetalle.focus();
    } else {
      detalleTitulo.focus();
    }
  } finally {
    abriendo = false;
  }
}

function cerrar() {
  detalle.hidden = true;
  detalleMensaje.textContent = '';
  const destino = ultimoDisparador && document.contains(ultimoDisparador)
    ? ultimoDisparador
    : actualizar;
  destino.focus();
}

function crearTarjeta(datos) {
  const li = document.createElement('li');
  li.className = 'tarjeta';
  const titulo = document.createElement('h3');
  titulo.textContent = (datos.tituloOfrecido || 'Ejemplar ofrecido') +
    ' ↔ ' + (datos.tituloSolicitado || 'Ejemplar solicitado');
  const estado = document.createElement('p');
  estado.className = 'etiqueta';
  estado.textContent = estadoTexto(datos);
  const props = document.createElement('p');
  props.className = 'metadatos';
  props.textContent = [
    'Ofrece: ' + (datos.propietarioOfrecido || '—'),
    'Solicita: ' + (datos.propietarioSolicitado || '—'),
    'Operación #' + datos.id
  ].join(' · ');
  const fechas = document.createElement('p');
  fechas.className = 'metadatos';
  fechas.textContent = 'Creada: ' + (datos.creada_en
    ? new Date(datos.creada_en).toLocaleString('es-ES')
    : '—');

  const boton = crearBoton('Ver detalle', 'boton-sec', () => {
    abrirDetalle(datos.id, boton);
  });
  const accionesTarjeta = document.createElement('div');
  accionesTarjeta.className = 'acciones-tarjeta';
  accionesTarjeta.append(boton);
  li.append(titulo, estado);
  if (datos.puedeAceptar) {
    const pendiente = document.createElement('span');
    pendiente.className = 'panel-etiqueta-accion';
    pendiente.textContent = 'Requiere tu acción';
    li.append(pendiente);
  }
  li.append(props, fechas, accionesTarjeta);
  return li;
}

async function cargar() {
  if (!identidad || identidad.estado !== 'activo' || (!esAlumno() && !esDocente())) {
    lista.replaceChildren();
    paginacion.hidden = true;
    mostrar('Necesitas una cuenta activa de alumnado o docencia para ver intercambios.');
    return;
  }
  const docente = esDocente();
  tituloLista.textContent = docente ? 'Todos los intercambios' : 'Mis intercambios';
  ayudaLista.textContent = docente
    ? 'El docente puede reservar cuando hay dos aceptaciones, confirmar la entrega o cancelar una reserva.'
    : 'Propuestas en las que participas. La disponibilidad y las reservas las decide el servidor.';
  lista.setAttribute('aria-busy', 'true');
  anterior.disabled = true;
  siguiente.disabled = true;
  mostrar('Cargando…');
  try {
    const ruta = (docente ? '/gestion/intercambios?' : '/intercambios?') +
      new URLSearchParams({ pagina: String(pagina), limite: String(limite) });
    const respuesta = await pedir(ruta);
    const cuerpo = await leerJson(respuesta);
    if (respuesta.status === 401) {
      irALogin();
      return;
    }
    if (!respuesta.ok) {
      lista.replaceChildren();
      paginacion.hidden = true;
      mostrar(mensajeError(cuerpo), true);
      return;
    }
    const datos = Array.isArray(cuerpo?.datos) ? cuerpo.datos : [];
    lista.replaceChildren(...datos.map(crearTarjeta));
    paginaTexto.textContent = 'Página ' + pagina;
    anterior.disabled = pagina <= 1;
    siguiente.disabled = datos.length < limite;
    paginacion.hidden = datos.length === 0;
    mostrar(datos.length
      ? (docente
        ? 'Intercambios cargados. El estado y las aceptaciones vienen del servidor.'
        : 'Propuestas cargadas. Puedes abrir el detalle para aceptar o rechazar.')
      : 'No hay intercambios que mostrar.');
  } catch {
    lista.replaceChildren();
    paginacion.hidden = true;
    mostrar('No se pudo contactar con el servidor. Inténtalo de nuevo.', true);
  } finally {
    lista.setAttribute('aria-busy', 'false');
  }
}

function idDeUrl() {
  const valor = new URLSearchParams(location.search).get('operacion');
  const id = Number(valor);
  return /^[1-9]\d*$/.test(valor ?? '') && Number.isSafeInteger(id) && id > 0 ? id : null;
}

actualizar.addEventListener('click', () => cargar());
anterior.addEventListener('click', () => {
  if (pagina > 1) {
    pagina -= 1;
    cargar();
  }
});
siguiente.addEventListener('click', () => {
  pagina += 1;
  cargar();
});
cerrarDetalle.addEventListener('click', cerrar);

async function iniciar() {
  identidad = await listo;
  if (!identidad) return;
  await cargar();
  const id = idDeUrl();
  if (id) await abrirDetalle(id);
}

document.addEventListener('aula:sesion', async (evento) => {
  identidad = evento.detail;
  if (!identidad) return;
  await cargar();
});

iniciar();
