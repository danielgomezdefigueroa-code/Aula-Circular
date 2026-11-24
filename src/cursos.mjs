const fallo = (codigo, mensaje) =>
  Object.assign(new Error(mensaje), { codigo });

export function cursoMaterialPermitido(cursoAlumno, cursoMaterial) {
  return cursoAlumno !== 'DAW1' || cursoMaterial !== 'DAW2';
}

export async function comprobarRecepcionMaterial(conexion, usuarioId, recursoId) {
  const resultado = await conexion.query(
    `SELECT curso_alumno.codigo AS curso_alumno,
            curso_material.codigo AS curso_material
     FROM usuario u
     LEFT JOIN curso curso_alumno
       ON curso_alumno.id = u.curso_confirmado_id
     JOIN recurso r ON r.id = $2
     LEFT JOIN curso curso_material
       ON curso_material.id = r.curso_id
     WHERE u.id = $1`,
    [usuarioId, recursoId]
  );

  if (!resultado.rowCount) {
    throw fallo(409, 'MATERIAL_NO_DISPONIBLE');
  }

  const { curso_alumno, curso_material } = resultado.rows[0];
  if (!cursoMaterialPermitido(curso_alumno, curso_material)) {
    throw fallo(403, 'MATERIAL_DE_OTRO_CURSO');
  }
}
