// Pruebas de las rutas de cuenta con una base y una sesión simuladas (sin Express ni PostgreSQL).
// Ejecutar con: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearAuth } from '../src/auth.mjs';
import { comprobarClave, crearHash, tokenCsrfValido, validarRegistro } from '../src/seguridad.mjs';

const FRASE = 'una frase de prueba larga';

function baseSimulada() {
  const usuarios = [], roles = [];
  return {
    usuarios, roles,
    async query(sql, p) {
      if (sql.includes('FROM curso')) return { rows: ['DAW-1', 'DAW-2'].includes(p[0]) ? [{ id: 1 }] : [] };
      if (sql.includes('WITH nuevo')) {
        if (!usuarios.some((u) => u.correo === p[1])) {
          const id = usuarios.length + 1;
          usuarios.push({ id, alias: p[0], correo: p[1], hash: p[2], estado: 'pendiente', auth_version: 1 });
          roles.push({ usuario_id: id, rol: 'alumno' });
        }
        return { rows: [] };
      }
      if (sql.includes('FROM usuario WHERE correo')) return { rows: usuarios.filter((u) => u.correo === p[0]) };
      if (sql.includes('FROM usuario WHERE id')) return { rows: usuarios.filter((u) => u.id === p[0]) };
      if (sql.includes('FROM usuario_rol')) return { rows: roles.filter((r) => r.usuario_id === p[0]) };
      throw new Error('consulta no prevista: ' + sql);
    }
  };
}

function sesionSimulada(inicial = {}) {
  const s = {
    destruida: false, regenerada: 0, guardada: 0, ...inicial,
    regenerate(cb) { for (const k of ['usuarioId', 'authVersion', 'creadaEn', 'csrf']) delete s[k]; s.regenerada++; cb(); },
    save(cb) { s.guardada++; cb(); },
    destroy(cb) { s.destruida = true; cb(); }
  };
  return s;
}
function peticion({ cuerpo, sesion = sesionSimulada(), cabeceras = {} } = {}) {
  return { body: cuerpo, session: sesion, get: (n) => cabeceras[n] };
}
function respuesta() {
  const r = { codigo: 200, cuerpo: undefined, cookiesBorradas: [], terminada: false };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  r.end = () => { r.terminada = true; return r; };
  r.clearCookie = (n) => { r.cookiesBorradas.push(n); };
  return r;
}
const nuevoAuth = (bd = baseSimulada()) => ({ bd, auth: crearAuth({ pool: bd, origenPermitido: 'http://127.0.0.1:3000' }) });
const registroValido = { alias: 'Ana', correo: ' Ana@Example.test ', curso: 'DAW-1', contrasena: FRASE };

test('validación: acepta lo válido y cuenta caracteres Unicode', () => {
  assert.equal(validarRegistro(registroValido), null);
  assert.equal(validarRegistro({ ...registroValido, contrasena: '😀'.repeat(15) }), null);   // 15 caracteres, 30 unidades UTF-16
  assert.ok(validarRegistro({ ...registroValido, contrasena: 'a'.repeat(14) }).contrasena);
  assert.ok(validarRegistro({ ...registroValido, contrasena: 'a'.repeat(129) }).contrasena);
});

test('validación: rechaza campos vacíos y campos que el cliente no puede mandar', () => {
  const vacio = validarRegistro({});
  assert.deepEqual(Object.keys(vacio).sort(), ['alias', 'contrasena', 'correo', 'curso']);
  assert.ok(validarRegistro({ ...registroValido, rol: 'admin' }).rol);
  assert.ok(validarRegistro({ ...registroValido, estado: 'activo' }).estado);
  assert.ok(validarRegistro({ ...registroValido, correo: 'sin-arroba' }).correo);
  assert.ok(validarRegistro(null).alias);
});

test('contraseñas: ida y vuelta, sal distinta y formato inválido', async () => {
  const h1 = await crearHash(FRASE), h2 = await crearHash(FRASE);
  assert.notEqual(h1, h2);
  assert.equal(h1.split('$').length, 6);
  assert.ok(!h1.includes(FRASE));
  assert.equal(await comprobarClave(FRASE, h1), true);
  assert.equal(await comprobarClave('otra frase distinta!', h1), false);
  assert.equal(await comprobarClave(FRASE, 'texto-plano'), false);
  await assert.rejects(() => crearHash('corta'));
});

test('csrf: solo vale el token exacto', () => {
  assert.equal(tokenCsrfValido('abc', 'abc'), true);
  assert.equal(tokenCsrfValido('abc', 'abd'), false);
  assert.equal(tokenCsrfValido('abc', 'abcd'), false);
  assert.equal(tokenCsrfValido(undefined, 'abc'), false);
  assert.equal(tokenCsrfValido('abc', undefined), false);
});

test('GET csrf crea un token en la sesión y lo devuelve', () => {
  const { auth } = nuevoAuth(); const req = peticion(), res = respuesta();
  auth.csrf(req, res);
  assert.equal(res.cuerpo.datos.csrf, req.session.csrf);
  assert.equal(req.session.csrf.length, 64);
  const antes = req.session.csrf; auth.csrf(req, respuesta());
  assert.equal(req.session.csrf, antes);
});

test('exigirCsrf: sin token, token erróneo u origen distinto dan 403', () => {
  const { auth } = nuevoAuth();
  const intentar = (req) => { const res = respuesta(); let paso = false; auth.exigirCsrf(req, res, () => { paso = true; }); return { res, paso }; };
  const s = () => sesionSimulada({ csrf: 'tok' });
  assert.equal(intentar(peticion({ sesion: s() })).res.codigo, 403);
  assert.equal(intentar(peticion({ sesion: s(), cabeceras: { 'X-CSRF-Token': 'otro' } })).res.codigo, 403);
  assert.equal(intentar(peticion({ sesion: s(), cabeceras: { 'X-CSRF-Token': 'tok', Origin: 'http://malo.test' } })).res.codigo, 403);
  assert.equal(intentar(peticion({ sesion: s(), cabeceras: { 'X-CSRF-Token': 'tok', Origin: 'http://127.0.0.1:3000' } })).paso, true);
  assert.equal(intentar(peticion({ sesion: s(), cabeceras: { 'X-CSRF-Token': 'tok' } })).paso, true);
});

test('exigirCsrf: acepta una lista de orígenes (127.0.0.1 y localhost)', () => {
  const auth = crearAuth({ pool: baseSimulada(), origenPermitido: ['http://127.0.0.1:3000', 'http://localhost:3000'] });
  const res = respuesta(); let paso = false;
  auth.exigirCsrf(peticion({ sesion: sesionSimulada({ csrf: 't' }), cabeceras: { 'X-CSRF-Token': 't', Origin: 'http://localhost:3000' } }), res, () => { paso = true; });
  assert.equal(paso, true);
});

test('registro: crea cuenta pendiente con rol alumno y hash, y responde 202', async () => {
  const { auth, bd } = nuevoAuth(); const res = respuesta();
  await auth.registro(peticion({ cuerpo: registroValido }), res);
  assert.equal(res.codigo, 202);
  assert.equal(bd.usuarios.length, 1);
  assert.equal(bd.usuarios[0].estado, 'pendiente');
  assert.equal(bd.usuarios[0].correo, 'ana@example.test');
  assert.ok(bd.usuarios[0].hash.startsWith('scrypt$') && !bd.usuarios[0].hash.includes(FRASE));
  assert.deepEqual(bd.roles, [{ usuario_id: 1, rol: 'alumno' }]);
});

test('registro: correo repetido da la misma respuesta 202 y no duplica', async () => {
  const { auth, bd } = nuevoAuth();
  await auth.registro(peticion({ cuerpo: registroValido }), respuesta());
  const res = respuesta();
  await auth.registro(peticion({ cuerpo: { ...registroValido, alias: 'Otra', correo: 'ANA@example.test' } }), res);
  assert.equal(res.codigo, 202);
  assert.equal(bd.usuarios.length, 1);
  assert.equal(bd.usuarios[0].alias, 'Ana');
});

test('registro: rol enviado, curso inexistente o contraseña corta dan 422 y no crean nada', async () => {
  const { auth, bd } = nuevoAuth();
  for (const cuerpo of [{ ...registroValido, rol: 'admin' }, { ...registroValido, curso: 'XXX' }, { ...registroValido, contrasena: 'corta' }]) {
    const res = respuesta();
    await auth.registro(peticion({ cuerpo }), res);
    assert.equal(res.codigo, 422);
    assert.equal(res.cuerpo.error, 'DATOS_INVALIDOS');
  }
  assert.equal(bd.usuarios.length, 0);
});

test('acceso: cuenta inexistente y contraseña incorrecta dan exactamente la misma respuesta', async () => {
  const { auth } = nuevoAuth();
  await auth.registro(peticion({ cuerpo: registroValido }), respuesta());
  const mal = respuesta(), noExiste = respuesta();
  await auth.acceso(peticion({ cuerpo: { correo: 'ana@example.test', contrasena: 'incorrecta incorrecta' } }), mal);
  await auth.acceso(peticion({ cuerpo: { correo: 'nadie@example.test', contrasena: FRASE } }), noExiste);
  assert.equal(mal.codigo, 401);
  assert.deepEqual(mal.cuerpo, noExiste.cuerpo);
  assert.equal(noExiste.codigo, 401);
});

test('acceso correcto: regenera y guarda la sesión, devuelve estado pendiente sin hash', async () => {
  const { auth } = nuevoAuth();
  await auth.registro(peticion({ cuerpo: registroValido }), respuesta());
  const sesion = sesionSimulada({ csrf: 'token-anterior' }), res = respuesta();
  await auth.acceso(peticion({ cuerpo: { correo: 'Ana@example.test', contrasena: FRASE }, sesion }), res);
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.cuerpo, { datos: { alias: 'Ana', estado: 'pendiente', roles: ['alumno'] } });
  assert.equal(sesion.regenerada, 1);
  assert.equal(sesion.guardada, 1);
  assert.equal(sesion.usuarioId, 1);
  assert.notEqual(sesion.csrf, 'token-anterior');
  assert.ok(!JSON.stringify(res.cuerpo).includes('scrypt'));
});

test('acceso: cuerpo incompleto da 422', async () => {
  const { auth } = nuevoAuth(); const res = respuesta();
  await auth.acceso(peticion({ cuerpo: { correo: '' } }), res);
  assert.equal(res.codigo, 422);
});

async function conSesion(bd, auth) {
  await auth.registro(peticion({ cuerpo: registroValido }), respuesta());
  const sesion = sesionSimulada();
  await auth.acceso(peticion({ cuerpo: { correo: 'ana@example.test', contrasena: FRASE }, sesion }), respuesta());
  return sesion;
}
async function pasar(mw, req) {
  const res = respuesta(); let paso = false;
  await mw(req, res, () => { paso = true; });
  return { res, paso };
}

test('requiereSesion: sin sesión, caducada o con auth_version distinta dan 401 y destruyen', async () => {
  const { auth, bd } = nuevoAuth();
  assert.equal((await pasar(auth.requiereSesion, peticion())).res.codigo, 401);

  const sesion = await conSesion(bd, auth);
  const ok = await pasar(auth.requiereSesion, peticion({ sesion }));
  assert.equal(ok.paso, true);

  sesion.creadaEn = Date.now() - 9 * 60 * 60 * 1000;
  const caducada = await pasar(auth.requiereSesion, peticion({ sesion }));
  assert.equal(caducada.res.codigo, 401);
  assert.equal(sesion.destruida, true);
  assert.deepEqual(caducada.res.cookiesBorradas, ['aula.sid']);

  const s2 = await conSesion(bd, auth);
  bd.usuarios[0].auth_version++;
  assert.equal((await pasar(auth.requiereSesion, peticion({ sesion: s2 }))).res.codigo, 401);
});

test('cuenta pendiente: /yo funciona, pero las áreas dan 403; tras activarla pasan', async () => {
  const { auth, bd } = nuevoAuth(); const sesion = await conSesion(bd, auth);
  const req = peticion({ sesion });
  await pasar(auth.requiereSesion, req);
  const yo = respuesta(); auth.yo(req, yo);
  assert.deepEqual(yo.cuerpo, { datos: { alias: 'Ana', estado: 'pendiente', roles: ['alumno'] } });

  assert.equal((await pasar(auth.requiereCuentaActiva, req)).res.codigo, 403);
  bd.usuarios[0].estado = 'activo';
  const req2 = peticion({ sesion }); await pasar(auth.requiereSesion, req2);
  assert.equal((await pasar(auth.requiereCuentaActiva, req2)).paso, true);
  assert.equal((await pasar(auth.requiereRol('alumno', 'docente'), req2)).paso, true);
});

test('requiereRol: un admin sin rol alumno ni docente no entra a las áreas', async () => {
  const { auth, bd } = nuevoAuth(); const sesion = await conSesion(bd, auth);
  bd.usuarios[0].estado = 'activo'; bd.roles.length = 0; bd.roles.push({ usuario_id: 1, rol: 'admin' });
  const req = peticion({ sesion }); await pasar(auth.requiereSesion, req);
  const r = await pasar(auth.requiereRol('alumno', 'docente'), req);
  assert.equal(r.res.codigo, 403);
  assert.equal(r.paso, false);
});

test('salida: destruye la sesión, borra la cookie y responde 204', async () => {
  const { auth } = nuevoAuth(); const sesion = sesionSimulada({ usuarioId: 1 }), res = respuesta();
  await auth.salida(peticion({ sesion }), res);
  assert.equal(sesion.destruida, true);
  assert.deepEqual(res.cookiesBorradas, ['aula.sid']);
  assert.equal(res.codigo, 204);
  assert.equal(res.terminada, true);
});
