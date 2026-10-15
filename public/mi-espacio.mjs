const form=document.querySelector('#anuncio'),mensaje=document.querySelector('#mensaje'),lista=document.querySelector('#anuncios');
let csrf,edicion=null,pagina=1,usuarioId=null;
const estados={borrador:'Borrador',pendiente:'Pendiente de revisión',publicado:'Publicado',rechazado:'Rechazado',retirado:'Retirado'};
function avisar(texto){mensaje.textContent=texto;mensaje.focus();}
async function pedir(ruta,method='GET',body){
  const opciones={method};
  if(method!=='GET') opciones.headers={'Content-Type':'application/json','X-CSRF-Token':csrf};
  if(body!==undefined) opciones.body=JSON.stringify(body);
  const r=await fetch(ruta,opciones);const b=await r.json();
  if(!r.ok){
    if(r.status===401){lista.replaceChildren();document.querySelector('#campos').disabled=true;document.querySelector('#detalle').hidden=true;form.reset();edicion=null;}
    throw new Error(b.mensaje??(b.campos ? Object.entries(b.campos).map(([k,v])=>`${k}: ${v}`).join('\n'):b.error));
  }
  return b;
}
function nuevo(){
  edicion=null;form.reset();document.querySelector('#leyenda').textContent='Nuevo borrador';
  document.querySelector('#guardar').textContent='Guardar borrador';document.querySelector('#detalle').hidden=true;
}
async function identidad(){
  const {datos:u}=await pedir('/api/yo');
  if(usuarioId!==null&&usuarioId!==u.id){nuevo();lista.replaceChildren();}
  usuarioId=u.id;
  document.querySelector('#perfil').textContent=`Cuenta: ${u.alias}. Estado: ${u.estado}.`;
  const permitido=u.estado==='activo'&&u.roles.includes('alumno');
  document.querySelector('#campos').disabled=!permitido;
  if(!permitido){lista.replaceChildren();throw new Error('Necesitas una cuenta de alumno activa para gestionar anuncios.');}
}
async function cargar(){
  await identidad();
  const b=await pedir('/api/mi-espacio?'+new URLSearchParams({pagina,limite:20}));lista.replaceChildren();
  document.querySelector('#pagina').textContent=`Página ${pagina}`;
  document.querySelector('#anterior').disabled=pagina===1;document.querySelector('#siguiente').disabled=b.datos.length<20;
  if(!b.datos.length){const li=document.createElement('li');li.textContent='No hay anuncios propios en esta página.';lista.append(li);}
  for(const a of b.datos){
    const li=document.createElement('li'),t=document.createElement('strong'),p=document.createElement('p'),codigo=document.createElement('p');
    t.textContent=a.titulo;p.textContent=`${estados[a.estado_revision]} · ${a.modalidad} · ${a.curso} · versión ${a.version}`;
    codigo.textContent='Ejemplar: '+a.codigo;li.append(t,p,codigo);
    if(a.motivo){const motivo=document.createElement('p');motivo.textContent='Motivo de revisión anterior: '+a.motivo;li.append(motivo);}
    const ver=document.createElement('button');ver.textContent='Ver detalle e historial';
    ver.addEventListener('click',()=>abrir(a.id,false).catch(e=>avisar(e.message)));li.append(ver);
    if(['borrador','rechazado','publicado'].includes(a.estado_revision)){
      const editar=document.createElement('button');editar.textContent='Editar';
      editar.addEventListener('click',()=>abrir(a.id,true).catch(e=>avisar(e.message)));li.append(editar);
    }
    if(['borrador','rechazado'].includes(a.estado_revision)){
      const enviar=document.createElement('button');enviar.textContent='Enviar a revisión';
      enviar.addEventListener('click',async()=>{
        enviar.disabled=true;
        try{const b=await pedir(`/api/anuncios/${a.id}/enviar`,'POST',{version:a.version});if(edicion?.id===a.id) nuevo();await cargar();avisar(b.mensaje);}
        catch(e){avisar(e.message);enviar.disabled=false;}
      });li.append(enviar);
    }
    lista.append(li);
  }
}
async function abrir(id,editar){
  const {datos:a,historial}=await pedir('/api/anuncios/'+id);
  const h=document.querySelector('#historial');h.replaceChildren();
  for(const e of historial){const li=document.createElement('li');li.textContent=`${new Date(e.creada_en).toLocaleString('es-ES')} · ${e.accion}: ${estados[e.estado_anterior]??'inicio'} → ${estados[e.estado_nuevo]}${e.motivo ? '. '+e.motivo:''}`;h.append(li);}
  document.querySelector('#detalle').hidden=false;
  if(editar){
    for(const nombre of ['titulo','descripcion','cursoId','asignatura','edicion','isbn','conservacion','modalidad']) form.elements.namedItem(nombre).value=a[nombre]??'';
    edicion={id:a.id,version:a.version};document.querySelector('#leyenda').textContent='Editar anuncio '+a.id;
    document.querySelector('#guardar').textContent='Guardar cambios';form.scrollIntoView({behavior:'smooth'});
    if(a.estado_revision==='publicado') avisar('Si cambias sus datos, dejará de aparecer en Libros y necesitará una nueva revisión.');
  }else avisar(`Anuncio ${a.id}: ${a.titulo}. ${estados[a.estado_revision]}. ${a.conservacion}`);
}
form.addEventListener('submit',async e=>{
  e.preventDefault();const boton=document.querySelector('#guardar');boton.disabled=true;
  const datos=Object.fromEntries(new FormData(form));datos.cursoId=Number(datos.cursoId);
  try{
    if(edicion) datos.version=edicion.version;
    const b=await pedir(edicion ? '/api/anuncios/'+edicion.id:'/api/anuncios',edicion ? 'PATCH':'POST',datos);
    nuevo();pagina=1;await cargar();avisar(b.mensaje);
  }catch(e){avisar(e.message);}finally{boton.disabled=false;}
});
document.querySelector('#nuevo').addEventListener('click',nuevo);
document.querySelector('#actualizar').addEventListener('click',()=>cargar().catch(e=>avisar(e.message)));
for(const [id,cambio] of [['anterior',-1],['siguiente',1]]) document.querySelector('#'+id).addEventListener('click',async()=>{
  pagina+=cambio;try{await cargar();}catch(e){avisar(e.message);}
});
try{
  csrf=(await pedir('/api/csrf')).token;
  for(const c of (await pedir('/api/cursos')).datos){const o=document.createElement('option');o.value=c.id;o.textContent=c.nombre;document.querySelector('#curso').append(o);}
  await cargar();
}catch(e){avisar(e.message);}
