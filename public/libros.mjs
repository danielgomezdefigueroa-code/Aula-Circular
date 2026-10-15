let pagina=1;
async function cargar(){
  const lista=document.querySelector('#libros');lista.replaceChildren();
  const r=await fetch('/api/libros?'+new URLSearchParams({pagina,limite:20}));const b=await r.json();
  if(!r.ok) throw new Error(r.status===401 ? 'Inicia sesión en Mi cuenta para consultar Libros.':b.error);
  document.querySelector('#pagina').textContent=`Página ${pagina}`;document.querySelector('#anterior').disabled=pagina===1;
  document.querySelector('#siguiente').disabled=b.datos.length<20;
  document.querySelector('#mensaje').textContent=b.datos.length ? 'Anuncios publicados:':'Todavía no hay anuncios publicados en esta página.';
  for(const a of b.datos){const li=document.createElement('li'),h=document.createElement('h2'),p=document.createElement('p');
    h.textContent=a.titulo;p.textContent=`${a.curso} · ${a.asignatura} · ${a.edicion} · ${a.modalidad}. Conservación: ${a.conservacion}`;
    li.append(h,p);lista.append(li);}
}
for(const [id,cambio] of [['anterior',-1],['siguiente',1]]) document.querySelector('#'+id).addEventListener('click',()=>{pagina+=cambio;cargar().catch(e=>document.querySelector('#mensaje').textContent=e.message);});
cargar().catch(e=>document.querySelector('#mensaje').textContent=e.message);
