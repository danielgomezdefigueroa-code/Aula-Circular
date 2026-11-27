import { pedir, enviar, leerJson, irALogin } from './shell.mjs';

export function gestionarDocumento(tarjeta, recurso, actualizar) {
  const id = recurso.id;
  if (!Number.isSafeInteger(id) || id < 1) return;
  const detalle = document.createElement('details');
  const resumen = document.createElement('summary');
  resumen.textContent = 'Ver versiones';
  const zona = document.createElement('div');
  const aviso = document.createElement('p');
  aviso.setAttribute('role','status');
  const lista = document.createElement('ul');
  zona.append(aviso, lista);
  detalle.append(resumen, zona);
  tarjeta.append(detalle);
  let ocupado = false;
  async function operar(ruta, mensaje) {
    if (ocupado) return;
    ocupado = true;
    const botones = [...tarjeta.querySelectorAll('button')];
    botones.forEach(b => b.disabled = true);
    aviso.textContent = 'Procesando…';
    try {
      const r = await enviar(ruta, {}, 'PATCH');
      const cuerpo = await leerJson(r);
      if (r.status === 401) return irALogin();
      if (!r.ok) { aviso.textContent = cuerpo?.error ?? 'No se pudo completar la operación.'; return; }
      await actualizar(mensaje);
    } catch { aviso.textContent = 'No se pudo contactar con el servidor. Actualiza el catálogo para comprobar el resultado.'; }
    finally { ocupado = false; botones.forEach(b => b.disabled = false); }
  }
  function boton(texto, accion) {
    const b = document.createElement('button'); b.type='button'; b.className='boton-sec'; b.textContent=texto;
    b.addEventListener('click',accion); return b;
  }
  detalle.addEventListener('toggle', async () => {
    if (!detalle.open) return;
    lista.replaceChildren(); aviso.textContent='Cargando versiones…';
    try {
      const r = await pedir(`/documentos/${id}/versiones`);
      const cuerpo = await leerJson(r);
      if (r.status===401) return irALogin();
      if (!r.ok) { aviso.textContent=cuerpo?.error ?? 'No se pudieron consultar las versiones.'; return; }
      const filas = cuerpo?.datos?.versiones ?? [];
      aviso.textContent = filas.length ? '' : 'Sin versiones.';
      for (const v of filas) {
        const li = document.createElement('li');
        const p = document.createElement('p');
        p.textContent=`V${v.numero_version} · ${v.estado_version}`;
        const a = document.createElement('a'); a.className='boton-sec'; a.textContent=`Descargar V${v.numero_version}`;
        a.href=`/api/documentos/versiones/${v.version_id}/descargar`;
        li.append(p,a);
        if(v.estado_version==='borrador' && recurso.estado!=='retirado') li.append(boton(`Publicar V${v.numero_version}`,()=>{
          if(confirm(`¿Publicar V${v.numero_version} de ${recurso.titulo}?`)) operar(`/documentos/${id}/versiones/${v.version_id}/publicar`,'Versión publicada correctamente.');
        }));
        lista.append(li);
      }
    } catch { aviso.textContent='No se pudieron cargar las versiones.'; }
  });
  if(recurso.estado!=='retirado') tarjeta.append(boton('Archivar documento',()=>{
    if(confirm(`¿Archivar ${recurso.titulo}? El alumnado dejará de tener acceso.`)) {
      detalle.open=true;
      operar(`/documentos/${id}/archivar`,'Documento archivado correctamente.');
    }
  }));
}
