import { Router } from 'express';
import { randomUUID } from 'node:crypto';

const campos=['titulo','descripcion','cursoId','asignatura','edicion','isbn','conservacion','modalidad'];
const esId = id => Number.isSafeInteger(id) && id>0;
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
function paginacion(req,res){
  const pagina=Number(req.query.pagina??1),limite=Number(req.query.limite??20);
  if(Object.keys(req.query).some(c=>!['pagina','limite'].includes(c))||!esId(pagina)||pagina>100000||!esId(limite)||limite>20){
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
    const p=paginacion(req,res);if(!p) return;
    const r=await pool.query(`SELECT a.id,r.titulo,r.descripcion,r.asignatura,r.edicion,r.isbn,c.nombre AS curso,
      e.conservacion,e.codigo,a.modalidad FROM anuncio a JOIN ejemplar e ON e.id=a.ejemplar_id
      JOIN recurso r ON r.id=e.recurso_id JOIN curso c ON c.id=r.curso_id
      WHERE a.estado_revision='publicado' AND e.estado_servicio='habilitado'
      ORDER BY a.id DESC LIMIT $1 OFFSET $2`,[p.limite,(p.pagina-1)*p.limite]);
    res.json({datos:r.rows,...p});
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
