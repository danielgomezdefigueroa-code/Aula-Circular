import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';
import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';
import { eliminarArchivoPrivado } from '../src/documentos/archivos.mjs';

const ORIGEN = 'http://127.0.0.1:3000';
const huella = bytes => createHash('sha256').update(bytes).digest('hex');
async function pdf(texto) {
  const doc = await PDFDocument.create();
  doc.addPage([500, 300]).drawText(texto, { x: 30, y: 220, size: 18 });
  return Buffer.from(await doc.save());
}

test('T16 - Cierre de versiones, archivo y cache privada', async () => {
  const esquema = 'aula_t16_' + randomBytes(8).toString('hex');
  const admin = new pg.Pool({ max: 1 });
  let pool, servidor, almacen, creado = false;
  try {
    await admin.query(`CREATE SCHEMA "${esquema}"`);
    creado = true;
    pool = new pg.Pool({ max: 5, options: `-c search_path=${esquema}` });
    const carpeta = new URL('../sql/migraciones/', import.meta.url);
    for (const nombre of (await readdir(carpeta)).filter(n => n.endsWith('.sql')).sort()) {
      await pool.query(await readFile(new URL(nombre, carpeta), 'utf8'));
    }
    const clave = 'Frase segura para pruebas T16 2026';
    const hash = await crearHash(clave);
    for (const [alias, rol, curso] of [['docente','docente',1], ['alumno','alumno',1], ['otro','alumno',2]]) {
      const r = await pool.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,curso_confirmado_id,estado)
        VALUES ($1,$2,$3,$4,$4,'activo') RETURNING id`, [alias, `${alias}@example.invalid`, hash, curso]);
      await pool.query('INSERT INTO usuario_rol(usuario_id,rol) VALUES ($1,$2)', [r.rows[0].id, rol]);
    }
    const aplicacion = await crearAplicacion(pool, { origen: ORIGEN, secreto: randomBytes(32).toString('hex'), esquema, limitar: false });
    almacen = aplicacion.almacen;
    servidor = aplicacion.app.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const base = `http://127.0.0.1:${servidor.address().port}`;
    async function pedir(sesion, ruta, opciones = {}) {
      const r = await fetch(base + ruta, { ...opciones, headers: { Cookie: sesion.cookie ?? '', ...opciones.headers } });
      const cookie = r.headers.getSetCookie()[0];
      if (cookie) sesion.cookie = cookie.split(';')[0];
      const bytes = Buffer.from(await r.arrayBuffer());
      const datos = r.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString()) : bytes;
      if (datos?.token) sesion.token = datos.token;
      return { status: r.status, datos, bytes, headers: r.headers, url: r.url };
    }
    async function acceder(alias) {
      const s = {};
      await pedir(s, '/api/csrf');
      const r = await pedir(s, '/api/acceso', { method: 'POST', headers: { Origin: ORIGEN, 'Content-Type': 'application/json', 'X-CSRF-Token': s.token }, body: JSON.stringify({ correo: `${alias}@example.invalid`, clave }) });
      assert.equal(r.status, 200, JSON.stringify(r.datos));
      return s;
    }
    function escribir(s, ruta, method, body) {
      return pedir(s, ruta, { method, headers: { Origin: ORIGEN, 'X-CSRF-Token': s.token }, ...(body ? { body } : {}) });
    }
    function estado(r, esperado) { assert.equal(r.status, esperado, JSON.stringify(r.datos)); }
    function cache(r) {
      assert.match(r.headers.get('cache-control') ?? '', /\bprivate\b/i);
      assert.match(r.headers.get('cache-control') ?? '', /\bno-store\b/i);
    }
    function descarga(r, esperado, etiqueta) {
      estado(r, 200); cache(r);
      assert.match(r.headers.get('content-type') ?? '', /application\/pdf/i);
      assert.equal(huella(r.bytes), huella(esperado));
      assert.deepEqual(r.bytes, esperado);
      console.log(`${etiqueta}: HTTP 200 | SHA-256 ${huella(r.bytes)} | ${r.headers.get('cache-control')}`);
    }
    function rechazo(r, codigo, etiqueta) {
      estado(r, codigo);
      assert.doesNotMatch(r.headers.get('content-type') ?? '', /application\/pdf/i);
      assert.notEqual(r.bytes.subarray(0, 5).toString(), '%PDF-');
      console.log(`${etiqueta}: HTTP ${r.status} | sin PDF`);
    }
    const docente = await acceder('docente');
    const alumno = await acceder('alumno');
    const otro = await acceder('otro');
    const v1 = await pdf('T16 - D10 DAW1 - V1');
    const v2 = await pdf('T16 - D10 DAW1 - V2');
    const general = await pdf('T16 - D11 GENERAL');
    const daw2 = await pdf('T16 - D12 DAW2');
    assert.notEqual(huella(v1), huella(v2));
    async function alta(titulo, curso, bytes) {
      const f = new FormData();
      f.set('titulo', titulo); f.set('version', 'v1');
      if (curso !== null) f.set('cursoId', String(curso));
      f.set('archivo', new Blob([bytes], { type: 'application/pdf' }), `${titulo.split(' ')[0]}-v1.pdf`);
      const r = await escribir(docente, '/api/documentos', 'POST', f);
      estado(r, 201);
      const id = r.datos.datos.documentoId;
      estado(await escribir(docente, `/api/documentos/${id}/publicar`, 'PATCH'), 200);
      return id;
    }
    async function versiones(id) {
      return (await pool.query(`SELECT v.id, v.documento_id, v.numero_version, v.actual, v.estado_version,
        a.id AS archivo_id, a.ruta, a.sha256,
        to_jsonb(v) - 'actual' - 'estado_version' AS metadatos_version,
        to_jsonb(a) AS metadatos_archivo
        FROM documento_version v JOIN archivo a ON a.id=v.archivo_id
        WHERE v.documento_id=$1 ORDER BY v.numero_version`, [id])).rows;
    }
    const d10 = await alta('D10 T16 DAW1', 1, v1);
    const d11 = await alta('D11 T16 General', null, general);
    const d12 = await alta('D12 T16 DAW2', 2, daw2);
    const f = new FormData();
    f.set('archivo', new Blob([v2], { type: 'application/pdf' }), 'D10-v2.pdf');
    estado(await escribir(docente, `/api/documentos/${d10}/versiones`, 'POST', f), 201);
    const antes = await versiones(d10);
    assert.deepEqual(antes.map(v => [v.documento_id, v.numero_version, v.estado_version, v.actual]), [[d10,1,'vigente',true],[d10,2,'borrador',false]]);
    const [a,b] = antes;
    assert.equal(a.sha256, huella(v1)); assert.equal(b.sha256, huella(v2));
    const estable = `/api/documentos/${d10}/vigente/descargar`;
    const rutaV = id => `/api/documentos/versiones/${id}/descargar`;
    const antigua = id => `/api/documentos/${id}/descargar`;
    const publicar = `/api/documentos/${d10}/versiones/${b.id}/publicar`;
    const archivar = `/api/documentos/${d10}/archivar`;
    console.log('\nP01 - Estado inicial e identificadores');
    console.table((await pool.query(`SELECT d.id,d.codigo,d.titulo,d.curso_id,v.id AS version_id,v.numero_version,v.estado_version,v.actual,a.id AS archivo_id,a.sha256 FROM documento d JOIN documento_version v ON v.documento_id=d.id JOIN archivo a ON a.id=v.archivo_id WHERE d.id=ANY($1::int[]) ORDER BY d.id,v.numero_version`, [[d10,d11,d12]])).rows);
    const listado = await pedir(alumno, `/api/documentos/${d10}/versiones`);
    estado(listado, 200); assert.deepEqual(listado.datos.datos.versiones.map(v => v.version_id), [a.id]);
    const redir1 = await pedir(alumno, estable, { redirect: 'manual' });
    estado(redir1, 307); cache(redir1); assert.equal(redir1.headers.get('location'), rutaV(a.id));
    const inicial = await pedir(alumno, estable);
    descarga(inicial, v1, 'P02 - URL estable inicial');
    rechazo(await pedir(alumno, rutaV(b.id)), 404, 'P03 - Borrador');
    rechazo(await escribir(alumno, publicar, 'PATCH'), 403, 'P03 - Publicacion por alumno');
    // Alterar solamente la huella registrada en el esquema temporal.
    await pool.query('UPDATE archivo SET sha256=$2 WHERE id=$1', [b.archivo_id, '0'.repeat(64)]);
    try {
      rechazo(await escribir(docente, publicar, 'PATCH'), 409, 'P04 - Publicacion fallida');
      assert.deepEqual((await versiones(d10)).map(v => [v.id,v.estado_version,v.actual]), [[a.id,'vigente',true],[b.id,'borrador',false]]);
      descarga(await pedir(alumno, estable), v1, 'P04 - V1 conservada');
    } finally {
      await pool.query('UPDATE archivo SET sha256=$2 WHERE id=$1', [b.archivo_id, b.sha256]);
    }
    estado(await escribir(docente, publicar, 'PATCH'), 200);
    const despues = await versiones(d10);
    assert.deepEqual(despues.map(v => [v.id,v.documento_id,v.estado_version,v.actual]), [[a.id,d10,'historica',false],[b.id,d10,'vigente',true]]);
    for (let i=0;i<2;i++) {
      assert.deepEqual(despues[i].metadatos_version, antes[i].metadatos_version);
      assert.deepEqual(despues[i].metadatos_archivo, antes[i].metadatos_archivo);
    }
    console.log('P05/P06 - V2 vigente; V1 conserva metadatos');
    descarga(await pedir(docente, rutaV(a.id)), v1, 'P06 - V1 historica');
    const redir2 = await pedir(alumno, estable, { redirect: 'manual' });
    estado(redir2, 307); cache(redir2); assert.equal(redir2.headers.get('location'), rutaV(b.id));
    descarga(await pedir(alumno, estable), v2, 'P07 - Misma URL, V2');
    rechazo(await pedir(alumno, rutaV(a.id)), 404, 'P07 - V1 historica alumno');
    rechazo(await pedir(otro, estable), 403, 'P08 - Curso ajeno');
    for (const s of [alumno, otro]) descarga(await pedir(s, `/api/documentos/${d11}/vigente/descargar`), general, 'P09 - General');
    descarga(await pedir(otro, `/api/documentos/${d12}/vigente/descargar`), daw2, 'P10 - DAW2 autorizado');
    rechazo(await pedir(alumno, `/api/documentos/${d12}/vigente/descargar`), 403, 'P10 - DAW1 no autorizado');
    const nueva = await acceder('alumno');
    assert.notEqual(nueva.cookie, alumno.cookie);
    descarga(await pedir(nueva, estable), v2, 'P16 - Sesion nueva');
    const etag = inicial.headers.get('etag');
    if (etag) descarga(await pedir(nueva, estable, { headers: { 'If-None-Match': etag } }), v2, 'P17 - ETag antiguo');
    else console.log('P17 - Sin ETag inicial; no-store verificado');
    rechazo(await escribir(alumno, archivar, 'PATCH'), 403, 'P11 - Archivo por alumno');
    estado(await escribir(docente, archivar, 'PATCH'), 200);
    assert.equal((await pool.query('SELECT estado_editorial FROM documento WHERE id=$1',[d10])).rows[0].estado_editorial,'retirado');
    assert.deepEqual(await versiones(d10), despues);
    console.log('P12 - Archivo por docente; historial intacto');
    for (const s of [alumno, nueva, otro]) {
      for (const ruta of [estable, rutaV(a.id), rutaV(b.id), antigua(a.archivo_id), antigua(b.archivo_id), `/api/documentos/${d10}/versiones`]) {
        rechazo(await pedir(s, ruta), 404, `P13 - Archivado ${ruta}`);
      }
    }
    const catalogo = await pedir(nueva, '/api/documentacion');
    estado(catalogo, 200); assert.ok(!catalogo.datos.datos.some(d => d.id === d10));
    descarga(await pedir(docente, rutaV(a.id)), v1, 'P14 - Docente recupera V1 archivada');
    descarga(await pedir(docente, rutaV(b.id)), v2, 'P14 - Docente recupera V2 archivada');
    const historial = await pedir(docente, `/api/documentos/${d10}/versiones`);
    estado(historial, 200); assert.equal(historial.datos.datos.versiones.length, 2);
    for (const v of [a,b]) {
      for (const ruta of [`/almacen_privado/documentos/${v.ruta}`, `/documentos/${v.ruta}`, `/${v.ruta}`]) {
        rechazo(await pedir({}, ruta), 404, `P15 - Ruta fisica ${ruta}`);
      }
    }
    rechazo(await escribir(docente, publicar, 'PATCH'), 409, 'P18 - Republicar archivado');
    assert.deepEqual(await versiones(d10), despues);
    console.log('T16: recorrido completo superado.');
  } finally {
    try {
      if (servidor) await new Promise((ok, fallo) => { servidor.close(e => e ? fallo(e) : ok()); servidor.closeAllConnections(); });
      almacen?.stopExpiringSessions?.();
      if (pool) {
        try {
          const r = await pool.query('SELECT ruta FROM archivo WHERE almacenamiento_privado=true');
          for (const { ruta } of r.rows) await eliminarArchivoPrivado(ruta);
        } finally { await pool.end(); }
      }
    } finally {
      try { if (creado) await admin.query(`DROP SCHEMA "${esquema}" CASCADE`); }
      finally { await admin.end(); }
    }
    console.log('T16: esquema temporal eliminado.');
  }
});
