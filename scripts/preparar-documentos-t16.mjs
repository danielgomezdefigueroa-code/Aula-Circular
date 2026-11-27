import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Ejecutar con el servidor local iniciado. No modifica documentos existentes.
const base = process.env.APP_ORIGIN;
const correo = process.env.T16_DOCENTE_CORREO;
const clave = process.env.T16_DOCENTE_CLAVE;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error('APP_ORIGIN debe ser el origen local del servidor.');
if (!correo || !clave) throw Error('Faltan T16_DOCENTE_CORREO y T16_DOCENTE_CLAVE.');
let cookie = '', token = '';
async function pedir(ruta, metodo = 'GET', cuerpo) {
  const headers = { Cookie: cookie };
  if (metodo !== 'GET') Object.assign(headers, { Origin: base, 'X-CSRF-Token': token });
  if (cuerpo && !(cuerpo instanceof FormData)) {
    headers['Content-Type'] = 'application/json'; cuerpo = JSON.stringify(cuerpo);
  }
  const r = await fetch(base + ruta, { method: metodo, headers, body: cuerpo, redirect: 'error' });
  const c = r.headers.getSetCookie().find(x => x.startsWith('aula.sid='));
  if (c) cookie = c.split(';')[0];
  const datos = await r.json();
  if (datos.token) token = datos.token;
  if (!r.ok) throw Error(`${metodo} ${ruta}: HTTP ${r.status} ${datos.error ?? ''}`);
  return datos;
}
await pedir('/api/csrf');
await pedir('/api/acceso', 'POST', { correo, clave });
try {
  const { datos: yo } = await pedir('/api/yo');
  assert.ok(yo.estado === 'activo' && yo.roles.includes('docente'), 'Se necesita una cuenta docente activa.');
  const { datos: cursos } = await pedir('/api/cursos');
  const curso = codigo => { const c = cursos.find(c => c.codigo === codigo); assert.ok(c, `Falta ${codigo}`); return c.id; };
  const daw1 = curso('DAW1'), daw2 = curso('DAW2');
  const docs = [ ['D10 T16 DEMO DAW1', daw1], ['D11 T16 DEMO General', null], ['D12 T16 DEMO DAW2', daw2] ];
  // Revisar todos los estados antes de escribir para evitar duplicados, incluso archivados.
  for (const [titulo] of docs) for (const estado of ['publicado','borrador','retirado']) {
    const r = await pedir('/api/documentacion?' + new URLSearchParams({ q: titulo, estado, limite: '20' }));
    if (r.total > 0) throw Error(`Ya existen coincidencias de ${titulo} (${estado}). No se crean duplicados. Revisa el catálogo.`);
  }
  async function formulario(titulo, cursoId, version, inicial) {
    const pdf = await PDFDocument.create();
    const p = pdf.addPage([595, 420]);
    p.drawText('AULA CIRCULAR - T16', { x: 40, y: 350, size: 23 });
    p.drawText(titulo, { x: 40, y: 300, size: 18 });
    p.drawText(`Version ${version} - Documento ficticio de ensayo`, { x: 40, y: 260, size: 14 });
    const bytes = Buffer.from(await pdf.save());
    const f = new FormData();
    if (inicial) { f.set('titulo', titulo); f.set('version', 'v1'); if (cursoId !== null) f.set('cursoId', String(cursoId)); }
    f.set('archivo', new Blob([bytes], {type:'application/pdf'}), `${titulo.split(' ')[0]}-demo-v${version}.pdf`);
    return { f, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  for (const [titulo, cursoId] of docs) {
    const { f, sha256 } = await formulario(titulo, cursoId, 1, true);
    const { datos: alta } = await pedir('/api/documentos', 'POST', f);
    const id = alta.documentoId;
    await pedir(`/api/documentos/${id}/publicar`, 'PATCH');
    console.log(`${titulo} | documento ${id} | V1 publicada | SHA-256 ${sha256}`);
    if (titulo.startsWith('D10')) {
      const v2 = await formulario(titulo, cursoId, 2, false);
      await pedir(`/api/documentos/${id}/versiones`, 'POST', v2.f);
      console.log(`${titulo} | documento ${id} | V2 borrador | SHA-256 ${v2.sha256}`);
    }
    const { datos } = await pedir(`/api/documentos/${id}/versiones`);
    console.table(datos.versiones.map(v => ({ version_id:v.version_id, numero:v.numero_version, estado:v.estado_version, sha256:v.sha256 })));
  }
  console.log('T16: documentos de demostracion preparados.');
} finally { await pedir('/api/salida','POST',{}).catch(()=>{}); }
