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
  const [docente, a01, a02] = cuentas;
  const { proponerVencimiento } = await import('../src/prestamos/fechas.mjs');
  const vencimiento = proponerVencimiento();

  console.log('ENSAYO HTTP DE ASIGNACION Y ENTREGA');
  console.log(`Ensayo: ${sufijo} | Ejemplar: ${ejemplarId}`);

  async function comprobar(nombre, sesion, ruta, cuerpo, esperado, csrf = true) {
    const r = await peticion(sesion, 'POST', ruta, cuerpo, csrf);
    console.log(`\n${nombre}: POST ${ruta}`);
    console.log(`Esperado: ${esperado} | Observado: ${r.codigo}`);
    console.log(JSON.stringify(r.cuerpo));
    assert.equal(r.codigo, esperado, nombre);
    return r;
  }

  // Fotografía de los datos relevantes, sin secretos.
  async function estadoSQL() {
    const r = await pool.query(`
      SELECT
        (SELECT estado_servicio FROM ejemplar WHERE id=$1) AS ejemplar,
        (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]')
         FROM solicitud s WHERE s.ejemplar_id=$1) AS solicitudes,
        (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.operacion_id), '[]')
         FROM operacion_item i WHERE i.ejemplar_id=$1) AS items,
        (SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.id), '[]')
         FROM operacion o WHERE o.id IN
           (SELECT operacion_id FROM operacion_item WHERE ejemplar_id=$1)
        ) AS operaciones,
        (SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]')
         FROM reserva_activa r WHERE r.ejemplar_id=$1) AS reservas,
        (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.id), '[]')
         FROM evento_operacion e WHERE e.operacion_id IN
           (SELECT operacion_id FROM operacion_item WHERE ejemplar_id=$1)
        ) AS eventos,
        (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]')
         FROM aviso a WHERE a.solicitud_id IN
           (SELECT id FROM solicitud WHERE ejemplar_id=$1)
         OR a.operacion_id IN
           (SELECT operacion_id FROM operacion_item WHERE ejemplar_id=$1)
        ) AS avisos
    `, [ejemplarId]);
    return r.rows[0];
  }

  async function rechazoSinCambios(nombre, sesion, ruta, cuerpo, codigo, csrf = true) {
    const antes = await estadoSQL();
    await comprobar(nombre, sesion, ruta, cuerpo, codigo, csrf);
    assert.deepEqual(await estadoSQL(), antes, nombre + ': datos intactos');
    console.log('SQL: sin cambios tras el rechazo.');
  }

  const s1 = await comprobar('A01 solicita', a01.sesion,
    '/api/solicitudes', { ejemplarId }, 201);
  await comprobar('A02 solicita', a02.sesion,
    '/api/solicitudes', { ejemplarId }, 201);

  const rutaAsignar = `/api/gestion/solicitudes/${s1.cuerpo.datos.id}/asignar`;
  const entrada = { motivo: 'Asignacion de ensayo', vencimiento };

  await rechazoSinCambios('Alumno sin permiso para asignar',
    a01.sesion, rutaAsignar, entrada, 403);

  await rechazoSinCambios('Asignacion sin CSRF',
    docente.sesion, rutaAsignar, entrada, 403, false);

  await rechazoSinCambios('Asignacion con fecha imposible',
    docente.sesion, rutaAsignar,
    { ...entrada, vencimiento: '2026-02-30' }, 422);

  const asignada = await comprobar('Docente asigna',
    docente.sesion, rutaAsignar, entrada, 201);

  const operacionId = asignada.cuerpo.datos.id;
  const reservado = await estadoSQL();

  assert.equal(reservado.ejemplar, 'reservado');
  assert.equal(reservado.operaciones.length, 1);
  assert.equal(reservado.operaciones[0].estado, 'reservada');
  assert.equal(reservado.items.length, 1);
  assert.equal(reservado.items[0].destino_usuario_id, a01.id);
  assert.equal(reservado.reservas.length, 1);
  assert.equal(reservado.reservas[0].operacion_id, operacionId);
  assert.deepEqual(
    reservado.solicitudes.map(s => s.estado).sort(),
    ['asignada', 'rechazada']
  );
  assert.equal(reservado.eventos.length, 1);
  assert.equal(reservado.eventos[0].accion, 'asignada');
  assert.equal(reservado.avisos.length, 2);

  console.log('\nSQL tras asignar:');
  console.log(JSON.stringify(reservado, null, 2));

  const rutaEntregar = `/api/gestion/operaciones/${operacionId}/entregar`;

  await rechazoSinCambios('Alumno sin permiso para entregar',
    a01.sesion, rutaEntregar, { vencimiento }, 403);

  await rechazoSinCambios('Entrega con fecha imposible',
    docente.sesion, rutaEntregar, { vencimiento: '2026-02-30' }, 422);

  await rechazoSinCambios('Entrega con fecha pasada',
    docente.sesion, rutaEntregar, { vencimiento: '2000-01-01' }, 422);

  await comprobar('Entrega correcta',
    docente.sesion, rutaEntregar, { vencimiento }, 200);

  const entregado = await estadoSQL();
  assert.equal(entregado.ejemplar, 'prestado');
  assert.equal(entregado.operaciones[0].estado, 'prestada');
  assert.ok(entregado.operaciones[0].entregada_en);
  assert.equal(entregado.reservas.length, 1);
  assert.equal(entregado.eventos.filter(e => e.accion === 'entregada').length, 1);
  assert.equal(entregado.avisos.filter(a => a.tipo === 'prestamo_entregado').length, 1);

  await rechazoSinCambios('Entrega repetida',
    docente.sesion, rutaEntregar, { vencimiento }, 409);

  console.log('\nSQL final tras entregar y repetir:');
  console.log(JSON.stringify(await estadoSQL(), null, 2));
  console.log('\nRESULTADO: asignacion y entrega comprobadas.');
  console.log('La reserva permanece y no se duplican eventos ni avisos.');
  console.log('Esta prueba NO acredita todavia concurrencia.');
} catch (error) {
  console.error('PRUEBA FALLIDA. Codigo:', error.code || 'sin codigo');
  if (error.code === 'ERR_ASSERTION') {
    console.error('Comprobacion:', error.message);
  }
  process.exitCode = 1;
} finally {
  if (servidor && servidor.exitCode === null) {
    const finalizado = once(servidor, 'exit');
    servidor.kill();
    await finalizado;
  }
  await pool.end();
}