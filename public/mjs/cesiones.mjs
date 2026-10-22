let token,docente=false,pagina=1;
const mensaje=document.querySelector('#mensaje');
async function api(url,body){const r=await fetch('/api'+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)});const b=await r.json();if(!r.ok)throw new Error(b.error);return b;}
function fila(lista,texto){const li=document.createElement('li'),p=document.createElement('p');p.textContent=texto;li.append(p);document.querySelector('#'+lista).append(li);return li;}
function motivo(li,titulo){const label=document.createElement('label'),input=document.createElement('input');label.textContent=titulo;input.maxLength=1000;label.append(input);li.append(label);return input;}
function boton(li,texto,accion){const b=document.createElement('button');b.textContent=texto;b.onclick=async()=>{b.disabled=true;try{await accion();await cargar();mensaje.textContent='Acción confirmada. Estado actualizado.';}catch(e){mensaje.textContent=e.message+'; actualiza el estado antes de repetir.';b.disabled=false;}};li.append(b);}
async function cargar(){
 for(const id of ['anuncios','solicitudes','operaciones','avisos'])document.querySelector('#'+id).replaceChildren();
 const q='?'+new URLSearchParams({pagina,limite:20});
 if(docente){document.querySelector('#revision').hidden=false;for(const a of (await api('/gestion/anuncios'+q)).datos){const li=fila('anuncios',`#${a.id} · ${a.titulo} · edición ${a.edicion} · curso ${a.curso_id} · ${a.asignatura} · ${a.conservacion} · fotografía: no aportada (opcional)`);const m=motivo(li,'Motivo de revisión (obligatorio al rechazar)');for(const decision of ['aprobar','rechazar'])boton(li,decision,()=>api(`/gestion/anuncios/${a.id}/revision`,{version:a.version,decision,motivo:m.value}));}}
 const solicitudes=(await api('/solicitudes'+q)).datos;
 for(const s of solicitudes){const li=fila('solicitudes',`Solicitud #${s.id} · ${s.titulo} · ${s.estado}`);if(s.estado==='pendiente'){if(docente){const m=motivo(li,'Motivo de asignación, breve y sin datos sensibles');boton(li,'Asignar cesión',()=>api(`/gestion/solicitudes/${s.id}/asignar`,{motivo:m.value}));}else boton(li,'Cancelar solicitud',()=>api(`/solicitudes/${s.id}/cancelar`,{}));}}
 const ops=(await api('/operaciones'+q)).datos;
 for(const o of ops){const li=fila('operaciones',`Operación #${o.id} · ${o.titulo} · ${o.estado} · origen #${o.origen_usuario_id} · destinatario #${o.destino_usuario_id}${o.entregada_en?' · entrega: '+new Date(o.entregada_en).toLocaleString('es-ES'):''}`);if(docente&&o.estado==='reservada'){boton(li,'Confirmar entrega definitiva',async()=>{if(!confirm('¿Confirmas que se ha entregado el ejemplar definitivamente?'))return;await api(`/gestion/operaciones/${o.id}/entregar`,{});});const m=motivo(li,'Motivo de cancelación antes de entrega');boton(li,'Cancelar reserva',()=>api(`/gestion/operaciones/${o.id}/cancelar`,{motivo:m.value}));}}
 for(const a of (await api('/avisos'+q)).datos)fila('avisos',a.mensaje);
 document.querySelector('#pagina').textContent='Página '+pagina;document.querySelector('#anterior').disabled=pagina===1;mensaje.textContent='Datos actualizados. Las solicitudes expresan interés; solo el docente reserva.';
}
for(const [id,cambio] of [['anterior',-1],['siguiente',1]])document.querySelector('#'+id).onclick=()=>{pagina+=cambio;cargar().catch(e=>mensaje.textContent=e.message);};
try{token=(await api('/csrf')).token;docente=(await api('/yo')).datos.roles.includes('docente');await cargar();}catch(e){mensaje.textContent=e.message+'. Inicia sesión con una cuenta activa.';}
