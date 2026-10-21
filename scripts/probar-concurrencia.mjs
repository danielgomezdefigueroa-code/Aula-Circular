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
	env: { ...process.env, PGAPPNAME: `concurrencia-${sufijo}`,
  NODE_ENV: 'development', PORT: String(puerto),
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

  // Segunda sesión independiente del mismo docente.
  const segundaSesion = {};
  assert.equal(
    (await peticion(segundaSesion, 'GET', '/api/csrf')).codigo, 200
  );
  assert.equal(
    (await peticion(segundaSesion, 'POST', '/api/acceso', {
      correo: docente.correo,
      clave: docente.clave
    })).codigo, 200
  );
  assert.notEqual(docente.sesion.cookie, segundaSesion.cookie);

  const solicitudes = [];
  for (const alumno of [a01, a02]) {
    const r = await peticion(alumno.sesion, 'POST',
      '/api/solicitudes', { ejemplarId });
    assert.equal(r.codigo, 201);
    solicitudes.push(r.cuerpo.datos.id);
  }

  console.log('CONCURRENCIA HTTP REAL');
  console.log(`Ensayo: ${sufijo} | Ejemplar: ${ejemplarId}`);
  console.log(`Solicitudes: ${solicitudes.join(' y ')}`);
  console.log('Dos sesiones docentes distintas; cookies no mostradas.');

  let bloqueo;
  let abierta = false;
  let pendientes;

  try {
    bloqueo = await pool.connect();
    await bloqueo.query('BEGIN');
    abierta = true;

    // Barrera externa: mantiene ambas asignaciones esperando.
    await bloqueo.query(
      'SELECT id FROM ejemplar WHERE id=$1 FOR UPDATE',
      [ejemplarId]
    );

    const cuerpo = {
      motivo: 'Ensayo de asignaciones simultaneas',
      vencimiento: proponerVencimiento()
    };

    // allSettled recoge también fallos de red sin promesas sin gestionar.
    pendientes = Promise.allSettled([
      peticion(docente.sesion, 'POST',
        `/api/gestion/solicitudes/${solicitudes[0]}/asignar`, cuerpo),
      peticion(segundaSesion, 'POST',
        `/api/gestion/solicitudes/${solicitudes[1]}/asignar`, cuerpo)
    ]);

    let esperando = 0;
    const limite = Date.now() + 3000;

    while (Date.now() < limite) {
      const actividad = await pool.query(`
        SELECT count(*)::integer AS total
        FROM pg_stat_activity
        WHERE datname=current_database()
          AND application_name=$1
          AND wait_event_type='Lock'
          AND query LIKE '%FROM ejemplar%'
      `, [`concurrencia-${sufijo}`]);

      esperando = actividad.rows[0].total;
      if (esperando === 2) break;

      // Solo consulta el estado del ensayo; no altera la aplicación.
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    assert.equal(esperando, 2,
      'No se observaron ambos intentos bloqueados; concurrencia no acreditada');

    console.log('Barrera SQL: 2 peticiones esperando bloqueo, comprobadas.');
    await bloqueo.query('ROLLBACK');
    abierta = false;
    console.log('Barrera liberada: ambas peticiones pueden continuar.');

    const resultados = await pendientes;
    for (const resultado of resultados) {
      if (resultado.status === 'rejected') throw resultado.reason;
    }

    const respuestas = resultados.map(r => r.value);

    respuestas.forEach((r, i) => {
      console.log(
        `\nSesion docente ${i + 1}: POST ` +
        `/api/gestion/solicitudes/${solicitudes[i]}/asignar`
      );
      console.log(`HTTP observado: ${r.codigo}`);
      console.log(JSON.stringify(r.cuerpo));
    });

    assert.deepEqual(
      respuestas.map(r => r.codigo).sort((a, b) => a - b),
      [201, 409]
    );

    const ganadora = respuestas.findIndex(r => r.codigo === 201);
    const operacionId = respuestas[ganadora].cuerpo.datos.id;

    const estado = await pool.query(`
      SELECT
        (SELECT estado_servicio FROM ejemplar WHERE id=$1) AS ejemplar,
        (SELECT count(*)::integer FROM reserva_activa
         WHERE ejemplar_id=$1) AS reservas,
        (SELECT count(*)::integer FROM operacion_item
         WHERE ejemplar_id=$1) AS items,
        (SELECT count(*)::integer FROM operacion
         WHERE docente_id=$2) AS operaciones_del_docente,
        (SELECT count(*)::integer FROM evento_operacion
         WHERE operacion_id=$3 AND accion='asignada') AS eventos_asignacion,
        (SELECT count(*)::integer FROM aviso
         WHERE operacion_id=$3) AS avisos
    `, [ejemplarId, docente.id, operacionId]);

    assert.deepEqual(estado.rows[0], {
      ejemplar: 'reservado',
      reservas: 1,
      items: 1,
      operaciones_del_docente: 1,
      eventos_asignacion: 1,
      avisos: 2
    });

    const detalle = await pool.query(`
      SELECT s.id AS solicitud_id, s.estado,
             r.operacion_id,
             i.destino_usuario_id,
             o.estado AS estado_operacion
      FROM solicitud s
      LEFT JOIN reserva_activa r ON r.ejemplar_id=s.ejemplar_id
      LEFT JOIN operacion_item i
        ON i.operacion_id=r.operacion_id
        AND i.ejemplar_id=r.ejemplar_id
      LEFT JOIN operacion o ON o.id=r.operacion_id
      WHERE s.ejemplar_id=$1
      ORDER BY s.id
    `, [ejemplarId]);

    assert.equal(detalle.rowCount, 2);
    assert.deepEqual(
      detalle.rows.map(r => r.estado).sort(),
      ['asignada', 'rechazada']
    );

    for (const fila of detalle.rows) {
      assert.equal(fila.operacion_id, operacionId);
      assert.equal(fila.estado_operacion, 'reservada');
      assert.equal(
        fila.destino_usuario_id,
        ganadora === 0 ? a01.id : a02.id
      );
    }

    console.log('\nSQL final comprobado:');
    console.log(JSON.stringify(estado.rows[0], null, 2));
    console.log(JSON.stringify(detalle.rows, null, 2));
    console.log('\nRESULTADO: una asignacion 201 y un conflicto 409.');
    console.log('Una operacion completa y una reserva; sin operacion parcial.');
    console.log('No se presupone cual de las dos sesiones gana.');
  } finally {
    try {
      if (bloqueo && abierta) await bloqueo.query('ROLLBACK');
    } finally {
      bloqueo?.release();
      if (pendientes) await pendientes;
    }
  }
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