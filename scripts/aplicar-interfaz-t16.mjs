import { readFile, writeFile } from 'node:fs/promises';
const cambios = [];
async function preparar(ruta, fn) { const original = await readFile(ruta,'utf8'); const nuevo = fn(original.replace(/\r\n/g,'\n')); cambios.push([ruta,nuevo]); }
function cambiar(s,a,b) { if(s.split(a).length!==2) throw Error('No se encuentra un ancla única: '+a); return s.replace(a,b); }
await preparar('src/catalogo.mjs', s => {
 const marca = "  // Documentación: sólo versiones vigentes";
 const i=s.indexOf(marca); if(i<0) throw Error('Catálogo no reconocido');
 let t=s.slice(i);
 t=cambiar(t,"['q', 'curso', 'disponible', 'pagina', 'limite']","['q', 'curso', 'disponible', 'pagina', 'limite', 'estado']");
 t=cambiar(t,"const esDocente = req.usuario.roles.includes('docente');",`const esDocente = req.usuario.roles.includes('docente');
      const estado = req.query.estado ?? 'publicado';
      if (!['publicado', 'retirado', 'borrador'].includes(estado)) return parametrosInvalidos(res);
      if (estado !== 'publicado' && !esDocente) return res.status(403).json({error:'PERMISO_INSUFICIENTE'});`);
 t=cambiar(t,'JOIN documento_version v\n','LEFT JOIN documento_version v\n');
 t=cambiar(t,"WHERE d.estado_editorial = 'publicado'", "WHERE d.estado_editorial = $9\n            AND (d.estado_editorial <> 'publicado' OR v.id IS NOT NULL)");
 t=cambiar(t,'req.usuario.curso_confirmado_id, esDocente, desplazamiento]','req.usuario.curso_confirmado_id, esDocente, desplazamiento, estado]');
 return s.slice(0,i)+t;
});
await preparar('public/mjs/catalogo-comun.mjs',s=>{
 s=cambiar(s,"publicado: 'Publicado',","publicado: 'Publicado',\n  retirado: 'Archivado',\n  borrador: 'Borrador',");
 s=cambiar(s,"recurso.seccion === 'documentacion' && recurso.modalidad === 'descarga' &&", "recurso.seccion === 'documentacion' && recurso.estado === 'publicado' && recurso.modalidad === 'descarga' &&\n      Number.isSafeInteger(recurso.id) && recurso.id > 0 &&");
 return s;
});
await preparar('public/mjs/documentacion.mjs',s=>{
 s=cambiar(s,"import { cargarCursos } from './filtros-catalogo.mjs';", "import { cargarCursos } from './filtros-catalogo.mjs';\nimport { gestionarDocumento } from './gestion-documentos.mjs';");
 s=cambiar(s,"const limite = 20;",`const filtroEstado = document.querySelector('#doc-estado');
const zonaEstado = document.querySelector('#doc-estado-zona');
const esDocente = () => identidad?.estado === 'activo' && identidad.roles.includes('docente');
const limite = 20;`);
 s=cambiar(s,"parametros.set('pagina', String(pagina));", "if (esDocente()) parametros.set('estado', filtroEstado.value);\n  parametros.set('pagina', String(pagina));");
 s=cambiar(s,'async function cargar() {',`async function cargar() {
  zonaEstado.hidden = !esDocente();
  filtroEstado.disabled = !esDocente();
  if (!esDocente()) filtroEstado.value = 'publicado';`);
 s=cambiar(s,'lista.replaceChildren(...datos.map(crearTarjeta));',`lista.replaceChildren(...datos.map(recurso => {
      const tarjeta = crearTarjeta(recurso);
      if (esDocente()) gestionarDocumento(tarjeta, recurso, async mensaje => {
        await cargar();
        mostrar(mensaje);
        cuenta.tabIndex = -1;
        cuenta.focus();
      });
      return tarjeta;
    }));`);
 s=cambiar(s,"formulario.addEventListener('submit'", "filtroEstado.addEventListener('change', () => { pagina = 1; cargar(); });\n\nformulario.addEventListener('submit'");
 return s;
});
await preparar('public/html/documentacion.html',s=>cambiar(s,'<div class="acciones-filtros">',`<div id="doc-estado-zona" hidden>
            <label for="doc-estado">Estado documental</label>
            <select id="doc-estado" disabled>
              <option value="publicado">Publicados</option>
              <option value="borrador">Borradores</option>
              <option value="retirado">Archivados</option>
            </select>
          </div>
          <div class="acciones-filtros">`));
for(const [ruta,nuevo] of cambios) await writeFile(ruta,nuevo);
console.log('T16: interfaz y catálogo actualizados.');
