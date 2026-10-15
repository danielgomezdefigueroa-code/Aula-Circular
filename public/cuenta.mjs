const mensaje=document.querySelector('#mensaje');
let csrf;
async function cargarCsrf(){
  const r=await fetch('/api/csrf');if(!r.ok) throw new Error('No se pudo preparar la sesión.');
  csrf=(await r.json()).token;
}
async function enviar(ruta,datos){
  if(!csrf) await cargarCsrf();
  const r=await fetch(ruta,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(datos)});
  const b=r.status===204 ? {} : await r.json();
  if(!r.ok){if(r.status===401 || b.error==='CSRF_INVALIDO') csrf=undefined;throw new Error(b.mensaje ?? b.error ?? 'No se pudo completar la acción.');}
  if(b.token) csrf=b.token;return b;
}
async function perfil(){
  const r=await fetch('/api/yo');
  const campo=document.querySelector('#perfil');const salida=document.querySelector('#salida');
  document.querySelector('#enlace-docente').hidden=true;
  document.querySelector('#enlace-anuncios').hidden=true;
  if(!r.ok){campo.textContent='No has iniciado sesión.';salida.hidden=true;return;}
  const {datos:u}=await r.json();
  campo.textContent=`Alias: ${u.alias}. Estado: ${u.estado}. Roles: ${u.roles.join(', ')}. Curso solicitado: ${u.curso_solicitado}. Curso confirmado: ${u.curso_confirmado ?? 'pendiente de confirmación'}.`;
  salida.hidden=false;
  document.querySelector('#enlace-docente').hidden=u.estado!=='activo'||!u.roles.includes('docente');
  document.querySelector('#enlace-anuncios').hidden=u.estado!=='activo'||!u.roles.includes('alumno');
}
for(const id of ['registro','acceso']){
  document.querySelector('#'+id).addEventListener('submit',async e=>{
    e.preventDefault();const boton=e.target.querySelector('button');boton.disabled=true;
    const datos=Object.fromEntries(new FormData(e.target));if(id==='registro') datos.cursoId=Number(datos.cursoId);
    try{
      const b=await enviar('/api/'+id,datos);e.target.querySelector('[name=clave]').value='';
      mensaje.textContent=b.mensaje;await perfil();
    }catch(error){mensaje.textContent=error.message;}finally{boton.disabled=false;}
  });
}
document.querySelector('#salida').addEventListener('click',async()=>{
  try{await enviar('/api/salida',{});csrf=undefined;await perfil();mensaje.textContent='Sesión cerrada.';}
  catch(e){mensaje.textContent=e.message;}
});
try{
  await cargarCsrf();
  const r=await fetch('/api/cursos');if(!r.ok) throw new Error('No se pudieron cargar los cursos.');
  for(const curso of (await r.json()).datos){
    const opcion=document.createElement('option');opcion.value=curso.id;opcion.textContent=curso.nombre;
    document.querySelector('#curso').append(opcion);
  }
  await perfil();
}catch(e){mensaje.textContent=e.message;}
