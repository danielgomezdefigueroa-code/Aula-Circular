// Prueba HTTP real de la parte de Daniel. Solo usa la base local del Sprint 3.
// Deja datos ficticios identificables por un sufijo distinto en cada ejecucion.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { crearHash } from '../src/cuentas/contraseñas.mjs';

if (process.env.PGDATABASE !== 'aula_circular_sprint3_ensayo' ||
    !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) ||
    process.env.PGUSER !== 'aula_app') {
  throw new Error('Usa exclusivamente la base local del Sprint 3 como aula_app.');
}
const pool = new pg.Pool({ connectionTimeoutMillis: 4000 });
let servidor;
const sufijo = randomUUID().slice(0, 8);

try {
  // Preparamos identidades propias del test. Las claves solo viven en memoria.
  const cuentas = [];
  for (const alias of ['D01', 'A01', 'A02', 'P01']) {
    const clave = randomUUID();
    cuentas.push({ alias, clave, hash: await crearHash(clave), correo: `${alias.toLowerCase()}-${sufijo}@example.test` });
  }
  const cliente = await pool.connect();
  let ejemplarId, propioId, retiradoId;
  try {
    await cliente.query('BEGIN');
    const curso = await cliente.query("SELECT id FROM curso WHERE codigo = 'DAW-1'");
    const categoria = await cliente.query("SELECT id FROM categoria WHERE ambito = 'biblioteca' ORDER BY id LIMIT 1");
    assert.equal(curso.rowCount, 1, 'Falta preparar el curso');
    assert.equal(categoria.rowCount, 1, 'Falta preparar el catalogo');
    for (const cuenta of cuentas) {
      const alta = await cliente.query(`
        INSERT INTO usuario (alias, correo, hash, curso_solicitado_id)
        VALUES ($1, $2, $3, $4) RETURNING id
      `, [`${cuenta.alias}-${sufijo}`, cuenta.correo, cuenta.hash, curso.rows[0].id]);
      cuenta.id = alta.rows[0].id;
      await cliente.query('INSERT INTO usuario_rol (usuario_id, rol) VALUES ($1, $2)',
        [cuenta.id, cuenta.alias === 'D01' ? 'docente' : 'alumno']);
      if (cuenta.alias !== 'P01') {
        // Bootstrap local de ensayo; no es una activacion publica.
        await cliente.query(`UPDATE usuario SET estado = 'activo', curso_confirmado_id = $1,
          validado_por = $2, validado_en = now() WHERE id = $3`,
        [curso.rows[0].id, cuentas[0].id, cuenta.id]);
      }
    }
    const recurso = await cliente.query(`INSERT INTO recurso
      (titulo, tipo, origen, categoria_id, estado_editorial)
      VALUES ($1, 'fisico', 'centro', $2, 'publicado') RETURNING id`,
    [`Ensayo solicitudes ${sufijo}`, categoria.rows[0].id]);
    const ejemplares = await cliente.query(`INSERT INTO ejemplar
      (recurso_id, codigo, estado_servicio)
      VALUES ($1, $2, 'disponible'), ($1, $3, 'retirado') RETURNING id, estado_servicio`,
    [recurso.rows[0].id, `S3-${sufijo}`, `S3-RET-${sufijo}`]);
    ejemplarId = ejemplares.rows.find(e => e.estado_servicio === 'disponible').id;
    retiradoId = ejemplares.rows.find(e => e.estado_servicio === 'retirado').id;
    const propio = await cliente.query(`INSERT INTO recurso
      (titulo, tipo, origen, categoria_id, estado_editorial)
      VALUES ($1, 'fisico', 'alumno', $2, 'publicado') RETURNING id`,
    [`Propio de ensayo ${sufijo}`, categoria.rows[0].id]);
    const ejemplarPropio = await cliente.query(`INSERT INTO ejemplar
      (recurso_id, codigo, propietario_usuario_id) VALUES ($1, $2, $3) RETURNING id`,
    [propio.rows[0].id, `S3-PRO-${sufijo}`, cuentas[1].id]);
    propioId = ejemplarPropio.rows[0].id;
    await cliente.query('COMMIT');
  } catch (error) {
    try { await cliente.query('ROLLBACK'); } catch { /* Mantener el error original. */ }
    throw error;
  } finally { cliente.release(); }

  // Elegimos un puerto libre para no cerrar ni sustituir otros servidores.
  const puertoLibre = createServer();
  await new Promise((resolve, reject) => {
    puertoLibre.once('error', reject);
    puertoLibre.listen(0, '127.0.0.1', resolve);
  });
  const puerto = puertoLibre.address().port;
  await new Promise(resolve => puertoLibre.close(resolve));
  const origen = `http://127.0.0.1:${puerto}`;
  servidor = spawn(process.execPath, ['src/app.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, NODE_ENV: 'development', PORT: String(puerto),
      APP_ORIGIN: origen, SESSION_SECRET: randomBytes(32).toString('hex') },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let errorArranque;
  servidor.on('error', error => { errorArranque = error; });
  // Consumimos las salidas sin imprimir posibles datos de otras capas.
  servidor.stdout.resume();
  servidor.stderr.resume();
  let listo = false;
  for (let intento = 0; intento < 100; intento++) {
    if (errorArranque) throw errorArranque;
    if (servidor.exitCode !== null) throw new Error('El servidor no pudo arrancar');
    try {
      const salud = await fetch(`${origen}/api/salud`, { signal: AbortSignal.timeout(1000) });
      if (salud.status === 200) { listo = true; break; }
    } catch { /* Esperamos solo a que el servidor este preparado. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(listo, 'El servidor no quedo listo');

  // Cada identidad tiene su propia cookie y token, nunca impresos.
  async function peticion(sesion, metodo, ruta, cuerpo, conCsrf = true) {
    const headers = { Origin: origen };
    if (sesion.cookie) headers.Cookie = sesion.cookie;
    if (sesion.token && conCsrf) headers['X-CSRF-Token'] = sesion.token;
    if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
    const respuesta = await fetch(origen + ruta, { method: metodo, headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(5000) });
    const cookie = respuesta.headers.getSetCookie().find(v => v.startsWith('aula.sid='));
    if (cookie) sesion.cookie = cookie.split(';')[0];
    const texto = await respuesta.text();
    const datos = texto ? JSON.parse(texto) : null;
    if (datos?.token) sesion.token = datos.token;
    return { codigo: respuesta.status, cuerpo: datos };
  }
  for (const cuenta of cuentas) {
    cuenta.sesion = {};
    assert.equal((await peticion(cuenta.sesion, 'GET', '/api/csrf')).codigo, 200);
    assert.equal((await peticion(cuenta.sesion, 'POST', '/api/acceso',
      { correo: cuenta.correo, clave: cuenta.clave })).codigo, 200);
  }
  const [docente, a01, a02, pendiente] = cuentas;
  console.log('PRUEBA HTTP REAL | Base: aula_circular_sprint3_ensayo | Usuario BD: aula_app');
  console.log(`Ensayo: ${sufijo} | Ejemplar del centro: ${ejemplarId}`);
  async function comprobar(nombre, sesion, cuerpo, esperado, conCsrf = true, errorEsperado) {
    const r = await peticion(sesion, 'POST', '/api/solicitudes', cuerpo, conCsrf);
    assert.equal(r.codigo, esperado, nombre);
    if (errorEsperado) assert.equal(r.cuerpo.error, errorEsperado, nombre);
    console.log(`${nombre}: POST /api/solicitudes | esperado ${esperado} | observado ${r.codigo}`);
    console.log(JSON.stringify(r.cuerpo));
    return r;
  }
  const alta = await comprobar('A01 solicita', a01.sesion, { ejemplarId }, 201);
  await comprobar('A02 solicita el mismo', a02.sesion, { ejemplarId }, 201);
  const duplicado = await comprobar('A01 repite', a01.sesion, { ejemplarId }, 409, true, 'SOLICITUD_YA_PENDIENTE');
  assert.equal(duplicado.cuerpo.solicitudId, alta.cuerpo.datos.id);
  await comprobar('Sin sesion', {}, { ejemplarId }, 401, true, 'SESION_REQUERIDA');
  await comprobar('Cuenta pendiente', pendiente.sesion, { ejemplarId }, 403, true, 'CUENTA_NO_ACTIVA');
  await comprobar('Docente sin rol alumno', docente.sesion, { ejemplarId }, 403, true, 'PERMISO_INSUFICIENTE');
  await comprobar('Sin CSRF', a01.sesion, { ejemplarId }, 403, false, 'CSRF_INVALIDO');
  await comprobar('Intenta enviar otro solicitante', a01.sesion,
    { ejemplarId, solicitanteId: a02.id }, 422, true, 'DATOS_INVALIDOS');
  await comprobar('Ejemplar propio', a01.sesion, { ejemplarId: propioId }, 422, true, 'NO_PUEDES_SOLICITAR_LO_PROPIO');
  await comprobar('Ejemplar retirado', a01.sesion, { ejemplarId: retiradoId }, 409, true, 'EJEMPLAR_NO_DISPONIBLE');
  await comprobar('ID invalido', a01.sesion, { ejemplarId: '1' }, 422, true, 'DATOS_INVALIDOS');

  const solicitudes = await pool.query(`SELECT s.solicitante_id, s.ejemplar_id, s.estado
    FROM solicitud s WHERE s.solicitante_id = ANY($1::integer[]) ORDER BY s.solicitante_id`,
  [cuentas.map(c => c.id)]);
  assert.deepEqual(solicitudes.rows, [a01, a02].map(c =>
    ({ solicitante_id: c.id, ejemplar_id: ejemplarId, estado: 'pendiente' })));
  const estado = await pool.query(`SELECT estado_servicio,
    (SELECT count(*)::int FROM reserva_activa WHERE ejemplar_id = $1) AS reservas,
    (SELECT count(*)::int FROM operacion_item WHERE ejemplar_id = $1) AS operaciones
    FROM ejemplar WHERE id = $1`, [ejemplarId]);
  assert.deepEqual(estado.rows[0], { estado_servicio: 'disponible', reservas: 0, operaciones: 0 });
  console.log('SQL final: 2 solicitudes pendientes (A01 y A02), 0 reservas, 0 operaciones; ejemplar disponible.');
  console.log('RESULTADO: 11 casos HTTP superados y estado final comprobado en PostgreSQL.');
  console.log('Quedan 4 cuentas y 3 ejemplares ficticios por ejecucion; no se borran datos anteriores.');
} catch (error) {
  console.error('PRUEBA FALLIDA. Codigo:', error.code || 'sin codigo');
  if (error.code === 'ERR_ASSERTION') console.error('Comprobacion:', error.message);
  process.exitCode = 1;
} finally {
  if (servidor && servidor.exitCode === null) {
    const finalizado = once(servidor, 'exit');
    servidor.kill();
    await finalizado;
  }
  await pool.end();
}
