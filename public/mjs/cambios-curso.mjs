import { listo, pedir, enviar, leerJson } from './shell.mjs';

const perfil = document.querySelector('#solicitar-cambio-curso');
const gestion = document.querySelector('#gestionar-cambios-curso');
const seccion = perfil ?? gestion;
const mensaje = seccion.querySelector('[role="status"]');
const rol = perfil ? 'alumno' : 'docente';
const estados = { propuesta: 'Propuesta', reservada: 'Reservada', prestada: 'En préstamo' };
const tipos = { prestamo: 'Préstamo', intercambio: 'Intercambio', cesion: 'Cesión' };
const fecha = valor => new Date(valor).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

async function comprobar(respuesta, texto) {
  if (!respuesta.ok) throw new Error(texto);
  return leerJson(respuesta);
}

function parrafo(texto) {
  const elemento = document.createElement('p');
  elemento.textContent = texto;
  return elemento;
}

async function cargarPerfil(identidad) {
  const select = perfil.elements.cursoId;
  const boton = perfil.querySelector('button');
  const [cursos, pendiente] = await Promise.all([
    pedir('/cursos').then(res => comprobar(res, 'No se pudieron cargar los cursos.')),
    pedir('/mi-espacio/cambio-curso').then(res => comprobar(res, 'No se pudo consultar tu solicitud.'))
  ]);
  select.replaceChildren(new Option('Selecciona el nuevo curso', ''));
  for (const curso of cursos.datos) {
    if (curso.id !== identidad.curso_confirmado_id) select.add(new Option(curso.nombre, curso.id));
  }
  if (pendiente.datos) {
    select.value = String(pendiente.datos.curso_destino_id);
  }
  mensaje.textContent = pendiente.datos ? 'Solicitud pendiente para ' + pendiente.datos.destino + '.' : '';
  select.disabled = boton.disabled = Boolean(pendiente.datos) || select.options.length < 2;
}

let pagina = 1;
async function cargarGestion() {
  const cuerpo = await comprobar(await pedir('/gestion/cambios-curso?' + new URLSearchParams({ pagina })),
    'No se pudieron cargar los cambios de curso.');
  const lista = gestion.querySelector('ul');
  lista.replaceChildren();
  for (const cambio of cuerpo.datos) {
    const tarjeta = document.createElement('li');
    tarjeta.className = 'tarjeta';
    const titulo = document.createElement('h3');
    titulo.textContent = cambio.alias + ' · ' + cambio.origen + ' → ' + cambio.destino;
    tarjeta.append(titulo, parrafo(cambio.confirmada_en
      ? 'Confirmado por ' + cambio.confirmada_por + ' el ' + fecha(cambio.confirmada_en)
      : 'Solicitado el ' + fecha(cambio.solicitada_en)));

    if (!cambio.confirmada_en) {
      const confirmar = document.createElement('button');
      confirmar.type = 'button';
      confirmar.textContent = 'Confirmar cambio de curso';
      confirmar.addEventListener('click', () => ejecutar(confirmar, async () => {
        if (!confirm('¿Has comprobado el nuevo curso de ' + cambio.alias + '?')) return;
        await comprobar(await enviar('/gestion/cambios-curso/' + cambio.id + '/confirmar', {}),
          'No se pudo confirmar el cambio. Actualiza el listado y comprueba que sigue pendiente.');
        pagina = 1;
        await cargarGestion();
        mensaje.textContent = 'Cambio confirmado para ' + cambio.alias + '.';
        mensaje.focus();
      }));
      tarjeta.append(confirmar);
    }

    tarjeta.append(parrafo(cambio.operaciones.length ? 'Operaciones abiertas' : 'Sin operaciones abiertas.'));
    for (const operacion of cambio.operaciones) {
      const texto = tipos[operacion.tipo] + ' #' + operacion.id + ' · ' + estados[operacion.estado];
      tarjeta.append(parrafo(texto + (operacion.vencimiento
        ? ' · Vence el ' + fecha(operacion.vencimiento) : '')));
      if (operacion.tipo === 'prestamo' && operacion.estado === 'prestada') {
        const formulario = document.createElement('form');
        const confirmacion = document.createElement('input');
        confirmacion.type = 'checkbox';
        confirmacion.required = true;
        const etiqueta = document.createElement('label');
        etiqueta.append(confirmacion, ' He comprobado que el ejemplar se devuelve en buen estado');
        const conservacion = document.createElement('input');
        conservacion.required = true;
        conservacion.maxLength = 500;
        const etiquetaConservacion = document.createElement('label');
        etiquetaConservacion.append('Estado de conservación ', conservacion);
        const devolver = document.createElement('button');
        devolver.textContent = 'Registrar devolución';
        formulario.append(etiquetaConservacion, etiqueta, devolver);
        formulario.addEventListener('submit', evento => {
          evento.preventDefault();
          ejecutar(devolver, async () => {
            await comprobar(await enviar('/gestion/prestamos/' + operacion.id + '/devolver', {
              confirmoBuenEstado: confirmacion.checked,
              conservacion: conservacion.value
            }), 'No se pudo registrar la devolución. Comprueba el estado del préstamo y sus incidencias.');
            await cargarGestion();
            mensaje.textContent = 'Devolución registrada para el préstamo #' + operacion.id + '.';
            mensaje.focus();
          });
        });
        tarjeta.append(formulario);
      }
    }
    lista.append(tarjeta);
  }
  gestion.querySelector('#cambios-anterior').disabled = pagina === 1;
  gestion.querySelector('#cambios-siguiente').disabled = !cuerpo.siguiente;
  mensaje.textContent = cuerpo.datos.length ? 'Página ' + pagina : 'No hay solicitudes en esta página.';
}

async function ejecutar(boton, accion) {
  boton.disabled = true;
  try {
    await accion();
  } catch (error) {
    mensaje.textContent = error.message;
    mensaje.focus();
  } finally {
    if (boton.isConnected && !perfil?.elements.cursoId.disabled) boton.disabled = false;
  }
}

let identidad;
async function actualizar(datos) {
  identidad = datos;
  seccion.hidden = datos?.estado !== 'activo' || !datos.roles.includes(rol) ||
    (rol === 'alumno' && !datos.curso_confirmado_id);
  if (seccion.hidden) return;
  try {
    if (perfil) await cargarPerfil(datos);
    else await cargarGestion();
  } catch (error) {
    mensaje.textContent = error.message;
  }
}

if (perfil) {
  perfil.addEventListener('submit', evento => {
    evento.preventDefault();
    const boton = perfil.querySelector('button');
    ejecutar(boton, async () => {
      await comprobar(await enviar('/mi-espacio/cambio-curso', { cursoId: Number(perfil.elements.cursoId.value) }),
        'No se pudo solicitar el cambio. Comprueba el curso seleccionado.');
      await cargarPerfil(identidad);
      mensaje.focus();
    });
  });
} else {
  for (const [selector, paso] of [['#cambios-anterior', -1], ['#cambios-siguiente', 1]]) {
    const boton = gestion.querySelector(selector);
    boton.addEventListener('click', () => {
      pagina += paso;
      cargarGestion().catch(error => {
        pagina -= paso;
        mensaje.textContent = error.message;
      });
    });
  }
}

document.addEventListener('aula:sesion', evento => actualizar(evento.detail));
await actualizar(await listo);
