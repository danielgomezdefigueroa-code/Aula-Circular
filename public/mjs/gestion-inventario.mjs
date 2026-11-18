/* T14 - Gestión del inventario visible solo para el rol docente.
 * La API sigue siendo la autoridad sobre permisos, códigos y referencias.
 */
import { listo, pedir, enviar, leerJson, irALogin } from './shell.mjs';

const $ = id => document.getElementById(id);
const texto = valor => String(valor ?? '').trim();
const numero = valor => Number(valor);
const gestor = $('gestion-inventario');
const ficha = $('t14-ficha');
const copia = $('t14-copia');
const aviso = $('t14-estado');
const historial = $('t14-categorias-lista');
const camposEjemplar = $('t14-campos-ejemplar');
const tituloFormulario = $('t14-titulo-formulario');
const btnGuardar = $('t14-guardar');
let identidad = null;
let recursos = [];
let categorias = [];
let cargando = false;

function anunciar(mensaje, error = false) {
  aviso.textContent = mensaje;
  aviso.classList.toggle('t14-error', error);
  aviso.setAttribute('role', error ? 'alert' : 'status');
}

// T14: cada formulario informa de sus propios errores, cerca del campo afectado.
function configurarAvisos(formulario, campoId) {
  const campo = $(campoId);
  const errorCampo = document.createElement('p');
  errorCampo.id = campoId + '-error';
  errorCampo.className = 'campo-error';
  errorCampo.setAttribute('role', 'alert');
  errorCampo.setAttribute('aria-live', 'polite');
  campo.insertAdjacentElement('afterend', errorCampo);

  const estado = document.createElement('p');
  estado.className = 't14-form-feedback';
  estado.setAttribute('role', 'status');
  estado.setAttribute('aria-live', 'polite');
  formulario.append(estado);
  return { campo, errorCampo, estado };
}

function limpiarAvisos(avisos) {
  avisos.campo.removeAttribute('aria-invalid');
  avisos.campo.removeAttribute('aria-describedby');
  avisos.errorCampo.textContent = '';
  avisos.estado.textContent = '';
  avisos.estado.classList.remove('t14-form-error');
  avisos.estado.setAttribute('role', 'status');
}

function responderEnFormulario(avisos, mensaje, error = false, duplicado = false) {
  if (duplicado) {
    avisos.campo.setAttribute('aria-invalid', 'true');
    avisos.campo.setAttribute('aria-describedby', avisos.errorCampo.id);
    avisos.errorCampo.textContent = mensaje;
    avisos.campo.focus();
    return;
  }
  avisos.estado.textContent = mensaje;
  avisos.estado.classList.toggle('t14-form-error', error);
  avisos.estado.setAttribute('role', error ? 'alert' : 'status');
}

function opcion(select, value, label, disabled = false) {
  const opt = document.createElement('option');
  opt.value = String(value);
  opt.textContent = label;
  opt.disabled = disabled;
  select.append(opt);
}

async function obtener(ruta) {
  const respuesta = await pedir(ruta);
  const cuerpo = await leerJson(respuesta);
  if (respuesta.status === 401) { irALogin(); throw new Error('Sesión caducada.'); }
  if (!respuesta.ok) throw new Error(cuerpo?.mensaje ?? cuerpo?.error ?? 'No se pudieron cargar los datos.');
  return cuerpo?.datos ?? [];
}

// Recupera todas las páginas para los selectores de gestión docente.
async function obtenerTodosLosRecursos() {
  const recursos = [];
  const limite = 20;

  for (let pagina = 1; pagina <= 1000; pagina++) {
    const lote = await obtener(
      `/biblioteca?pagina=${pagina}&limite=${limite}`
    );

    if (!Array.isArray(lote)) {
      throw new Error('Respuesta de Biblioteca no válida.');
    }

    recursos.push(...lote);

    if (lote.length < limite) {
      return recursos;
    }
  }

  throw new Error('No se pudo completar la carga del inventario.');
}

function poblarCursos(datos) {
  const select = $('t14-curso');
  const anterior = select.value;
  select.replaceChildren();
  opcion(select, '', 'Selecciona un curso');
  for (const curso of datos) opcion(select, curso.id, `${curso.codigo} · ${curso.nombre}`);
  if ([...select.options].some(o => o.value === anterior)) select.value = anterior;
}

function poblarCategorias() {
  const select = $('t14-categoria');
  const anterior = select.value;
  select.replaceChildren();
  opcion(select, '', 'Selecciona una categoría');
  for (const categoria of categorias) {
    opcion(select, categoria.id,
      `${categoria.nombre}${categoria.activo ? '' : ' (inactiva)'}`, !categoria.activo);
  }
  if ([...select.options].some(o => o.value === anterior && !o.disabled)) select.value = anterior;
}

function poblarRecursos() {
  for (const [id, soloFisicos] of [['t14-recurso-editar', false], ['t14-recurso-ejemplar', true]]) {
    const select = $(id);
    const anterior = select.value;
    select.replaceChildren();
    opcion(select, '', soloFisicos ? 'Selecciona un recurso físico' : 'Nuevo recurso');
    for (const r of recursos.filter(r => !soloFisicos || r.tipo === 'fisico')) {
      opcion(select, r.id, `#${r.id} · ${r.titulo} · ${r.edicion || 's/edición'}`);
    }
    if ([...select.options].some(o => o.value === anterior)) select.value = anterior;
  }
}

function dibujarCategorias() {
  historial.replaceChildren();
  for (const cat of categorias) {
    const fila = document.createElement('li');
    fila.className = 't14-categoria-fila';
    const etiqueta = document.createElement('span');
    etiqueta.textContent = `${cat.nombre} · ${cat.activo ? 'Activa' : 'Inactiva (histórica)'}`;
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton-sec';
    boton.textContent = cat.activo ? 'Desactivar' : 'Activar';
    boton.dataset.categoria = String(cat.id);
    boton.dataset.activar = String(!cat.activo);
    fila.append(etiqueta, boton);
    historial.append(fila);
  }
}

function mostrarEjemplar() {
  const esAltaFisica = !$('t14-recurso-editar').value && $('t14-tipo').value === 'fisico';
  camposEjemplar.hidden = !esAltaFisica;
  $('t14-codigo').required = esAltaFisica;
  $('t14-conservacion').required = esAltaFisica;
  const edicion = Boolean($('t14-recurso-editar').value);
  tituloFormulario.textContent = edicion ? 'Modificar ficha del recurso' : 'Crear una ficha nueva';
  btnGuardar.textContent = edicion ? 'Guardar modificaciones' : 'Crear recurso';
}

function limpiarFicha() {
  ficha.reset();
  $('t14-recurso-editar').value = '';
  $('t14-tipo').value = 'fisico';
  mostrarEjemplar();
}

async function seleccionarParaEditar() {
  const id = numero($('t14-recurso-editar').value);
  if (!id) { limpiarFicha(); return; }
  anunciar('Cargando ficha…');
  try {
    const r = await obtener(`/biblioteca/${id}`);
    $('t14-titulo').value = r.titulo ?? '';
    $('t14-descripcion').value = r.descripcion ?? '';
    $('t14-tipo').value = r.tipo ?? 'fisico';
    $('t14-asignatura').value = r.asignatura ?? '';
    $('t14-edicion').value = r.edicion ?? '';
    $('t14-isbn').value = r.isbn ?? '';
    $('t14-curso').value = String(r.cursoId ?? '');
    $('t14-categoria').value = String(r.categoriaId ?? '');
    // Una categoría histórica se puede consultar, pero no reutilizar en altas.
    if (r.categoria_activa === false) {
      anunciar('Categoría histórica inactiva: selecciona una categoría activa para modificar la ficha.');
    } else anunciar('Ficha cargada. Puedes modificar sus datos.');
    mostrarEjemplar();
  } catch (error) { anunciar(error.message, true); }
}

function datosFicha() {
  const d = {
    titulo: texto($('t14-titulo').value),
    descripcion: texto($('t14-descripcion').value),
    tipo: $('t14-tipo').value,
    cursoId: numero($('t14-curso').value),
    categoriaId: numero($('t14-categoria').value),
    asignatura: texto($('t14-asignatura').value),
    edicion: texto($('t14-edicion').value),
    isbn: texto($('t14-isbn').value) || null
  };
  if (!numero($('t14-recurso-editar').value) && d.tipo === 'fisico') {
    d.codigo = texto($('t14-codigo').value);
    d.conservacion = texto($('t14-conservacion').value);
  }
  return d;
}

async function guardar(ruta, datos, metodo = 'POST') {
  const respuesta = await enviar(ruta, datos, metodo);
  const cuerpo = await leerJson(respuesta);
  if (respuesta.status === 401) { irALogin(); throw new Error('La sesión ha caducado.'); }
  if (!respuesta.ok) {
    const error = new Error(cuerpo?.mensaje ?? cuerpo?.error ?? `Error HTTP ${respuesta.status}`);
    error.codigo = cuerpo?.error;
    error.estadoHttp = respuesta.status;
    throw error;
  }
  return cuerpo;
}

async function refrescar() {
  if (cargando || !gestor || gestor.hidden) return;
  cargando = true;
  try {
    const [cursos, cats, lista] = await Promise.all([
      obtener('/cursos'),
      obtener('/gestion/biblioteca/categorias'),
      obtenerTodosLosRecursos()
    ]);
    categorias = cats;
    recursos = lista;
    poblarCursos(cursos);
    poblarCategorias();
    poblarRecursos();
    dibujarCategorias();
  } finally { cargando = false; }
}

function recargarCatalogo() {
  document.dispatchEvent(new CustomEvent('aula:inventario-actualizado'));
}

async function establecerIdentidad(persona) {
  identidad = persona;
  const puede = persona?.estado === 'activo' && persona?.roles?.includes('docente');
  gestor.hidden = !puede;
  if (!puede) {
    recursos = []; categorias = [];
    ficha.reset(); copia.reset();
    historial.replaceChildren();
    anunciar('');
    return;
  }
  try { await refrescar(); }
  catch (error) { anunciar(error.message, true); }
}

export async function iniciarGestionInventario() {
  if (!gestor) return;
  const avisosFicha = configurarAvisos(ficha, 't14-codigo');
  const avisosCopia = configurarAvisos(copia, 't14-codigo-extra');
  for (const avisos of [avisosFicha, avisosCopia]) {
    avisos.campo.addEventListener('input', () => {
      avisos.campo.removeAttribute('aria-invalid');
      avisos.campo.removeAttribute('aria-describedby');
      avisos.errorCampo.textContent = '';
    });
  }
  // Los controles se activan únicamente en la vista docente; el servidor comprueba los permisos.
  $('t14-tipo').addEventListener('change', mostrarEjemplar);
  $('t14-recurso-editar').addEventListener('change', seleccionarParaEditar);
  $('t14-reset').addEventListener('click', () => {
    limpiarFicha();
    limpiarAvisos(avisosFicha);
    responderEnFormulario(avisosFicha, 'Formulario preparado para una nueva alta.');
  });

  ficha.addEventListener('submit', async event => {
    event.preventDefault();
    limpiarAvisos(avisosFicha);
    if (!ficha.reportValidity()) return;
    const id = numero($('t14-recurso-editar').value);
    const boton = btnGuardar;
    boton.disabled = true;
    try {
      const respuesta = await guardar(id ? `/gestion/biblioteca/recursos/${id}` : '/gestion/biblioteca/recursos',
        datosFicha(), id ? 'PATCH' : 'POST');
      if (!id) limpiarFicha();
      responderEnFormulario(avisosFicha, respuesta.mensaje ?? (id ? 'Recurso actualizado.' : 'Recurso creado.'));
      await refrescar();
      recargarCatalogo();
    } catch (error) {
      responderEnFormulario(avisosFicha, error.message, true, error.codigo === 'CODIGO_DUPLICADO');
    } finally { boton.disabled = false; }
  });

  copia.addEventListener('submit', async event => {
    event.preventDefault();
    limpiarAvisos(avisosCopia);
    if (!copia.reportValidity()) return;
    const recursoId = numero($('t14-recurso-ejemplar').value);
    if (!recursoId) {
      responderEnFormulario(avisosCopia, 'Selecciona un recurso físico.', true);
      return;
    }
    const boton = $('t14-guardar-ejemplar');
    boton.disabled = true;
    try {
      const respuesta = await guardar(`/gestion/biblioteca/recursos/${recursoId}/ejemplares`, {
        codigo: texto($('t14-codigo-extra').value),
        conservacion: texto($('t14-conservacion-extra').value)
      });
      $('t14-codigo-extra').value = '';
      $('t14-conservacion-extra').value = '';
      responderEnFormulario(avisosCopia, respuesta.mensaje ?? 'Ejemplar añadido.');
      await refrescar();
      recargarCatalogo();
    } catch (error) {
      responderEnFormulario(avisosCopia, error.message, true, error.codigo === 'CODIGO_DUPLICADO');
    } finally { boton.disabled = false; }
  });

  historial.addEventListener('click', async event => {
    const boton = event.target.closest('button[data-categoria]');
    if (!boton) return;
    const id = numero(boton.dataset.categoria);
    const activar = boton.dataset.activar === 'true';
    const cat = categorias.find(c => c.id === id);
    if (!cat || !window.confirm(`${activar ? 'Activar' : 'Desactivar'} «${cat.nombre}»? Los recursos históricos se conservarán.`)) return;
    boton.disabled = true;
    try {
      const respuesta = await guardar(`/gestion/biblioteca/categorias/${id}`, {activo: activar}, 'PATCH');
      anunciar(respuesta.mensaje ?? 'Categoría actualizada.');
      await refrescar();
      recargarCatalogo();
    } catch (error) { anunciar(error.message, true); }
    finally { boton.disabled = false; }
  });

  // Consulta de códigos individuales para alumnado y docentes. No crea reservas.
  document.querySelector('.area-lista')?.addEventListener('click', async event => {
    const boton = event.target.closest('button[data-ver-ejemplares]');
    if (!boton) return;
    const zona = boton.parentElement.querySelector('[data-lista-ejemplares]');
    if (!zona) return;
    if (!zona.hidden) {
      zona.hidden = true; boton.setAttribute('aria-expanded', 'false');
      boton.textContent = 'Ver ejemplares'; return;
    }
    boton.disabled = true;
    try {
      const recurso = await obtener(`/biblioteca/${boton.dataset.verEjemplares}`);
      zona.replaceChildren();
      const ul = document.createElement('ul');
      ul.className = 't14-ejemplares';
      for (const e of recurso.ejemplares ?? []) {
        const li = document.createElement('li');
        li.textContent = `${e.codigo} · ${e.disponible ? 'Disponible' : e.estado_servicio === 'retirado' ? 'Retirado' : 'No disponible'}`;
        ul.append(li);
      }
      if (!ul.children.length) zona.textContent = 'No hay ejemplares asociados.';
      else zona.append(ul);
      zona.hidden = false;
      boton.setAttribute('aria-expanded', 'true');
      boton.textContent = 'Ocultar ejemplares';
    } catch (error) { zona.textContent = error.message; zona.hidden = false; }
    finally { boton.disabled = false; }
  });

  document.addEventListener('aula:sesion', event => establecerIdentidad(event.detail));
  await establecerIdentidad(await listo);
}
