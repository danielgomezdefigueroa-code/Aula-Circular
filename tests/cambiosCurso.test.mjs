import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';
import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';
import { eliminarArchivoPrivado } from '../src/documentos/archivos.mjs';

test('A01 cambia a DAW-2 con operaciones abiertas y la misma sesión', async t => {
  const esquema = 'aula_cambio_' + randomBytes(8).toString('hex');
  const admin = new pg.Pool({ connectionTimeoutMillis: 3000 });
  await admin.query('CREATE SCHEMA ' + esquema).catch(async error => {
    await admin.end();
    throw error;
  });
  const pool = new pg.Pool({ options: '-c search_path=' + esquema });
  const carpeta = new URL('../sql/migraciones/', import.meta.url);
  const internos = [];
  let servidor;
  let almacen;
  t.after(async () => {
    try {
      if (servidor?.listening) await new Promise(resolve => servidor.close(resolve));
      await almacen?.close();
      await pool.end();
      await admin.query('DROP SCHEMA ' + esquema + ' CASCADE');
    } finally {
      await admin.end();
      await Promise.all(internos.map(eliminarArchivoPrivado));
    }
  });
  for (const archivo of (await readdir(carpeta)).filter(nombre => nombre.endsWith('.sql')).sort()) {
    await pool.query(await readFile(new URL(archivo, carpeta), 'utf8'));
  }

  async function fila(sql, valores) {
    return (await pool.query(sql, valores)).rows[0];
  }

  const clave = randomUUID() + 'A1!';
  const hash = await crearHash(clave);
  const usuarios = {};
  for (const [alias, rol, curso] of [['Docente', 'docente', 1], ['A01', 'alumno', 1], ['A02', 'alumno', 2]]) {
    const { id } = await fila('INSERT INTO usuario(alias, correo, hash, curso_solicitado_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [alias, alias.toLowerCase() + '@example.invalid', hash, curso]);
    usuarios[alias] = id;
    await pool.query('INSERT INTO usuario_rol VALUES ($1,$2)', [id, rol]);
    await pool.query(`UPDATE usuario SET estado='activo', curso_confirmado_id=$2,
      validado_por=$3, validado_en=now() WHERE id=$1`, [id, curso, usuarios.Docente]);
  }

  async function ejemplar(codigo, propietario, curso) {
    const { id: recurso } = await fila(`INSERT INTO recurso(origen,tipo,titulo,curso_id,asignatura,edicion)
      VALUES($1,'fisico',$2,$3,'Programación','1') RETURNING id`,
      [propietario ? 'alumno' : 'centro', 'Material ' + codigo, curso]);
    return (await fila(`INSERT INTO ejemplar(recurso_id,codigo,propietario_usuario_id,conservacion)
      VALUES($1,$2,$3,'Buen estado') RETURNING id`, [recurso, codigo, propietario])).id;
  }

  const material = await ejemplar('PRE-001', null, 1);
  const libro1 = await ejemplar('LIB-001', usuarios.A01, 1);
  const libro2 = await ejemplar('LIB-002', usuarios.A02, 2);
  const cedido = await ejemplar('LIB-003', usuarios.A02, 2);
  const { id: anuncio1 } = await fila("INSERT INTO anuncio(ejemplar_id,modalidad,estado_revision) VALUES($1,'intercambio','publicado') RETURNING id", [libro1]);
  const { id: anuncio2 } = await fila("INSERT INTO anuncio(ejemplar_id,modalidad,estado_revision) VALUES($1,'intercambio','publicado') RETURNING id", [libro2]);
  await pool.query("UPDATE ejemplar SET estado_servicio='retirado' WHERE id=$1", [cedido]);
  const { id: prestamo } = await fila(`INSERT INTO operacion(tipo,estado,docente_id,vencimiento,entregada_en)
    VALUES('prestamo','prestada',$1,now()+interval '7 days',now()) RETURNING id`, [usuarios.Docente]);
  const { id: propuesta } = await fila("INSERT INTO operacion(tipo,estado) VALUES('intercambio','propuesta') RETURNING id");
  const { id: cesion } = await fila(`INSERT INTO operacion(tipo,estado,docente_id,entregada_en,cerrada_en)
    VALUES('cesion','completada',$1,now(),now()) RETURNING id`, [usuarios.Docente]);
  await pool.query(`INSERT INTO operacion_item VALUES
    ($1,$2,NULL,$3),($4,$5,$3,$6),($4,$7,$6,$3),($8,$9,$6,$3)`,
    [prestamo, material, usuarios.A01, propuesta, libro1, usuarios.A02, libro2, cesion, cedido]);
  await pool.query('INSERT INTO reserva_activa VALUES($1,$2)', [material, prestamo]);
  await pool.query('INSERT INTO intercambio VALUES($1,$2,$3,$4,$5,$6,$7,1,1)',
    [propuesta, usuarios.A01, usuarios.A02, libro1, libro2, anuncio1, anuncio2]);
  await pool.query('INSERT INTO aceptacion_intercambio(operacion_id,usuario_id) VALUES($1,$2)', [propuesta, usuarios.A01]);
  await pool.query(`INSERT INTO evento_operacion(operacion_id,actor_id,accion)
    VALUES($1,$4,'entregar_prestamo'),($2,$5,'proponer_intercambio'),($3,$4,'entregar_cesion')`,
    [prestamo, propuesta, cesion, usuarios.Docente, usuarios.A01]);

  const origen = 'http://127.0.0.1:3000';
  const aplicacion = await crearAplicacion(pool, {
    origen, esquema, secreto: randomBytes(32).toString('hex'), limitar: false
  });
  almacen = aplicacion.almacen;
  servidor = aplicacion.app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const base = 'http://127.0.0.1:' + servidor.address().port + '/api';

  async function pedir(sesion, ruta, estado = 200, { metodo = 'GET', datos } = {}) {
    const headers = { Cookie: sesion.cookie ?? '', Origin: origen, 'X-CSRF-Token': sesion.token ?? '' };
    const formulario = datos instanceof FormData;
    if (datos && !formulario) headers['Content-Type'] = 'application/json';
    const respuesta = await fetch(base + ruta, {
      headers, method: metodo, body: formulario ? datos : JSON.stringify(datos)
    });
    const cookie = respuesta.headers.getSetCookie()[0];
    if (cookie) sesion.cookie = cookie.split(';')[0];
    const cuerpo = respuesta.headers.get('content-type')?.includes('application/json')
      ? await respuesta.json() : Buffer.from(await respuesta.arrayBuffer());
    if (cuerpo.token) sesion.token = cuerpo.token;
    assert.equal(respuesta.status, estado, ruta + ' ' + JSON.stringify(cuerpo).slice(0, 300));
    return cuerpo;
  }

  async function acceder(alias) {
    const sesion = {};
    await pedir(sesion, '/csrf');
    await pedir(sesion, '/acceso', 200, {
      metodo: 'POST', datos: { correo: alias.toLowerCase() + '@example.invalid', clave }
    });
    return sesion;
  }

  const docente = await acceder('Docente');
  const alumno = await acceder('A01');
  const otro = await acceder('A02');
  const cookieAlumno = alumno.cookie;
  const documentos = [];
  for (const [titulo, curso] of [['Documento DAW-1', 1], ['Documento DAW-2', 2], ['Documento general', null]]) {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText(titulo);
    const bytes = await pdf.save();
    const datos = new FormData();
    datos.set('titulo', titulo);
    if (curso) datos.set('cursoId', String(curso));
    datos.set('version', 'v1');
    datos.set('archivo', new Blob([bytes], { type: 'application/pdf' }), 'prueba.pdf');
    const { datos: doc } = await pedir(docente, '/documentos', 201, { metodo: 'POST', datos });
    internos.push((await fila('SELECT ruta FROM archivo WHERE id=$1', [doc.archivoId])).ruta);
    await pedir(docente, '/documentos/' + doc.documentoId + '/publicar', 200, { metodo: 'PATCH' });
    documentos.push(doc);
  }

  async function acceso(curso) {
    const lista = (await pedir(alumno, '/documentacion')).datos.map(doc => doc.id).sort();
    assert.deepEqual(lista, [documentos[curso - 1].documentoId, documentos[2].documentoId].sort());
    assert.deepEqual((await pedir(alumno, '/documentacion?curso=' + (3 - curso))).datos, []);
    for (const [indice, doc] of documentos.entries()) {
      const esperado = indice === 2 || indice === curso - 1 ? 200 : 403;
      const descarga = await pedir(alumno, '/documentos/' + doc.archivoId + '/descargar', esperado);
      if (esperado === 200) assert.equal(descarga.subarray(0, 4).toString(), '%PDF');
      const { id: version } = await fila('SELECT id FROM documento_version WHERE documento_id=$1 AND actual', [doc.documentoId]);
      await pedir(alumno, '/documentos/versiones/' + version + '/descargar', esperado);
    }
  }

  async function operaciones() {
    return (await pool.query(`
      SELECT o.*, (SELECT count(*)::int FROM reserva_activa r WHERE r.operacion_id=o.id) AS reservas,
        (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.ejemplar_id) FROM operacion_item i WHERE i.operacion_id=o.id) AS items,
        (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM evento_operacion e WHERE e.operacion_id=o.id) AS eventos
      FROM operacion o ORDER BY o.id
    `)).rows;
  }

  await acceso(1);
  const antes = await operaciones();
  assert.deepEqual(antes.map(o => [o.estado, o.reservas]), [['prestada', 1], ['propuesta', 0], ['completada', 0]]);
  const libros = (await pedir(alumno, '/libros?curso=2')).datos;
  assert.ok(libros.some(libro => libro.ejemplar_id === libro2));
  assert.equal((await pedir(alumno, '/yo')).datos.curso_confirmado_id, 1);
  t.diagnostic('Antes: lista DAW-1/general; descargas directas DAW-1/DAW-2/general 200/403/200; catálogo DAW-2 visible.');

  const solicitud = { metodo: 'POST', datos: { cursoId: 2 } };
  const { datos: cambio } = await pedir(alumno, '/mi-espacio/cambio-curso', 201, solicitud);
  assert.equal((await pedir(alumno, '/mi-espacio/cambio-curso', 200, solicitud)).datos.id, cambio.id);
  const confirmar = '/gestion/cambios-curso/' + cambio.id + '/confirmar';
  await pedir(alumno, confirmar, 403, { metodo: 'POST' });
  assert.equal((await pedir(alumno, '/yo')).datos.curso_confirmado_id, 1);
  const vista = (await pedir(docente, '/gestion/cambios-curso')).datos[0];
  assert.deepEqual(vista.operaciones.map(o => o.id), [prestamo, propuesta]);
  const confirmacion = await pedir(docente, confirmar, 200, { metodo: 'POST' });
  await pedir(docente, confirmar, 409, { metodo: 'POST' });
  assert.equal(confirmacion.datos.confirmada_por, usuarios.Docente);
  assert.ok(Date.parse(confirmacion.datos.confirmada_en));
  assert.equal((await pedir(alumno, '/yo')).datos.curso_confirmado_id, 2);
  assert.equal(alumno.cookie, cookieAlumno);
  assert.equal((await pedir(alumno, '/mi-espacio/cambio-curso')).datos, null);
  t.diagnostic('Solicitud 201, reintento 200, confirmación alumno 403, docente 200, repetida 409. Actor y fecha guardados.');

  await acceso(2);
  assert.deepEqual(await operaciones(), antes);
  const panel = (await pedir(alumno, '/mi-espacio/panel')).datos;
  assert.deepEqual(panel.prestamos.map(o => o.id).sort(), [prestamo, propuesta, cesion]);
  assert.ok(panel.avisos.some(a => a.cambio_curso_id === cambio.id));
  assert.ok(!(await pedir(otro, '/mi-espacio/panel')).datos.avisos.some(a => a.cambio_curso_id === cambio.id));
  assert.ok((await pedir(alumno, '/libros?curso=1')).datos.some(libro => libro.ejemplar_id === libro1));
  t.diagnostic('Después: misma sesión; lista DAW-2/general; descargas directas 403/200/200; vencimiento, reserva, ítems y eventos idénticos.');

  await pedir(docente, '/gestion/prestamos/' + prestamo + '/devolver', 200, {
    metodo: 'POST', datos: { confirmoBuenEstado: true, conservacion: 'Buen estado' }
  });
  const despues = await operaciones();
  assert.equal(despues[0].estado, 'completada');
  assert.equal(despues[0].reservas, 0);
  assert.deepEqual(despues[0].items, antes[0].items);
  assert.equal(despues[0].eventos.at(-1).accion, 'devolver_prestamo');
  assert.deepEqual(despues.slice(1), antes.slice(1));
  assert.equal((await fila("SELECT count(*)::int AS total FROM curso WHERE codigo IN ('DAW1','DAW2')")).total, 2);
  t.diagnostic('Devolución HTTP 200: préstamo completado, reserva 0, evento añadido; intercambio, cesión y ambos cursos preservados.');
});
