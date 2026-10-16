/* --- Página de acceso: entrar y crear cuenta (tarea 2.2.3) ---
    El index llama a esta página cuando no hay sesión. Aquí se entra o se
    crea la cuenta y, en cuanto el servidor confirma la identidad, se pasa
    a la página principal (index.html). Usa la API del servidor montado
    (src/cuentas/*), con los nombres de campo del Sprint 2:
      GET  /api/csrf     token CSRF (se guarda solo en memoria)
      POST /api/registro alias, correo, cursoSolicitadoId (entero), clave
      POST /api/acceso   correo y clave; regenera la sesión
      GET  /api/yo       identidad y estado actuales

    El mapa CURSOS traduce el código visible del curso (DAW-1) al id de
    la tabla curso; si el contrato pasara a enviar el código tal cual,
    solo se tocan estas líneas y las de los formularios.

    Reglas que cumple:
    - Nada se guarda en localStorage, sessionStorage ni IndexedDB.
    - La contraseña se borra de los campos después de cada envío.
    - Tras el registro se intenta entrar directamente para poder pasar a la
      página principal; si no se puede (por ejemplo, límite de intentos),
      se explica aquí mismo que la cuenta queda pendiente de validación.
    - Una cuenta pendiente o suspendida también llega al index; allí un
      aviso explica su estado y las áreas quedan ocultas.
    - Las respuestas se leen de forma tolerante ({ datos: ... } o plano). */

const API = '/api';
const DESTINO = 'index.html';   // la página principal: se pasa al entrar o al registrarse

// Código visible del curso -> id de la tabla curso (sql/002_cuentas.sql).
const CURSOS = { 'DAW-1': 1, 'DAW-2': 2 };

// Campo del formulario -> id del control. El servidor devuelve errores 422 como
// { error: 'DATOS_INVALIDOS', campos: { nombreDelCampo: 'mensaje' } }. Se admiten
// los dos nombres usados por las variantes del servidor (clave/contrasena).
const CAMPOS = {
  registro: { alias: 'reg-alias', correo: 'reg-correo', curso: 'reg-curso', cursoSolicitadoId: 'reg-curso', contrasena: 'reg-contrasena', clave: 'reg-contrasena' },
  acceso: { correo: 'acc-correo', contrasena: 'acc-contrasena', clave: 'acc-contrasena' }
};

const estado = { csrf: null, identidad: null, ocupado: false };

const $ = (id) => document.getElementById(id);

/* --- Lectura tolerante de las respuestas --- */
async function leerJson(respuesta) {
  try { return await respuesta.json(); } catch { return null; }
}
function leerToken(cuerpo) {
  return cuerpo?.datos?.csrf ?? cuerpo?.datos?.token ?? cuerpo?.csrf ?? cuerpo?.token ?? null;
}
function leerIdentidad(cuerpo) {
  const d = cuerpo?.datos ?? cuerpo ?? {};
  return { alias: String(d.alias ?? ''), estado: String(d.estado ?? ''), roles: d.roles };
}

/* --- Red --- */
async function pedirCsrf() {
  const respuesta = await fetch(API + '/csrf', { credentials: 'same-origin', cache: 'no-store' });
  if (!respuesta.ok) throw new Error('csrf');
  estado.csrf = leerToken(await leerJson(respuesta));
  if (!estado.csrf) throw new Error('csrf');
}

// POST con cookie de sesión y X-CSRF-Token. Si el token caducó (403), lo renueva y reintenta una vez.
async function enviar(ruta, cuerpo) {
  for (let intento = 0; intento < 2; intento++) {
    if (!estado.csrf) await pedirCsrf();
    const respuesta = await fetch(API + ruta, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': estado.csrf },
      body: JSON.stringify(cuerpo ?? {})
    });
    if (respuesta.status !== 403 || intento === 1) return respuesta;
    estado.csrf = null;
  }
}

async function pedir(ruta) {
  return fetch(API + ruta, { credentials: 'same-origin', cache: 'no-store' });
}

/* --- Mensajes accesibles --- */
function anunciar(texto) {
  const zona = $('cuenta-estado');
  zona.textContent = '';
  setTimeout(() => { zona.textContent = texto; }, 30);
}

function limpiarErrores() {
  const resumen = $('resumen-errores');
  resumen.hidden = true;
  resumen.replaceChildren();
  document.querySelectorAll('#cuenta [aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  document.querySelectorAll('#cuenta .campo-error').forEach((p) => { p.textContent = ''; });
}

// errores: [{ id: idDelControl | null, texto }]. El foco va al resumen; cada enlace lleva a su campo.
function mostrarErrores(errores) {
  limpiarErrores();
  const resumen = $('resumen-errores');
  const titulo = document.createElement('h3');
  titulo.textContent = errores.length === 1 ? 'Hay un error' : 'Hay ' + errores.length + ' errores';
  resumen.append(titulo);
  for (const { id, texto } of errores) {
    const linea = document.createElement('p');
    if (id) {
      const enlace = document.createElement('a');
      enlace.href = '#' + id;
      enlace.textContent = texto;
      enlace.addEventListener('click', (e) => { e.preventDefault(); $(id).focus(); });
      linea.append(enlace);
      $(id).setAttribute('aria-invalid', 'true');
      $(id + '-error').textContent = texto;
    } else {
      linea.textContent = texto;
    }
    resumen.append(linea);
  }
  resumen.hidden = false;
  resumen.focus();
}

const ERROR_RED = 'No se pudo contactar con el servidor. No sabemos si tu solicitud llegó. Comprueba la conexión y vuelve a enviarla.';

function erroresDeServidor(formulario, cuerpo) {
  const lista = [];
  for (const [campo, texto] of Object.entries(cuerpo?.campos ?? {})) {
    const id = CAMPOS[formulario][campo];
    lista.push({ id: id ?? null, texto: String(texto) });
  }
  return lista.length ? lista : [{ id: null, texto: 'El servidor no aceptó los datos. Revisa el formulario.' }];
}

// Errores comunes a registro y acceso. Devuelve true si ya los ha mostrado.
async function errorGeneral(respuesta, formulario) {
  if (respuesta.status === 422) { mostrarErrores(erroresDeServidor(formulario, await leerJson(respuesta))); return true; }
  if (respuesta.status === 429) {
    const segundos = Number(respuesta.headers.get('Retry-After'));
    const espera = segundos > 0 ? ' Espera ' + segundos + ' segundos antes de intentarlo de nuevo.' : ' Espera un momento antes de intentarlo de nuevo.';
    mostrarErrores([{ id: null, texto: 'Demasiados intentos.' + espera }]);
    return true;
  }
  if (respuesta.status === 403) {
    estado.csrf = null;
    const codigo = (await leerJson(respuesta))?.error;
    mostrarErrores([{ id: null, texto: codigo === 'ORIGEN_NO_PERMITIDO'
      ? 'El servidor no acepta esta dirección. Abre la página con la dirección que indica el administrador, por ejemplo http://127.0.0.1:3000.'
      : codigo === 'CUENTA_SUSPENDIDA'
        ? 'Tu cuenta está suspendida y no puede entrar. Consulta con el profesorado.'
        : 'La sesión del formulario caducó. Envíalo de nuevo.' }]);
    return true;
  }
  if (!respuesta.ok) {
    mostrarErrores([{ id: null, texto: 'No se pudo completar la acción. Inténtalo de nuevo en unos minutos.' }]);
    return true;
  }
  return false;
}

/* --- Espera: bloquea el doble envío y avisa --- */
async function conEspera(boton, textoEspera, tarea) {
  if (estado.ocupado) return;
  estado.ocupado = true;
  const original = boton.textContent;
  boton.setAttribute('aria-disabled', 'true');
  boton.textContent = textoEspera;
  anunciar(textoEspera);
  try {
    await tarea();
  } catch {
    mostrarErrores([{ id: null, texto: ERROR_RED }]);
  } finally {
    estado.ocupado = false;
    boton.removeAttribute('aria-disabled');
    boton.textContent = original;
  }
}

/* --- Validación en el cliente (ayuda; decide el servidor) --- */
const longitud = (texto) => [...texto].length;   // cuenta caracteres Unicode, no unidades UTF-16

function validarRegistro() {
  const e = [];
  if (!$('reg-alias').value.trim()) e.push({ id: 'reg-alias', texto: 'Escribe un alias.' });
  const correo = $('reg-correo').value.trim();
  if (!correo) e.push({ id: 'reg-correo', texto: 'Escribe tu correo.' });
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) e.push({ id: 'reg-correo', texto: 'El correo no tiene un formato válido.' });
  if (!$('reg-curso').value) e.push({ id: 'reg-curso', texto: 'Elige el curso que solicitas.' });
  const clave = $('reg-contrasena').value;
  if (!clave) e.push({ id: 'reg-contrasena', texto: 'Escribe una contraseña.' });
  else if (longitud(clave) < 15) e.push({ id: 'reg-contrasena', texto: 'La contraseña debe tener al menos 15 caracteres.' });
  else if (longitud(clave) > 128) e.push({ id: 'reg-contrasena', texto: 'La contraseña admite 128 caracteres como máximo.' });
  return e;
}

function validarAcceso() {
  const e = [];
  if (!$('acc-correo').value.trim()) e.push({ id: 'acc-correo', texto: 'Escribe tu correo.' });
  if (!$('acc-contrasena').value) e.push({ id: 'acc-contrasena', texto: 'Escribe tu contraseña.' });
  return e;
}

/* --- Paneles: visitante, pendiente y activa --- */
function mostrarPanel(nombre, enfocar = true) {
  $('cuenta-visitante').hidden = nombre !== 'visitante';
  $('cuenta-pendiente').hidden = nombre !== 'pendiente';
  $('cuenta-activa').hidden = nombre !== 'activa';
  if (enfocar) $('titulo-login').focus();
}

function elegirFormulario(cual) {
  const registro = cual === 'registro';
  $('form-registro').hidden = !registro;
  $('form-acceso').hidden = registro;
  $('ir-registro').setAttribute('aria-pressed', String(registro));
  $('ir-acceso').setAttribute('aria-pressed', String(!registro));
  limpiarErrores();
}

// Con sesión: se puede comprobar el estado. Sin sesión (recién registrado): se ofrece ir a Entrar.
function botonesPendiente(conSesion) {
  $('boton-comprobar').hidden = !conSesion;
  $('boton-ir-acceso').hidden = conSesion;
}

// La identidad está confirmada: se pasa a la página principal.
function irAlaWeb() {
  location.replace(DESTINO);
}

function volverAVisitante(mensaje, { enfocar = true } = {}) {
  estado.identidad = null;
  limpiarErrores();
  mostrarPanel('visitante', enfocar);
  elegirFormulario('acceso');
  if (mensaje) anunciar(mensaje);
}

/* --- Comprobar la sesión actual --- */
async function comprobarSesion({ avisar = false } = {}) {
  try {
    const respuesta = await pedir('/yo');
    if (respuesta.ok) {
      estado.identidad = leerIdentidad(await leerJson(respuesta));
      irAlaWeb();   // ya hay sesión: esta página no pinta nada más
      return;
    }
    if (respuesta.status !== 401) {
      if (avisar) mostrarErrores([{ id: null, texto: 'No se pudo comprobar tu estado. Inténtalo de nuevo.' }]);
      return;
    }
  } catch {
    if (avisar) { mostrarErrores([{ id: null, texto: ERROR_RED }]); return; }
  }
  // Sin sesión confirmada por el servidor, se muestra el formulario de entrada.
  if (estado.identidad) volverAVisitante('Tu sesión ha terminado. Entra de nuevo.');
}

/* --- Formularios --- */
$('form-registro').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limpiarErrores();
  const errores = validarRegistro();
  if (errores.length) return mostrarErrores(errores);

  // Solo los campos que espera el servidor. Rol, estado y curso confirmado
  // se deciden en el servidor, nunca aquí.
  const cuerpo = {
    alias: $('reg-alias').value.trim(),
    correo: $('reg-correo').value.trim(),
    cursoSolicitadoId: CURSOS[$('reg-curso').value] ?? 0,
    clave: $('reg-contrasena').value
  };
  const credenciales = { correo: cuerpo.correo, clave: cuerpo.clave };
  await conEspera($('boton-registro'), 'Enviando…', async () => {
    let respuesta;
    try {
      respuesta = await enviar('/registro', cuerpo);
    } finally {
      $('reg-contrasena').value = '';   // la contraseña no se conserva en el formulario
    }
    if (await errorGeneral(respuesta, 'registro')) return;
    // La respuesta es genérica (202): no revela si el correo ya existía.
    $('form-registro').reset();

    // Registro hecho: se intenta entrar para pasar directamente a la página
    // principal (una cuenta pendiente también puede consultar su estado).
    let entrada = null;
    try {
      entrada = await enviar('/acceso', credenciales);
    } catch {
      entrada = null;
    }
    if (entrada?.ok) {
      estado.csrf = null;               // la sesión se regeneró al entrar
      return irAlaWeb();
    }

    // Respaldo si no se pudo entrar (limitador de intentos, red…): se explica
    // aquí que la cuenta queda pendiente de validación docente.
    botonesPendiente(false);
    mostrarPanel('pendiente');
    $('titulo-pendiente-texto').textContent = 'Validación docente pendiente';
    $('texto-pendiente').textContent = 'Hemos recibido tu solicitud. Un docente debe confirmar que perteneces al centro y al curso que has solicitado. Hasta entonces no puedes ver Biblioteca, Libros ni Documentación.';
    anunciar('Solicitud enviada. Falta la validación docente.');
  });
});

$('form-acceso').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limpiarErrores();
  const errores = validarAcceso();
  if (errores.length) return mostrarErrores(errores);

  const cuerpo = { correo: $('acc-correo').value.trim(), clave: $('acc-contrasena').value };
  await conEspera($('boton-acceso'), 'Entrando…', async () => {
    let respuesta;
    try {
      respuesta = await enviar('/acceso', cuerpo);
    } finally {
      $('acc-contrasena').value = '';
    }
    if (respuesta.status === 401) {
      return mostrarErrores([{ id: 'acc-contrasena', texto: 'Correo o contraseña incorrectos.' }]);
    }
    if (await errorGeneral(respuesta, 'acceso')) return;
    $('form-acceso').reset();
    estado.csrf = null;                 // la sesión se regeneró: el token anterior ya no vale
    estado.identidad = leerIdentidad(await leerJson(respuesta));
    irAlaWeb();                         // Logeado: a la página principal
  });
});

/* --- Comprobar el estado (por si queda alguna cuenta pendiente aquí) --- */
$('boton-comprobar').addEventListener('click', async () => {
  if (estado.ocupado) return;
  limpiarErrores();
  anunciar('Comprobando tu estado…');
  await comprobarSesion({ avisar: true });
  if (estado.identidad) {
    anunciar(estado.identidad.estado === 'suspendido' ? 'Tu cuenta sigue suspendida.' : 'Tu cuenta sigue pendiente de validación.');
  }
});

$('boton-ir-acceso').addEventListener('click', () => volverAVisitante('', { enfocar: true }));
$('ir-registro').addEventListener('click', () => elegirFormulario('registro'));
$('ir-acceso').addEventListener('click', () => elegirFormulario('acceso'));

document.querySelectorAll('[data-ver-clave]').forEach((boton) => boton.addEventListener('click', () => {
  const campo = $(boton.dataset.verClave);
  const mostrar = campo.type === 'password';
  campo.type = mostrar ? 'text' : 'password';
  boton.textContent = mostrar ? 'Ocultar' : 'Mostrar';
  boton.setAttribute('aria-pressed', String(mostrar));
}));

/* --- Volver atrás: nada se confía a la página restaurada --- */
window.addEventListener('pageshow', (e) => {
  if (e.persisted) { limpiarErrores(); comprobarSesion(); }
});

/* --- Arranque --- */
$('aviso-carga').hidden = true;   // si el módulo no carga, este aviso sigue visible
mostrarPanel('visitante', false);
elegirFormulario('acceso');
comprobarSesion();   // si ya hay sesión, se pasa directo a la página principal
