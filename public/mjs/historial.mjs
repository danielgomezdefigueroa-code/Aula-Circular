import { listo, pedir, enviar, leerJson } from './shell.mjs';
const $ = id => document.getElementById(id);
const nombres = {cesion:'Cesión',prestamo:'Préstamo',intercambio:'Intercambio',propuesta:'Propuesta',reservada:'Reservada',
  prestada:'Prestada',completada:'Completada',cancelada:'Cancelada',cerrada_por_incidencia:'Cerrada por incidencia',
  pendiente:'Pendiente',adjudicada:'Adjudicada',rechazada:'Rechazada'};
let pagina=1,ocupado=false;
const acciones={asignar:'Asignación docente',entregar:'Entrega',cancelar:'Cancelación',
  adjudicar_prestamo:'Adjudicación del préstamo',entregar_prestamo:'Entrega del préstamo',
  cancelar_intercambio:'Cancelación del intercambio',devolver_prestamo:'Devolución del préstamo',
  registrar_incidencia:'Registro de incidencia',cerrar_por_incidencia:'Cierre por incidencia'};
const fecha = valor => valor ? new Date(valor).toLocaleString('es-ES') : 'Sin fecha';
function pintar(id,textos) {
  $(id).replaceChildren(...(textos.length?textos:['Sin registros.']).map(texto=>{
    const li=document.createElement('li');li.textContent=texto;return li;
  }));
}
async function respuesta(r) {
  const datos=await leerJson(r);
  if(!r.ok) throw new Error(r.status===401?'Inicia sesión para consultar el historial.':r.status===403?'Tu cuenta no tiene acceso a este historial.':'No se pudo actualizar el historial.');
  return datos;
}
async function cargar() {
  if(ocupado)return;ocupado=true;
  $('estado-historial').textContent='Cargando historial…';
  $('historial-anterior').disabled=true;$('historial-siguiente').disabled=true;
  try {
    const filtro=$('filtro-operacion').value;
    const q=new URLSearchParams({pagina:String(pagina),limite:'10'});if(filtro)q.set('tipo',filtro);
    const [historial,avisos]=await Promise.all([
      pedir('/mi-espacio/historial?'+q).then(respuesta),
      pedir('/avisos?pagina='+pagina+'&limite=10').then(respuesta)
    ]);
    pintar('mis-operaciones',historial.operaciones.map(o=>`${nombres[o.tipo]} #${o.id}: ${nombres[o.estado]}. ${fecha(o.creada_en)}. ${o.items.map(i=>i.titulo+' ('+i.codigo+')').join('; ')}. ${o.siguiente_accion}. Eventos: ${o.eventos.map(e=>(acciones[e.accion]??e.accion)+' por '+e.actor+' - '+fecha(e.fecha)).join('; ')}`));
    pintar('mis-solicitudes',historial.solicitudes.map(s=>`${s.titulo} (${s.codigo}): ${nombres[s.estado]}. ${fecha(s.creada_en)}.`));
    pintar('mis-avisos',[]);
    if(avisos.datos.length)$('mis-avisos').replaceChildren(...avisos.datos.map(aviso=>{
      const li=document.createElement('li'),texto=document.createElement('span');
      texto.textContent=`${aviso.mensaje} - ${fecha(aviso.creado_en)}. ${aviso.leido_en?'Leído el '+fecha(aviso.leido_en):'No leído'}. `;li.append(texto);
      if(!aviso.leido_en){
        const boton=document.createElement('button');boton.type='button';boton.className='boton-sec';boton.textContent='Marcar como leído';
        boton.addEventListener('click',async()=>{
          boton.disabled=true;
          try {await respuesta(await enviar(`/avisos/${aviso.id}/leido`,{}));await cargar();$('estado-historial').textContent='Aviso leído. La operación conserva su estado.';}
          catch(error){$('estado-historial').textContent=error.message;boton.disabled=false;}
        });li.append(boton);
      }return li;
    }));
    $('historial-pagina').textContent='Página '+pagina;
    $('historial-anterior').disabled=pagina===1;$('historial-siguiente').disabled=!historial.hayMas&&avisos.datos.length<10;
    $('estado-historial').textContent='Historial actualizado.';
  } catch(error){
    for(const id of ['mis-operaciones','mis-solicitudes','mis-avisos'])$(id).replaceChildren();
    $('estado-historial').textContent=error.message;
  } finally {ocupado=false;}
}
function activar(identidad){
  const puede=identidad?.estado==='activo' && identidad.roles.some(r=>['alumno','docente'].includes(r));
  $('seccion-operaciones').hidden=!puede;
  if(puede)cargar();else for(const id of ['mis-operaciones','mis-solicitudes','mis-avisos'])$(id).replaceChildren();
}
$('actualizar-operaciones').addEventListener('click',cargar);
$('filtro-operacion').addEventListener('change',()=>{if(!ocupado){pagina=1;cargar();}});
$('historial-anterior').addEventListener('click',()=>{if(!ocupado&&pagina>1){pagina--;cargar();}});
$('historial-siguiente').addEventListener('click',()=>{if(!ocupado){pagina++;cargar();}});
document.addEventListener('aula:sesion',e=>activar(e.detail));
activar(await listo);
