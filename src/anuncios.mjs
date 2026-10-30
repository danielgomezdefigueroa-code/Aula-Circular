import { Router } from 'express';
import { randomUUID } from 'node:crypto';

const campos=['titulo','descripcion','cursoId','asignatura','edicion','isbn','conservacion','modalidad'];
const esId = id => Number.isSafeInteger(id) && id>0;
function normalizarBusqueda(texto){
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
// Expresión SQL para buscar sin distinguir mayúsculas ni acentos.
// Las columnas que se pasan son siempre nombres fijos de este archivo.
function sinAcentos(columna){
  return `translate(lower(${columna}), 'áéíóúüñ', 'aeiouun')`;
}
function leerFiltrosLibros(req){
  const q=req.query.q;
  if(q!==undefined&&(typeof q!=='string'||q.trim().length>80)) return null;
  const curso=req.query.curso;
  if(curso!==undefined&&curso!==''&&
    (typeof curso!=='string'||!/^\d+$/.test(curso)||!esId(Number(curso))||Number(curso)>2147483647)) return null;
  const modalidad=req.query.modalidad;
  if(modalidad!==undefined&&modalidad!==''&&!['cesion','prestamo','intercambio'].includes(modalidad)) return null;
  const disponible=req.query.disponible;
  if(disponible!==undefined&&disponible!==''&&disponible!=='0'&&disponible!=='1') return null;
  return {
    texto:normalizarBusqueda(String(q??'').trim()),
    cursoId:curso?Number(curso):null,
    modalidad:modalidad??'',
    soloDisponibles:disponible==='1'
  };
}
function validar(cuerpo,esEdicion=false){
  const errores={};
  if(!cuerpo || typeof cuerpo!=='object' || Array.isArray(cuerpo)) return {errores:{formulario:'Datos no válidos.'}};
  if(Object.keys(cuerpo).some(c=>![...campos,...(esEdicion ? ['version']:[])].includes(c))) {
    errores.formulario='Hay campos no admitidos. El propietario y el estado los decide el servidor.';
  }
  const datos={};
  for(const [campo,min,max] of [['titulo',1,120],['descripcion',0,2000],['asignatura',1,100],['edicion',1,100],['conservacion',1,500]]){
    const valor=cuerpo[campo] ?? (campo==='descripcion' ? '':undefined);
    if(typeof valor!=='string'||valor.trim().length<min||valor.trim().length>max) errores[campo]=`Introduce entre ${min} y ${max} caracteres.`;
    else datos[campo]=valor.trim();
  }
  if(!esId(cuerpo.cursoId)) errores.cursoId='Selecciona un curso válido.';
  else datos.cursoId=cuerpo.cursoId;
  if(!['cesion','prestamo','intercambio'].includes(cuerpo.modalidad)) errores.modalidad='Selecciona una modalidad válida.';
  else datos.modalidad=cuerpo.modalidad;
  const isbn=cuerpo.isbn ?? '';
  if(typeof isbn!=='string') errores.isbn='Introduce un ISBN válido o deja el campo vacío.';
  else {
    const limpio=isbn.replace(/[ -]/g,'').toUpperCase();
    let valido=!limpio;
    if(/^\d{13}$/.test(limpio)) valido=[...limpio].reduce((n,d,i)=>n+Number(d)*(i%2 ? 3:1),0)%10===0;
    if(/^\d{9}[\dX]$/.test(limpio)) valido=[...limpio].reduce((n,d,i)=>n+(d==='X' ? 10:Number(d))*(10-i),0)%11===0;
    if(!valido||isbn.length>25) errores.isbn='El ISBN no es válido. Puedes dejarlo vacío si no existe.';
    else datos.isbn=limpio||null;
  }
  if(esEdicion&&!esId(cuerpo.version)) errores.version='Recarga el anuncio antes de guardarlo.';
  return {errores,datos};
}
const seleccion=`SELECT a.id,a.ejemplar_id,a.modalidad,a.estado_revision,a.motivo,a.version,a.creada_en,a.actualizada_en,
  r.titulo,r.descripcion,r.curso_id AS "cursoId",c.nombre AS curso,r.asignatura,r.edicion,r.isbn,
  e.codigo,e.conservacion,e.propietario_usuario_id
  FROM anuncio a JOIN ejemplar e ON e.id=a.ejemplar_id JOIN recurso r ON r.id=e.recurso_id
  JOIN curso c ON c.id=r.curso_id`;
function paginacion(req,res,extras=[]){
  const permitidos=['pagina','limite',...extras];
  const pagina=Number(req.query.pagina??1),limite=Number(req.query.limite??20);
  if(Object.keys(req.query).some(c=>!permitidos.includes(c))||!esId(pagina)||pagina>100000||!esId(limite)||limite>20){
    res.status(422).json({error:'PAGINACION_INVALIDA'});return null;
  }
  return {pagina,limite};
}

export function rutasAnuncios(pool,sesionNecesaria,activaNecesaria){
  const rutas=Router();
  const alumno=(req,res,next)=>req.usuario.roles.includes('alumno') ? next():res.status(403).json({error:'PERMISO_ALUMNO_NECESARIO'});
  const proteger=[sesionNecesaria,activaNecesaria,alumno];
  rutas.get('/mi-espacio',...proteger,async(req,res)=>{
    const p=paginacion(req,res);if(!p) return;
    const r=await pool.query(seleccion+' WHERE e.propietario_usuario_id=$1 ORDER BY a.id DESC LIMIT $2 OFFSET $3',
      [req.usuario.id,p.limite,(p.pagina-1)*p.limite]);
    res.json({datos:r.rows,...p});
  });
  rutas.get('/anuncios/:id',...proteger,async(req,res)=>{
    const id=Number(req.params.id);if(!esId(id)) return res.status(422).json({error:'ID_INVALIDO'});
    const r=await pool.query(seleccion+' WHERE a.id=$1 AND e.propietario_usuario_id=$2',[id,req.usuario.id]);
    if(!r.rowCount) return res.status(404).json({error:'ANUNCIO_NO_DISPONIBLE'});
    const eventos=await pool.query(`SELECT accion,estado_anterior,estado_nuevo,motivo,creada_en FROM evento_anuncio
      WHERE anuncio_id=$1 ORDER BY id DESC LIMIT 100`,[id]);
    res.json({datos:r.rows[0],historial:eventos.rows});
  });
  rutas.get('/libros',sesionNecesaria,activaNecesaria,async(req,res)=>{
    if(!req.usuario.roles.some(r=>['alumno','docente'].includes(r))) return res.status(403).json({error:'PERMISO_INSUFICIENTE'});
    const p=paginacion(req,res,['q','curso','modalidad','disponible']);if(!p) return;
    const filtros=leerFiltrosLibros(req);
    if(!filtros) return res.status(422).json({error:'PARAMETROS_INVALIDOS'});
    const titulo=sinAcentos('r.titulo');
    const descripcion=sinAcentos('r.descripcion');
    const asignatura=sinAcentos('r.asignatura');
    const edicion=sinAcentos('r.edicion');
    const isbn=sinAcentos("COALESCE(r.isbn, '')");
    const curso=sinAcentos('c.nombre');
    const codigo=sinAcentos('e.codigo');
    // Un ejemplar está libre si no tiene reserva ni una operación de préstamo en curso.
    const libre=`NOT EXISTS (SELECT 1 FROM reserva_activa ra WHERE ra.ejemplar_id=e.id)
      AND NOT EXISTS (
        SELECT 1 FROM operacion_item oi JOIN operacion o ON o.id=oi.operacion_id
        WHERE oi.ejemplar_id=e.id AND o.estado IN ('reservada','prestada')
      )`;
    const r=await pool.query(`WITH coincidencias AS (
      SELECT a.id,'libros' AS seccion,r.titulo,r.descripcion,r.asignatura,r.edicion,r.isbn,
        c.nombre AS curso,e.conservacion,e.codigo,a.modalidad,
        'fisico' AS tipo,'Estudiantil' AS procedencia,'publicado' AS estado,
        ${libre} AS disponible
      FROM anuncio a JOIN ejemplar e ON e.id=a.ejemplar_id
      JOIN recurso r ON r.id=e.recurso_id JOIN curso c ON c.id=r.curso_id
      WHERE a.estado_revision='publicado' AND e.estado_servicio='habilitado'
        AND (
          $1='' OR
          ${titulo} LIKE '%'||$1||'%' OR
          ${descripcion} LIKE '%'||$1||'%' OR
          ${asignatura} LIKE '%'||$1||'%' OR
          ${edicion} LIKE '%'||$1||'%' OR
          ${isbn} LIKE '%'||$1||'%' OR
          ${curso} LIKE '%'||$1||'%' OR
          ${codigo} LIKE '%'||$1||'%'
        )
        AND ($2::integer IS NULL OR r.curso_id=$2)
        AND ($3='' OR a.modalidad=$3)
        AND (NOT $4::boolean OR ${libre})
    ),recuento AS (
      SELECT count(*)::integer AS total FROM coincidencias
    )
    SELECT recuento.total,pagina.*
    FROM recuento
    LEFT JOIN LATERAL (
      SELECT * FROM coincidencias ORDER BY id DESC LIMIT $5 OFFSET $6
    ) pagina ON true
    ORDER BY pagina.id DESC NULLS LAST`,
      [filtros.texto,filtros.cursoId,filtros.modalidad,filtros.soloDisponibles,p.limite,(p.pagina-1)*p.limite]);
    const total=r.rows[0]?.total??0;
    const datos=r.rows.filter(f=>f.id!==null).map(({total:_total,...f})=>f);
    res.json({datos,total,...p});
  });
  async function transaccion(req,res,accion){
    const cliente=await pool.connect();
    try{
      await cliente.query('BEGIN');
      // Revalida identidad y permiso dentro de la escritura, no solo al entrar en HTTP.
      const u=await cliente.query(`SELECT estado,auth_version,
        EXISTS(SELECT 1 FROM usuario_rol WHERE usuario_id=$1 AND rol='alumno') AS alumno
        FROM usuario WHERE id=$1 FOR SHARE`,[req.usuario.id]);
      if(!u.rowCount||u.rows[0].auth_version!==req.session.authVersion){
        await cliente.query('ROLLBACK');return res.status(401).json({error:'SESION_CADUCADA'});
      }
      if(u.rows[0].estado!=='activo'||!u.rows[0].alumno){
        await cliente.query('ROLLBACK');return res.status(403).json({error:'CUENTA_NO_AUTORIZADA'});
      }
      const resultado=await accion(cliente);
      if(resultado.error){await cliente.query('ROLLBACK');return res.status(resultado.codigo).json(resultado);}
      await cliente.query('COMMIT');res.status(resultado.codigo??200).json(resultado);
    }catch(e){await cliente.query('ROLLBACK');throw e;}finally{cliente.release();}
  }
  async function cursoValido(cliente,id){return (await cliente.query('SELECT id FROM curso WHERE id=$1 AND activo FOR SHARE',[id])).rowCount;}
  async function evento(cliente,id,actor,accion,antes,despues,motivo=''){
    await cliente.query(`INSERT INTO evento_anuncio(anuncio_id,actor_id,accion,estado_anterior,estado_nuevo,motivo)
      VALUES($1,$2,$3,$4,$5,$6)`,[id,actor,accion,antes,despues,motivo]);
  }
  rutas.post('/anuncios',...proteger,async(req,res)=>{
    const {errores,datos:d}=validar(req.body);
    if(Object.keys(errores).length) return res.status(422).json({error:'DATOS_INVALIDOS',campos:errores});
    await transaccion(req,res,async cliente=>{
      if(!await cursoValido(cliente,d.cursoId)) return {codigo:422,error:'CURSO_INVALIDO'};
      const recurso=await cliente.query(`INSERT INTO recurso(origen,tipo,titulo,descripcion,curso_id,asignatura,edicion,isbn)
        VALUES('alumno','fisico',$1,$2,$3,$4,$5,$6) RETURNING id`,[d.titulo,d.descripcion,d.cursoId,d.asignatura,d.edicion,d.isbn]);
      const ejemplar=await cliente.query(`INSERT INTO ejemplar(recurso_id,codigo,propietario_usuario_id,conservacion)
        VALUES($1,$2,$3,$4) RETURNING id`,[recurso.rows[0].id,'LIB-'+randomUUID(),req.usuario.id,d.conservacion]);
      const a=await cliente.query('INSERT INTO anuncio(ejemplar_id,modalidad) VALUES($1,$2) RETURNING id,version,estado_revision',[ejemplar.rows[0].id,d.modalidad]);
      await evento(cliente,a.rows[0].id,req.usuario.id,'crear',null,'borrador');
      return {codigo:201,datos:a.rows[0],mensaje:'Borrador guardado. Todavía no aparece en Libros.'};
    });
  });
  async function bloquear(cliente,id,propietario){
    // Todas las futuras reservas deben bloquear primero ejemplar (por ID), igual que esta ruta.
    const e=await cliente.query(`SELECT e.* FROM ejemplar e JOIN anuncio a ON a.ejemplar_id=e.id
      WHERE a.id=$1 AND e.propietario_usuario_id=$2 FOR UPDATE OF e`,[id,propietario]);
    if(!e.rowCount) return {codigo:404,error:'ANUNCIO_NO_DISPONIBLE'};
    const a=await cliente.query('SELECT * FROM anuncio WHERE id=$1 FOR UPDATE',[id]);
    const ocupado=await cliente.query(`SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1
      UNION ALL SELECT 1 FROM operacion_item oi JOIN operacion o ON o.id=oi.operacion_id
      WHERE oi.ejemplar_id=$1 AND o.estado IN ('reservada','prestada') LIMIT 1`,[e.rows[0].id]);
    if(ocupado.rowCount) return {codigo:409,error:'EJEMPLAR_OCUPADO',mensaje:'Hay una operación activa. Debe resolverla un docente antes de modificar el anuncio.'};
    if(e.rows[0].estado_servicio!=='habilitado'||a.rows[0].estado_revision==='retirado') return {codigo:409,error:'ANUNCIO_RETIRADO'};
    return {anuncio:a.rows[0],ejemplar:e.rows[0]};
  }
  rutas.patch('/anuncios/:id',...proteger,async(req,res)=>{
    const id=Number(req.params.id);if(!esId(id)) return res.status(422).json({error:'ID_INVALIDO'});
    const {errores,datos:d}=validar(req.body,true);
    if(Object.keys(errores).length) return res.status(422).json({error:'DATOS_INVALIDOS',campos:errores});
    await transaccion(req,res,async cliente=>{
      const x=await bloquear(cliente,id,req.usuario.id);if(x.error) return x;
      const a=x.anuncio;
      if(a.version!==req.body.version) return {codigo:409,error:'VERSION_DESACTUALIZADA',mensaje:'Hay una versión más reciente. Recarga el anuncio; tus cambios no se han guardado.'};
      if(!await cursoValido(cliente,d.cursoId)) return {codigo:422,error:'CURSO_INVALIDO'};
      if(a.estado_revision==='pendiente') return {codigo:409,error:'ANUNCIO_EN_REVISION',mensaje:'El anuncio está en revisión. Espera a la respuesta docente.'};
      const actual=(await cliente.query('SELECT * FROM recurso WHERE id=$1',[x.ejemplar.recurso_id])).rows[0];
      const cambio=['titulo','descripcion','asignatura','edicion','isbn'].some(c=>actual[c]!==d[c])||actual.curso_id!==d.cursoId||
        x.ejemplar.conservacion!==d.conservacion||a.modalidad!==d.modalidad;
      if(!cambio) return {datos:{id,version:a.version,estado_revision:a.estado_revision},mensaje:'No hay cambios que guardar.'};
      const estado=a.estado_revision==='publicado' ? 'pendiente':'borrador';
      // Una propuesta sin reserva dependía de los datos anteriores y deja de ser válida.
      const propuestas=await cliente.query(`SELECT o.id FROM operacion o JOIN operacion_item oi ON oi.operacion_id=o.id
        WHERE oi.ejemplar_id=$1 AND o.estado='propuesta' ORDER BY o.id FOR UPDATE OF o`,[x.ejemplar.id]);
      for(const propuesta of propuestas.rows){
        await cliente.query("UPDATE operacion SET estado='cancelada',cerrada_en=now() WHERE id=$1",[propuesta.id]);
        await cliente.query(`INSERT INTO evento_operacion(operacion_id,actor_id,accion,motivo)
          VALUES($1,$2,'cancelar_propuesta','Cambio de los datos del anuncio antes de la reserva.')`,[propuesta.id,req.usuario.id]);
      }
      await cliente.query(`UPDATE recurso SET titulo=$1,descripcion=$2,curso_id=$3,asignatura=$4,edicion=$5,isbn=$6 WHERE id=$7`,
        [d.titulo,d.descripcion,d.cursoId,d.asignatura,d.edicion,d.isbn,x.ejemplar.recurso_id]);
      await cliente.query('UPDATE ejemplar SET conservacion=$1 WHERE id=$2',[d.conservacion,x.ejemplar.id]);
      const r=await cliente.query(`UPDATE anuncio SET modalidad=$1,estado_revision=$2,version=version+1,actualizada_en=now()
        WHERE id=$3 RETURNING id,version,estado_revision`,[d.modalidad,estado,id]);
      await evento(cliente,id,req.usuario.id,'editar',a.estado_revision,estado,
        estado==='pendiente' ? 'Cambio de datos publicados: requiere nueva revisión.':'');
      return {datos:r.rows[0],mensaje:estado==='pendiente' ? 'Cambios guardados. Se retira de Libros hasta una nueva aprobación.':'Borrador actualizado.'};
    });
  });
  rutas.post('/anuncios/:id/enviar',...proteger,async(req,res)=>{
    const id=Number(req.params.id),b=req.body;
    if(!esId(id)||!b||Array.isArray(b)||Object.keys(b).some(c=>c!=='version')||!esId(b.version)) return res.status(422).json({error:'DATOS_INVALIDOS'});
    await transaccion(req,res,async cliente=>{
      const x=await bloquear(cliente,id,req.usuario.id);if(x.error) return x;
      const a=x.anuncio;
      if(a.version!==b.version) return {codigo:409,error:'VERSION_DESACTUALIZADA'};
      if(!['borrador','rechazado'].includes(a.estado_revision)) return {codigo:409,error:'ESTADO_NO_PERMITIDO'};
      const actual=(await cliente.query(seleccion+' WHERE a.id=$1',[id])).rows[0];
      const {errores}=validar(Object.fromEntries(campos.map(c=>[c,actual[c]])));
      if(Object.keys(errores).length) return {codigo:422,error:'DATOS_INVALIDOS',campos:errores};
      if(!await cursoValido(cliente,actual.cursoId)) return {codigo:422,error:'CURSO_INVALIDO'};
      const r=await cliente.query(`UPDATE anuncio SET estado_revision='pendiente',version=version+1,actualizada_en=now()
        WHERE id=$1 RETURNING id,version,estado_revision`,[id]);
      await evento(cliente,id,req.usuario.id,'enviar',a.estado_revision,'pendiente');
      return {datos:r.rows[0],mensaje:'Enviado a revisión. Todavía no aparece en Libros.'};
    });
  });
  return rutas;
}
