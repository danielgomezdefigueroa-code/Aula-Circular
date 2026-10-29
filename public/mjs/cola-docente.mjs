import {listo,pedir,enviar,leerJson} from './shell.mjs';
let pagina=1;
const lista=document.querySelector('#cola-anuncios'),estado=document.querySelector('#estado-revision');
async function cargar(){
 lista.replaceChildren();const r=await pedir('/gestion/anuncios?'+new URLSearchParams({pagina,limite:20})),b=await leerJson(r);
 if(!r.ok)throw Error(b?.error??'No se pudo cargar la revisión.');
 estado.textContent=b.datos.length?'Revisa los datos y escribe un motivo breve al devolver.':'No hay anuncios pendientes.';
 document.querySelector('#revision-pagina').textContent='Página '+pagina;
 document.querySelector('#revision-anterior').disabled=pagina===1;document.querySelector('#revision-siguiente').disabled=b.datos.length<20;
 for(const a of b.datos){const li=document.createElement('li');li.className='tarjeta';const h=document.createElement('h3'),p=document.createElement('p'),label=document.createElement('label'),motivo=document.createElement('input'),enlace=document.createElement('a');
 h.textContent=a.titulo;p.textContent=`Anuncio #${a.id} · ${a.asignatura} · edición ${a.edicion} · ${a.conservacion}`;
 enlace.href='libros.html?id='+encodeURIComponent(a.id);enlace.textContent='Consultar Libros';label.textContent='Motivo breve (obligatorio para devolver)';motivo.maxLength=1000;label.append(motivo);li.append(h,p,enlace,label);
 for(const [decision,texto] of [['aprobar','Aprobar anuncio'],['rechazar','Devolver con motivo']]){const btn=document.createElement('button');btn.textContent=texto;btn.onclick=async()=>{btn.disabled=true;try{const r=await enviar(`/gestion/anuncios/${a.id}/revision`,{version:a.version,decision,motivo:motivo.value}),b=await leerJson(r);if(!r.ok)throw Error(b?.error);await cargar();estado.textContent='Revisión registrada con responsable y fecha.';}catch(e){estado.textContent=e.message;btn.disabled=false;}};li.append(btn);}lista.append(li);
 }
}
for(const [id,n] of [['revision-anterior',-1],['revision-siguiente',1]])document.getElementById(id).onclick=()=>{pagina+=n;cargar().catch(e=>estado.textContent=e.message);};
function iniciar(u){if(u?.estado==='activo'&&u.roles.includes('docente'))cargar().catch(e=>estado.textContent=e.message);else{lista.replaceChildren();estado.textContent='Necesitas permiso docente activo.';document.querySelector('#revision-anterior').disabled=true;document.querySelector('#revision-siguiente').disabled=true;}}
iniciar(await listo);document.addEventListener('aula:sesion',e=>iniciar(e.detail));
