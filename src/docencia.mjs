import { Router } from 'express';

export function rutasDocentes(pool, sesionNecesaria, activaNecesaria) {
  const rutas=Router();
  rutas.use(sesionNecesaria,activaNecesaria,(req,res,next)=>{
    if(!req.usuario.roles.includes('docente')) return res.status(403).json({error:'PERMISO_DOCENTE_NECESARIO'});
    next();
  });
  rutas.get('/usuarios',async(req,res)=>{
    if(Object.keys(req.query).some(c=>!['pagina','limite'].includes(c))) return res.status(422).json({error:'FILTROS_INVALIDOS'});
    const pagina=Number(req.query.pagina ?? 1),limite=Number(req.query.limite ?? 20);
    if(!Number.isSafeInteger(pagina)||pagina<1||pagina>100000||!Number.isSafeInteger(limite)||limite<1||limite>20) {
      return res.status(422).json({error:'PAGINACION_INVALIDA'});
    }
    const r=await pool.query(`SELECT u.id,u.alias,u.estado,u.curso_solicitado_id,c.nombre AS curso_solicitado
      FROM usuario u JOIN curso c ON c.id=u.curso_solicitado_id
      WHERE u.estado='pendiente' ORDER BY u.id LIMIT $1 OFFSET $2`,[limite,(pagina-1)*limite]);
    res.json({datos:r.rows,pagina,limite});
  });
  rutas.post('/usuarios/:id/validar',async(req,res)=>{
    const id=Number(req.params.id),b=req.body;
    if(!Number.isSafeInteger(id)||id<1||!b||Array.isArray(b)||Object.keys(b).some(c=>c!=='cursoId')||
      !Number.isSafeInteger(b.cursoId)||b.cursoId<1) return res.status(422).json({error:'DATOS_INVALIDOS'});
    const cliente=await pool.connect();
    try{
      await cliente.query('BEGIN');
      // Bloquea actor y destinatario en el mismo orden para evitar cruces de bloqueos.
      const cuentas=await cliente.query(`SELECT id,estado,auth_version FROM usuario
        WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE`,[[req.usuario.id,id]]);
      const actor=cuentas.rows.find(u=>u.id===req.usuario.id);
      const rol=await cliente.query("SELECT 1 FROM usuario_rol WHERE usuario_id=$1 AND rol='docente'",[req.usuario.id]);
      if(!actor||actor.estado!=='activo'||!rol.rowCount){
        await cliente.query('ROLLBACK');return res.status(403).json({error:'PERMISO_DOCENTE_NECESARIO'});
      }
      // La identidad de sesión debe seguir vigente después de adquirir el bloqueo.
      if(actor.auth_version!==req.session.authVersion){
        await cliente.query('ROLLBACK');return res.status(401).json({error:'SESION_CADUCADA'});
      }
      const usuario=cuentas.rows.find(u=>u.id===id);
      if(!usuario){await cliente.query('ROLLBACK');return res.status(404).json({error:'CUENTA_NO_DISPONIBLE'});}
      if(usuario.estado!=='pendiente'){
        await cliente.query('ROLLBACK');return res.status(409).json({error:'CUENTA_YA_REVISADA'});
      }
      const curso=await cliente.query('SELECT id FROM curso WHERE id=$1 AND activo FOR SHARE',[b.cursoId]);
      if(!curso.rowCount){await cliente.query('ROLLBACK');return res.status(422).json({error:'CURSO_INVALIDO'});}
      await cliente.query(`UPDATE usuario SET estado='activo',curso_confirmado_id=$1,
        validado_por=$2,validado_en=now(),auth_version=auth_version+1 WHERE id=$3`,[b.cursoId,req.usuario.id,id]);
      await cliente.query(`INSERT INTO evento_cuenta(usuario_id,actor_id,accion,curso_id)
        VALUES($1,$2,'validar_pertenencia',$3)`,[id,req.usuario.id,b.cursoId]);
      await cliente.query('COMMIT');
      res.json({mensaje:'Cuenta y curso validados. El alumno debe volver a iniciar sesión.'});
    }catch(e){await cliente.query('ROLLBACK');throw e;}finally{cliente.release();}
  });
  return rutas;
}
