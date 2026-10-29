/* --- Validación docente ---
    Listado paginado de cuentas pendientes y confirmación de curso.
    La autorización real la hace el servidor: solo una cuenta activa con
    rol docente puede validar. Aquí solo se representa y se avisa. */
import { listo, pedir, enviar, leerJson } from './shell.mjs';

const mensaje = document.querySelector('#mensaje');
const lista = document.querySelector('#cuentas');
const anterior = document.querySelector('#anterior');
const siguiente = document.querySelector('#siguiente');
const paginaTexto = document.querySelector('#pagina');

let pagina = 1;
let cursos = [];
let identidad = null;

function mostrar(texto, enfocar = false) {
  mensaje.textContent = texto ?? '';
  if (enfocar) mensaje.focus();
}

function esDocenteActivo(datos) {
  return Boolean(datos && datos.estado === 'activo' &&
    Array.isArray(datos.roles) && datos.roles.includes('docente'));
}

function textoError(respuesta, cuerpo) {
  if (respuesta.status === 401) return 'Inicia sesión con la cuenta docente en Mi espacio.';
  if (respuesta.status === 403) return 'Necesitas una cuenta docente activa para validar cuentas.';
  return cuerpo?.mensaje ?? cuerpo?.error ?? 'No se pudo completar la acción.';
}

async function cargarCursos() {
  const respuesta = await pedir('/cursos');
  const cuerpo = await leerJson(respuesta);
  if (!respuesta.ok || !Array.isArray(cuerpo?.datos)) {
    throw new Error('No se pudieron cargar los cursos.');
  }
  cursos = cuerpo.datos.filter((curso) => Number.isSafeInteger(curso.id) &&
    typeof curso.nombre === 'string');
  if (!cursos.length) throw new Error('No hay cursos activos para validar cuentas.');
}

function crearSelect(u) {
  const id = 'curso-' + u.id;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = 'Curso que confirmas: ';
  const select = document.createElement('select');
  select.id = id;
  for (const curso of cursos) {
    const opcion = document.createElement('option');
    opcion.value = String(curso.id);
    opcion.textContent = curso.nombre;
    if (curso.id === u.curso_solicitado_id) opcion.selected = true;
    select.append(opcion);
  }
  label.append(select);
  return { label, select };
}

async function cargar() {
  anterior.disabled = true;
  siguiente.disabled = true;
  lista.replaceChildren();
  const respuesta = await pedir('/gestion/usuarios?' + new URLSearchParams({ pagina, limite: 20 }));
  const cuerpo = await leerJson(respuesta);
  if (!respuesta.ok) throw new Error(textoError(respuesta, cuerpo));

  const datos = Array.isArray(cuerpo?.datos) ? cuerpo.datos : [];
  paginaTexto.textContent = 'Página ' + pagina;
  anterior.disabled = pagina === 1;
  siguiente.disabled = datos.length < 20;
  mostrar(datos.length
    ? 'Selecciona el curso y confirma cada cuenta revisada.'
    : 'No hay cuentas pendientes en esta página.');

  for (const u of datos) {
    const tarjeta = document.createElement('li');
    tarjeta.className = 'tarjeta';
    const nombre = document.createElement('h2');
    nombre.textContent = u.alias;
    const detalle = document.createElement('p');
    detalle.textContent = 'Curso solicitado: ' + (u.curso_solicitado ?? 'sin curso');
    const { label, select } = crearSelect(u);
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = 'Validar cuenta y curso';
    boton.addEventListener('click', async () => {
      if (!confirm(`¿Has comprobado la pertenencia de ${u.alias} y su curso?`)) return;
      boton.disabled = true;
      try {
        const respuestaValidar = await enviar(
          '/gestion/usuarios/' + u.id + '/validar',
          { cursoId: Number(select.value) }
        );
        const cuerpoValidar = await leerJson(respuestaValidar);
        if (!respuestaValidar.ok) throw new Error(textoError(respuestaValidar, cuerpoValidar));
        await cargar();
        mostrar(cuerpoValidar?.mensaje ?? 'Cuenta y curso validados.', true);
      } catch (error) {
        mostrar(error.message, true);
        boton.disabled = false;
      }
    });
    const acciones = document.createElement('div');
    acciones.className = 'acciones-tarjeta';
    acciones.append(boton);
    tarjeta.append(nombre, detalle, label, acciones);
    lista.append(tarjeta);
  }
}

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
  identidad = evento.detail;
  if (!esDocenteActivo(identidad)) {
    lista.replaceChildren();
    paginaTexto.textContent = '';
    anterior.disabled = true;
    siguiente.disabled = true;
    mostrar('Necesitas una cuenta docente activa para validar cuentas.');
    return;
  }
  try {
    if (!cursos.length) await cargarCursos();
    await cargar();
  } catch (error) {
    mostrar(error.message, true);
  }
});

try {
  identidad = await listo;
  if (!identidad) {
    // El shell ya ha enviado a login.html.
  } else if (!esDocenteActivo(identidad)) {
    mostrar('Necesitas una cuenta docente activa para validar cuentas.');
  } else {
    await cargarCursos();
    await cargar();
  }
} catch (error) {
  mostrar(error.message, true);
}
