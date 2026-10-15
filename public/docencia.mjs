const mensaje=document.querySelector('#mensaje'),lista=document.querySelector('#cuentas');
let pagina=1,cursos=[],csrf;
async function cargar(){
  lista.replaceChildren();document.querySelector('#anterior').disabled=true;document.querySelector('#siguiente').disabled=true;
  const r=await fetch('/api/gestion/usuarios?'+new URLSearchParams({pagina,limite:20}));
  const b=await r.json();
  if(!r.ok) throw new Error(r.status===401 ? 'Inicia sesión con la cuenta docente en Mi cuenta.' : b.error);
  document.querySelector('#pagina').textContent=`Página ${pagina}`;
  document.querySelector('#anterior').disabled=pagina===1;
  document.querySelector('#siguiente').disabled=b.datos.length<20;
  mensaje.textContent=b.datos.length ? 'Selecciona el curso y confirma cada cuenta revisada.' : 'No hay cuentas pendientes en esta página.';
  for(const u of b.datos){
    const li=document.createElement('li'),nombre=document.createElement('strong'),detalle=document.createElement('p');
    nombre.textContent=u.alias;detalle.textContent='Curso solicitado: '+u.curso_solicitado;
    const label=document.createElement('label');label.textContent='Curso que confirmas: ';
    const select=document.createElement('select');
    for(const curso of cursos){const o=document.createElement('option');o.value=curso.id;o.textContent=curso.nombre;o.selected=curso.id===u.curso_solicitado_id;select.append(o);}
    label.append(select);const boton=document.createElement('button');boton.textContent='Validar cuenta y curso';
    boton.addEventListener('click',async()=>{
      if(!confirm(`¿Has comprobado la pertenencia de ${u.alias} y su curso?`)) return;
      boton.disabled=true;
      try{
        const r=await fetch(`/api/gestion/usuarios/${u.id}/validar`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({cursoId:Number(select.value)})});
        const b=await r.json();if(!r.ok) throw new Error(b.error);
        await cargar();mensaje.textContent=b.mensaje;
      }catch(e){mensaje.textContent=e.message;boton.disabled=false;}
    });
    li.append(nombre,detalle,label,boton);lista.append(li);
  }
}
for(const [id,cambio] of [['anterior',-1],['siguiente',1]]) document.querySelector('#'+id).addEventListener('click',async()=>{
  pagina+=cambio;try{await cargar();}catch(e){mensaje.textContent=e.message;}
});
try{
  const r=await fetch('/api/csrf');if(!r.ok) throw new Error('No se pudo preparar la sesión.');csrf=(await r.json()).token;
  const rc=await fetch('/api/cursos');if(!rc.ok) throw new Error('No se pudieron cargar los cursos.');cursos=(await rc.json()).datos;
  await cargar();
}catch(e){mensaje.textContent=e.message;}
