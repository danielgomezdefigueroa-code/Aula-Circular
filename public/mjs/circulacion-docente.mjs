import {listo,pedir,enviar,leerJson} from './shell.mjs';
const zona=document.querySelector('#circulacion'),lista=zona.querySelector('ul'),mensaje=zona.querySelector('[role=status]'),form=zona.querySelector('form');
let pagina=1,peticion=0;
const nodo=(tag,texto)=>{const e=document.createElement(tag);e.textContent=texto;return e;};
async function cargar(){
 const turno=++peticion;
 const q=new URLSearchParams(new FormData(form));for(const [k,v] of [...q])if(!v)q.delete(k);q.set('pagina',pagina);q.set('limite',10);
 const r=await pedir('/gestion/cola?'+q),b=await leerJson(r);if(turno!==peticion)return;
 if(!r.ok){lista.replaceChildren();throw Error(b?.error??'No se pudo cargar la cola.');}
 lista.replaceChildren();mensaje.textContent=`${b.total} pendientes · Página ${pagina}`;
 zona.querySelector('[data-prev]').disabled=pagina===1;zona.querySelector('[data-next]').disabled=pagina*10>=b.total;
 for(const x of b.datos){
  const li=nodo('li','');li.className='tarjeta';
  li.append(nodo('h3',`${x.accion} · ${x.modalidad} #${x.id}`),nodo('p',`${x.estado} · ${new Date(x.fecha).toLocaleDateString('es-ES')}${x.vencimiento?' · Vence '+new Date(x.vencimiento).toLocaleDateString('es-ES'):''}`));
  const resumen=x.materiales.map(m=>`${m.titulo} (ejemplar ${m.ejemplar}; ${m.origen?'origen #'+m.origen:'centro'} → ${m.destinatario?'destinatario #'+m.destinatario:'propietario'})`).join(' / ');
  li.append(nodo('p',resumen),nodo('p','Condición: '+x.condicion),nodo('p',x.habilitada?'Condiciones previas verificadas.':('Falta resolver: '+x.faltan.join('; '))));
  for(const m of x.materiales)li.append(nodo('p',`Ejemplar ${m.ejemplar}: edición ${m.edicion}; conservación ${m.conservacion}.`));
  const label=nodo('label','Motivo breve / conservación '),motivo=document.createElement('input');motivo.maxLength=500;label.append(motivo);li.append(label);
  let fecha;
  if(x.accion==='entregar'&&x.modalidad==='prestamo'){
   const l=nodo('label','Fecha de vencimiento ');fecha=document.createElement('input');fecha.type='date';const d=new Date();d.setDate(d.getDate()+14);fecha.value=d.toISOString().slice(0,10);l.append(fecha);li.append(l);
  }
  const botones=[];
  async function accion(texto,ruta,datos){
   if(!window.confirm(`${texto}\n${resumen}\nEstado: ${x.estado}. ${x.condicion}`))return;
   botones.forEach(b=>b.disabled=true);
   try{const r=await enviar(ruta,datos),b=await leerJson(r);if(!r.ok){await cargar();throw Error(b?.error??'No se pudo confirmar.');}await cargar();mensaje.textContent=`Confirmado: ${texto}. Estado del servidor: ${b.datos.estado??b.datos.estado_revision}.`;}
   catch(e){mensaje.textContent=e.message+' Consulta la cola actual antes de repetir.';botones.forEach(b=>b.disabled=false);}
  }
  function boton(texto,ruta,datos){const b=nodo('button',texto);b.type='button';if(!x.habilitada&&!/resolver|cancelar|incidencias|revision/.test(ruta))b.disabled=true;b.onclick=()=>accion(texto,ruta,datos());botones.push(b);li.append(b);}
  if(x.accion==='revisar')for(const [decision,t] of [['aprobar','Aprobar'],['rechazar','Rechazar con motivo']])boton(t,`/gestion/anuncios/${x.id}/revision`,()=>({version:x.version,decision,motivo:motivo.value}));
  else if(x.accion==='asignar'){
   if(x.modalidad==='intercambio')boton('Reservar ambos',`/gestion/intercambios/${x.id}/reservar`,()=>({version:x.version}));
   else boton('Asignar y reservar',`/gestion/solicitudes/${x.id}/asignar`,()=>({motivo:motivo.value}));
  }else{
   const base=`/gestion/operaciones/${x.id}/`;
   boton(x.accion==='entregar'?'Confirmar entrega':'Confirmar devolución',base+x.accion,()=>({version:x.version,...(fecha?{vencimiento:fecha.value}:{}),...(x.accion==='devolver'?{conservacion:motivo.value}:{})}));
   boton('Registrar incidencia',base+'incidencias',()=>({version:x.version,motivo:motivo.value}));
   if(x.estado==='reservada')boton('Cancelar reserva',base+'cancelar',()=>({version:x.version,motivo:motivo.value}));
   for(const [resolucion,t] of [['apto','Resolver incidencia: material apto'],...(x.modalidad==='prestamo'?[['baja','Resolver: baja del ejemplar']]:[])])boton(t,base+'resolver',()=>({version:x.version,motivo:motivo.value,resolucion}));
  }
  lista.append(li);
 }
}
const actualizar=()=>cargar().catch(e=>mensaje.textContent=e.message);
form.onsubmit=e=>{e.preventDefault();pagina=1;actualizar();};
zona.querySelector('[data-prev]').onclick=()=>{pagina--;actualizar();};zona.querySelector('[data-next]').onclick=()=>{pagina++;actualizar();};
function iniciar(u){peticion++;lista.replaceChildren();if(u?.estado==='activo'&&u.roles.includes('docente'))actualizar();else mensaje.textContent='Necesitas permiso docente activo.';}
iniciar(await listo);document.addEventListener('aula:sesion',e=>iniciar(e.detail));
