/* --- Shell común de las páginas (componente compartido) ---
    Sesión, menú por permisos, avisos, cierre de sesión y menú móvil
    de las páginas con menú. login.html no lo carga.

    Al incluirlo, cada página obtiene:
      - comprobación de sesión: sin sesión vuelve a login.html; con
        cuenta pendiente o suspendida, Inicio y Mi espacio con su
        aviso, sin las tres áreas; con cuenta activa, menú completo;
      - zona de sesión (alias y cierre de sesión) en mi-espacio.html;
      - aria-current en el enlace de la página actual;
      - menú móvil (abrir/cerrar; Escape también cierra);
      - reconfirmación al volver atrás (pageshow/popstate).

    Contrato para los módulos de cada página:
      - listo: promesa con la identidad de la primera comprobación
        ({ id, alias, estado, roles, cursos }) o null si no hay sesión;
      - evento 'aula:sesion' en document: identidad actualizada tras
        cada recomprobación (solo en popstate/pageshow);
      - pedir(ruta) y enviar(ruta, cuerpo, metodo): GET y POST/PATCH con CSRF;
      - leerJson(respuesta): lectura tolerante;
      - irALogin(): vuelve a login.html sin dejar entrada en el historial;
      - puedeVerAreas(identidad): representación visual; la API autoriza;
      - avisar(texto): aviso visible en #aviso-sesion.

    API usada: GET /api/yo, GET /api/csrf, POST /api/salida. */

const API = '/api';
const DESTINO_SIN_SESION = 'login.html';

const estado = { csrf: null, ocupado: false };

const $ = (id) => document.getElementById(id);

/* --- Lectura tolerante de las respuestas --- */
export async function leerJson(respuesta) {
  try { return await respuesta.json(); } catch { return null; }
}

function leerToken(cuerpo) {
  return cuerpo?.datos?.csrf ?? cuerpo?.datos?.token ?? cuerpo?.csrf ?? cuerpo?.token ?? null;
}

export function leerIdentidad(cuerpo) {
  const d = cuerpo?.datos ?? cuerpo ?? {};
  return {
    id: d.id ?? null,
    alias: String(d.alias ?? ''),
    estado: String(d.estado ?? ''),
    roles: Array.isArray(d.roles) ? d.roles : [],
    curso_solicitado: d.curso_solicitado ?? null,
    curso_confirmado: d.curso_confirmado ?? null,
    curso_solicitado_id: d.curso_solicitado_id ?? null,
    curso_confirmado_id: d.curso_confirmado_id ?? null
  };
}

/* --- Red --- */
async function pedirCsrf() {
  const respuesta = await fetch(API + '/csrf', { credentials: 'same-origin', cache: 'no-store' });
  if (!respuesta.ok) throw new Error('csrf');
  estado.csrf = leerToken(await leerJson(respuesta));
  if (!estado.csrf) throw new Error('csrf');
}

// POST con cookie de sesión y X-CSRF-Token. Si el token caducó (403), lo renueva y reintenta una vez.
export async function enviar(ruta, cuerpo, metodo = 'POST') {
  for (let intento = 0; intento < 2; intento++) {
    if (!estado.csrf) await pedirCsrf();
    const respuesta = await fetch(API + ruta, {
      method: metodo,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': estado.csrf },
      body: JSON.stringify(cuerpo ?? {})
    });
    if (respuesta.status !== 403 || intento === 1) return respuesta;
    estado.csrf = null;
  }
}

export async function pedir(ruta) {
  return fetch(API + ruta, { credentials: 'same-origin', cache: 'no-store' });
}

export function irALogin() {
  location.replace(DESTINO_SIN_SESION);
}

/* --- Avisos y sesión en pantalla --- */
export function avisar(texto) {
  const zona = $('aviso-sesion');
  zona.textContent = texto ?? '';
  zona.hidden = !texto;
}

function mostrarEstado(identidad) {
  $('aviso-estado').textContent = identidad.estado === 'suspendido'
    ? 'Tu cuenta está suspendida y no puedes ver Biblioteca, Libros ni Documentación. Consulta con el profesorado.'
    : 'Tu cuenta está pendiente de validación docente. Cuando te validen, recarga la página para ver Biblioteca, Libros y Documentación.';
  $('aviso-estado').hidden = false;
}

/* --- Permisos: el servidor decide; aquí solo se representa --- */
export function puedeVerAreas(identidad) {
  if (identidad.estado !== 'activo') return false;
  // Un admin sin rol alumno/docente administra cuentas, pero no ve estas áreas.
  return !Array.isArray(identidad.roles) || identidad.roles.some((r) => r === 'alumno' || r === 'docente');
}

export function puedeGestionarAnuncios(identidad) {
  return Boolean(identidad && identidad.estado === 'activo' &&
    Array.isArray(identidad.roles) && identidad.roles.includes('alumno'));
}

// Mi espacio está disponible para cualquier sesión (allí vive el cierre
// de sesión); las tres áreas protegidas, solo para cuentas activas.
function pintarMenu(identidad) {
  const activa = identidad ? puedeVerAreas(identidad) : false;
  const roles = Array.isArray(identidad?.roles) ? identidad.roles : [];
  document.querySelectorAll('[data-area]').forEach((enlace) => {
    const soloActiva = enlace.dataset.area !== 'mi-espacio';
    const soloDocente = enlace.dataset.rol === 'docente';
    enlace.hidden = !identidad || (soloActiva && !activa) ||
      (soloDocente && !roles.includes('docente'));
  });
}

function mostrarSesion(identidad) {
  const zona = $('zona-sesion');
  if (!zona) return; // La zona de sesión solo existe en mi-espacio.html.
  zona.hidden = false;
  $('sesion-alias').textContent = identidad.alias ? 'Sesión: ' + identidad.alias : 'Sesión iniciada';
}

/* --- Menú móvil --- */
function montarMenu() {
  const boton = $('menu-boton');
  const menu = $('menu-principal');
  if (!boton || !menu) return;
  function abrir(abierto) {
    menu.classList.toggle('abierto', abierto);
    boton.setAttribute('aria-expanded', String(abierto));
    boton.textContent = abierto ? 'Cerrar menú' : 'Abrir menú';
  }
  boton.addEventListener('click', () =>
    abrir(boton.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && boton.getAttribute('aria-expanded') === 'true') {
      abrir(false);
      boton.focus();
    }
  });
  menu.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => abrir(false)));
}

/* --- Enlace de validación docente ---
    Se añade una sola vez al menú común. pintarMenu lo oculta salvo que
    la sesión sea de un docente activo. */
function insertarEnlaceDocencia() {
  const menu = $('menu-principal');
  if (!menu || menu.querySelector('a[href="docencia.html"]')) return;
  const enlace = document.createElement('a');
  enlace.href = 'docencia.html';
  enlace.className = 'nav-link';
  enlace.dataset.area = 'docencia';
  enlace.dataset.rol = 'docente';
  enlace.textContent = 'Validación';
  menu.append(enlace);
}

/* --- Página actual --- */
function marcarActual() {
  const pagina = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('#menu-principal .nav-link').forEach((enlace) => {
    if (enlace.getAttribute('href') === pagina) enlace.setAttribute('aria-current', 'page');
    else enlace.removeAttribute('aria-current');
  });
}

/* --- Limpieza y comprobación de sesión --- */
function limpiarComun() {
  const zona = $('zona-sesion');
  if (zona) zona.hidden = true;
  const alias = $('sesion-alias');
  if (alias) alias.textContent = '';
  $('aviso-estado').hidden = true;
  $('aviso-estado').textContent = '';
  document.querySelectorAll('.area-lista').forEach((ul) => ul.replaceChildren());
  document.querySelectorAll('.area-estado').forEach((p) => { p.textContent = ''; });
  pintarMenu(null);
  avisar(null);
}

async function comprobarSesion() {
  limpiarComun();
  try {
    const respuesta = await pedir('/yo');
    if (respuesta.ok) {
      const identidad = leerIdentidad(await leerJson(respuesta));
      mostrarSesion(identidad);
      pintarMenu(identidad);
      // Aviso para pendiente o suspendida; una activa sin acceso a las
      // áreas (admin) se queda sin aviso, que no le corresponde.
      if (identidad.estado !== 'activo') mostrarEstado(identidad);
      return identidad;
    }
    if (respuesta.status === 401 || respuesta.status === 403) { irALogin(); return null; }
    avisar('No se pudo comprobar tu sesión. Recarga la página para intentarlo de nuevo.');
    return null;
  } catch {
    avisar('Sin conexión con el servidor. Recarga la página para intentarlo de nuevo.');
    return null;
  }
}

/* --- Cerrar sesión (botón de mi-espacio.html) --- */
const botonSalir = $('boton-salir');
if (botonSalir) botonSalir.addEventListener('click', async () => {
  if (estado.ocupado) return;
  estado.ocupado = true;
  const boton = botonSalir;
  const original = boton.textContent;
  boton.setAttribute('aria-disabled', 'true');
  boton.textContent = 'Cerrando…';
  avisar(null);
  try {
    const respuesta = await enviar('/salida');
    // 204 = cerrada; 401 = ya no había sesión. Cualquier otra cosa: sigue abierta y se avisa.
    if (respuesta.status === 204 || respuesta.status === 401 || respuesta.ok) {
      history.replaceState(null, '', location.pathname);
      limpiarComun();
      irALogin();
      return;
    }
    avisar('No se pudo cerrar la sesión. Sigue abierta: inténtalo de nuevo.');
  } catch {
    avisar('No se pudo contactar con el servidor. No sabemos si tu solicitud llegó. Comprueba la conexión y vuelve a intentarlo.');
  } finally {
    estado.ocupado = false;
    boton.removeAttribute('aria-disabled');
    boton.textContent = original;
  }
});

/* --- Volver atrás: no se confía en lo que la página restaurada muestre --- */
async function recomprobar() {
  const identidad = await comprobarSesion();
  document.dispatchEvent(new CustomEvent('aula:sesion', { detail: identidad }));
}
window.addEventListener('pageshow', (e) => { if (e.persisted) recomprobar(); });
window.addEventListener('popstate', () => recomprobar());

/* --- Arranque --- */
document.documentElement.classList.add('js');
insertarEnlaceDocencia();
marcarActual();
montarMenu();
export const listo = comprobarSesion();
