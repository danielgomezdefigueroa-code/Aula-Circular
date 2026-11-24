import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { crearHash } from '../src/claves.mjs';

if (process.env.NODE_ENV !== 'development') {
  throw new Error('Solo permitido en el laboratorio local.');
}
if (!['127.0.0.1', 'localhost'].includes(process.env.PGHOST)) {
  throw new Error('Solo permitido contra PostgreSQL local.');
}

function leerUsuarios(texto) {
  const usuarios = [];
  for (const [indice, linea] of texto.split(/\r?\n/).entries()) {
    const campos = linea.trim().split(/\s+/);
    if (!campos[0] || /^Usuario$/i.test(campos[0])) continue;

    if (campos.length === 4 && /^A\d{2}$/.test(campos[0])) {
      usuarios.push({
        alias: campos[0],
        curso: campos[1],
        correo: campos[2].toLowerCase(),
        clave: campos[3],
        rol: 'alumno'
      });
    } else if (campos.length === 2 && campos[0].includes('@')) {
      usuarios.push({
        alias: 'Docente de ensayo',
        curso: 'DAW1',
        correo: campos[0].toLowerCase(),
        clave: campos[1],
        rol: 'docente'
      });
    } else {
      throw new Error(`Formato inesperado en users.md, línea ${indice + 1}.`);
    }
  }

  const correos = new Set();
  for (const usuario of usuarios) {
    if (correos.has(usuario.correo)) {
      throw new Error('users.md contiene correos duplicados.');
    }
    correos.add(usuario.correo);
  }
  if (!usuarios.length) throw new Error('users.md no contiene usuarios.');
  return usuarios;
}

async function obtenerCurso(cliente, codigo) {
  const curso = await cliente.query(
    'SELECT id FROM curso WHERE codigo=$1 AND activo',
    [codigo]
  );
  if (!curso.rowCount) throw new Error(`No existe el curso activo ${codigo}.`);
  return curso.rows[0].id;
}

async function asegurarAnuncioIntercambio(cliente, ejemplarId) {
  const anuncio = await cliente.query(
    'SELECT id, modalidad FROM anuncio WHERE ejemplar_id=$1',
    [ejemplarId]
  );
  if (!anuncio.rowCount) {
    await cliente.query(
      `INSERT INTO anuncio(ejemplar_id,modalidad,estado_revision,version)
       VALUES($1,'intercambio','publicado',1)`,
      [ejemplarId]
    );
    return;
  }
  if (anuncio.rows[0].modalidad !== 'intercambio') {
    await cliente.query(
      `UPDATE anuncio
       SET modalidad='intercambio', version=version+1, actualizada_en=now()
       WHERE id=$1`,
      [anuncio.rows[0].id]
    );
  }
}

async function asegurarEjemplar(cliente, material) {
  const existente = await cliente.query(
    `SELECT e.id, e.propietario_usuario_id, r.titulo, r.origen, r.tipo
     FROM ejemplar e
     JOIN recurso r ON r.id=e.recurso_id
     WHERE e.codigo=$1
     FOR UPDATE OF e`,
    [material.codigo]
  );
  if (existente.rowCount) {
    const fila = existente.rows[0];
    if (fila.titulo !== material.titulo || fila.origen !== 'alumno' || fila.tipo !== 'fisico') {
      throw new Error(`El código ${material.codigo} ya pertenece a otro material.`);
    }
    if (fila.propietario_usuario_id === null) {
      await cliente.query(
        'UPDATE ejemplar SET propietario_usuario_id=$2 WHERE id=$1',
        [fila.id, material.propietarioId]
      );
    }
    await asegurarAnuncioIntercambio(cliente, fila.id);
    return false;
  }

  const cursoId = await obtenerCurso(cliente, material.curso);
  const recursoExistente = await cliente.query(
    `SELECT id FROM recurso
     WHERE origen='alumno' AND tipo='fisico' AND titulo=$1 AND curso_id=$2
     ORDER BY id LIMIT 1`,
    [material.titulo, cursoId]
  );
  let recursoId;
  if (recursoExistente.rowCount) {
    recursoId = recursoExistente.rows[0].id;
  } else {
    const recurso = await cliente.query(
      `INSERT INTO recurso
        (origen,tipo,titulo,descripcion,curso_id,asignatura,edicion)
       VALUES('alumno','fisico',$1,'Material de demostración para intercambio',$2,'General','2026')
       RETURNING id`,
      [material.titulo, cursoId]
    );
    recursoId = recurso.rows[0].id;
  }

  const ejemplar = await cliente.query(
    `INSERT INTO ejemplar(recurso_id,codigo,propietario_usuario_id,conservacion)
     VALUES($1,$2,$3,$4) RETURNING id`,
    [recursoId, material.codigo, material.propietarioId, material.conservacion]
  );
  await asegurarAnuncioIntercambio(cliente, ejemplar.rows[0].id);
  return true;
}

async function asegurarMaterialPorTitulo(cliente, material) {
  const existentes = await cliente.query(
    `SELECT e.id, e.codigo, e.propietario_usuario_id, r.origen, r.tipo
     FROM ejemplar e
     JOIN recurso r ON r.id=e.recurso_id
     WHERE r.titulo=$1 AND r.origen='alumno'
     ORDER BY e.id
     FOR UPDATE OF e`,
    [material.titulo]
  );
  let fila;
  if (existentes.rowCount > 1) {
    const codigoPreferido = existentes.rows.filter(e => e.codigo === material.codigo);
    if (codigoPreferido.length === 1) fila = codigoPreferido[0];
    else throw new Error(`Hay varios ejemplares llamados "${material.titulo}"; no se creó otro.`);
  } else if (existentes.rowCount === 1) {
    fila = existentes.rows[0];
  }

  if (!fila) return asegurarEjemplar(cliente, material);
  if (fila.origen !== 'alumno' || fila.tipo !== 'fisico') {
    throw new Error(`El material "${material.titulo}" no es un ejemplar físico del alumnado.`);
  }
  if (fila.propietario_usuario_id === null) {
    await cliente.query(
      'UPDATE ejemplar SET propietario_usuario_id=$2 WHERE id=$1',
      [fila.id, material.propietarioId]
    );
  }
  await asegurarAnuncioIntercambio(cliente, fila.id);
  return false;
}

async function asignarEjemplarAAlumnoAleatorio(cliente, material, idsAlumnos) {
  const cursoId = await obtenerCurso(cliente, material.curso);
  const ejemplar = await cliente.query(
    `SELECT e.id, e.propietario_usuario_id, r.titulo, r.curso_id
     FROM ejemplar e
     JOIN recurso r ON r.id=e.recurso_id
     WHERE e.codigo=$1
     FOR UPDATE OF e`,
    [material.codigo]
  );
  if (!ejemplar.rowCount) throw new Error(`No existe el ejemplar ${material.codigo}.`);
  const fila = ejemplar.rows[0];
  if (fila.titulo !== material.titulo || fila.curso_id !== cursoId) {
    throw new Error(`${material.codigo} no coincide con el material y curso esperados.`);
  }

  if (fila.propietario_usuario_id !== null) {
    const propietarioActual = await cliente.query(
      `SELECT u.id
       FROM usuario u
       JOIN usuario_rol r ON r.usuario_id=u.id AND r.rol='alumno'
       WHERE u.id=$1 AND u.estado='activo' AND u.curso_confirmado_id=$2`,
      [fila.propietario_usuario_id, cursoId]
    );
    if (propietarioActual.rowCount) return false;
  }

  const elegido = await cliente.query(
    `SELECT u.id
     FROM usuario u
     JOIN usuario_rol r ON r.usuario_id=u.id AND r.rol='alumno'
     WHERE u.id=ANY($1::integer[])
       AND u.estado='activo'
       AND u.curso_confirmado_id=$2
     ORDER BY (
       SELECT count(*)
       FROM ejemplar asignado
       WHERE asignado.propietario_usuario_id=u.id
     ), random()
     LIMIT 1
     FOR UPDATE OF u`,
    [idsAlumnos, cursoId]
  );
  if (!elegido.rowCount) {
    throw new Error(`No hay alumnos activos de ${material.curso} disponibles para ${material.codigo}.`);
  }

  await cliente.query(
    'UPDATE ejemplar SET propietario_usuario_id=$2 WHERE id=$1',
    [fila.id, elegido.rows[0].id]
  );
  return true;
}

const pool = new pg.Pool({ max: 1, connectionTimeoutMillis: 3000 });
let cliente;
try {
  const usuarios = leerUsuarios(await readFile(new URL('./users.md', import.meta.url), 'utf8'));
  cliente = await pool.connect();
  await cliente.query('BEGIN');
  await cliente.query('SELECT pg_advisory_xact_lock(71003)');

  const ids = new Map();
  const idsAlumnos = [];
  let usuariosCreados = 0;
  let usuariosExistentes = 0;
  for (const usuario of usuarios) {
    const cursoId = await obtenerCurso(cliente, usuario.curso);
    const existente = await cliente.query(
      'SELECT id FROM usuario WHERE correo=$1',
      [usuario.correo]
    );
    let usuarioId;
    if (existente.rowCount) {
      usuarioId = existente.rows[0].id;
      usuariosExistentes++;
    } else {
      const hash = await crearHash(usuario.clave);
      const creado = await cliente.query(
        `INSERT INTO usuario
          (alias,correo,hash,curso_solicitado_id,curso_confirmado_id,estado)
         VALUES($1,$2,$3,$4,$4,'activo')
         ON CONFLICT(correo) DO NOTHING
         RETURNING id`,
        [usuario.alias, usuario.correo, hash, cursoId]
      );
      if (creado.rowCount) {
        usuarioId = creado.rows[0].id;
        usuariosCreados++;
      } else {
        const trasConflicto = await cliente.query(
          'SELECT id FROM usuario WHERE correo=$1',
          [usuario.correo]
        );
        if (!trasConflicto.rowCount) throw new Error('No se pudo resolver un usuario existente.');
        usuarioId = trasConflicto.rows[0].id;
        usuariosExistentes++;
      }
    }
    await cliente.query(
      'INSERT INTO usuario_rol(usuario_id,rol) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [usuarioId, usuario.rol]
    );
    ids.set(usuario.alias, usuarioId);
    if (usuario.rol === 'alumno') idsAlumnos.push(usuarioId);
  }

  const materiales = [
    { codigo: 'EJ-LA-03', titulo: 'Ejercicios de bases de datos', curso: 'DAW1', propietario: 'A02', conservacion: 'bueno' },
    { codigo: 'EJ-LA-04', titulo: 'HTML y formularios', curso: 'DAW2', propietario: 'A06', conservacion: 'aceptable' }
  ];
  let materialesCreados = 0;
  for (const material of materiales) {
    const propietarioId = ids.get(material.propietario);
    if (!propietarioId) throw new Error(`No se encontró el usuario ${material.propietario}.`);
    if (await asegurarEjemplar(cliente, { ...material, propietarioId })) materialesCreados++;
  }

  const propietarioId = ids.get('A01');
  if (!propietarioId) throw new Error('No se encontró el usuario A01.');
  if (await asegurarMaterialPorTitulo(cliente, {
    codigo: 'EJ-LA-07',
    titulo: 'Iniciación a la programación - JAVA',
    curso: 'DAW1',
    propietarioId,
    conservacion: 'bueno'
  })) materialesCreados++;

  const ejemplaresAsignados = [
    { codigo: 'EJ-LA-06', titulo: 'Diseño web responsive', curso: 'DAW2' },
    { codigo: 'EJ-LA-05', titulo: 'Fundamentos de JavaScript', curso: 'DAW1' },
    { codigo: 'EJ-LA-02', titulo: 'Diseño de interfaces', curso: 'DAW2' },
    { codigo: 'EJ-LA-01', titulo: 'Fundamentos de programación', curso: 'DAW1' }
  ];
  let asignacionesNuevas = 0;
  for (const material of ejemplaresAsignados) {
    if (await asignarEjemplarAAlumnoAleatorio(cliente, material, idsAlumnos)) {
      asignacionesNuevas++;
    }
  }

  await cliente.query('COMMIT');
  console.log(`Usuarios creados: ${usuariosCreados}; ya existentes: ${usuariosExistentes}.`);
  console.log(`Materiales nuevos creados: ${materialesCreados}; los anuncios quedan en modalidad intercambio.`);
  console.log(`Ejemplares asignados ahora: ${asignacionesNuevas}; las asignaciones válidas anteriores se conservaron.`);
} catch (error) {
  if (cliente) {
    try {
      await cliente.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('También falló la reversión de la transacción:', rollbackError.message);
    }
  }
  console.error('No se pudo preparar usuarios y materiales:', error.code ?? error.message);
  process.exitCode = 1;
} finally {
  cliente?.release();
  await pool.end();
}
