// Cuentas ficticias de demostración para probar acceso y validación docente.
// Solo para la base local de desarrollo. Vuelve a ejecutarse sin duplicar cuentas:
// restablece la contraseña conocida de cada cuenta de demo.
import pg from 'pg';
import { crearHash } from '../src/claves.mjs';

if (process.env.NODE_ENV !== 'development' ||
    !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) ||
    !String(process.env.PGDATABASE ?? '').startsWith('aula_circular')) {
  throw new Error('Usa exclusivamente una base local de desarrollo de Aula Circular');
}

// Contraseñas ficticias locales, de 15 a 128 caracteres.
const cuentas = [
  {
    alias: 'Docente Demo',
    correo: 'docente.demo@example.invalid',
    clave: 'Docente-Demo-2026!',
    rol: 'docente',
    estado: 'activo',
    curso: 'DAW1',
    valida: null
  },
  {
    alias: 'Alumno Demo',
    correo: 'alumno.demo@example.invalid',
    clave: 'Alumno-Demo-2026!',
    rol: 'alumno',
    estado: 'activo',
    curso: 'DAW1',
    valida: 'docente.demo@example.invalid'
  },
  {
    alias: 'Alumno Pendiente',
    correo: 'pendiente.demo@example.invalid',
    clave: 'Pendiente-Demo-2026!',
    rol: 'alumno',
    estado: 'pendiente',
    curso: 'DAW2',
    valida: null
  }
];

for (const cuenta of cuentas) cuenta.hash = await crearHash(cuenta.clave);

const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
let cliente;
let abierta = false;

try {
  cliente = await pool.connect();
  await cliente.query('BEGIN');
  abierta = true;

  const cursos = await cliente.query(
    "SELECT id, codigo FROM curso WHERE codigo = ANY($1::text[]) AND activo",
    [cuentas.map((c) => c.curso)]
  );
  const cursoId = Object.fromEntries(cursos.rows.map((c) => [c.codigo, c.id]));
  for (const cuenta of cuentas) {
    if (!cursoId[cuenta.curso]) throw new Error(`Falta el curso activo ${cuenta.curso}`);
  }

  // El docente se crea primero para poder usarlo como validador del alumno activo.
  const ids = {};
  for (const cuenta of cuentas) {
    const validador = cuenta.valida ? ids[cuenta.valida] : null;
    if (cuenta.valida && !validador) throw new Error(`Validador no creado: ${cuenta.valida}`);

    const resultado = await cliente.query(`
      INSERT INTO usuario
        (alias, correo, hash, curso_solicitado_id, curso_confirmado_id,
         estado, validado_por, validado_en)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::integer IS NULL THEN NULL ELSE now() END)
      ON CONFLICT (correo) DO UPDATE SET
        alias = EXCLUDED.alias,
        hash = EXCLUDED.hash,
        curso_solicitado_id = EXCLUDED.curso_solicitado_id,
        curso_confirmado_id = EXCLUDED.curso_confirmado_id,
        estado = EXCLUDED.estado,
        validado_por = EXCLUDED.validado_por,
        validado_en = EXCLUDED.validado_en,
        auth_version = usuario.auth_version + 1
      RETURNING id, (xmax = 0) AS creada
    `, [
      cuenta.alias,
      cuenta.correo,
      cuenta.hash,
      cursoId[cuenta.curso],
      cuenta.estado === 'activo' ? cursoId[cuenta.curso] : null,
      cuenta.estado,
      validador
    ]);
    ids[cuenta.correo] = resultado.rows[0].id;

    await cliente.query(`
      INSERT INTO usuario_rol (usuario_id, rol) VALUES ($1, $2)
      ON CONFLICT (usuario_id, rol) DO NOTHING
    `, [ids[cuenta.correo], cuenta.rol]);
  }

  await cliente.query('COMMIT');
  abierta = false;

  console.log('Cuentas ficticias listas (base local):');
  for (const cuenta of cuentas) {
    console.log(
      `- ${cuenta.correo} | ${cuenta.clave} | ${cuenta.rol} | ` +
      `${cuenta.estado} | ${cuenta.curso}`
    );
  }
  console.log('Solo para ensayo: no uses estos datos fuera del laboratorio.');
} catch (error) {
  if (cliente && abierta) {
    try { await cliente.query('ROLLBACK'); } catch {}
  }
  console.error('Datos de demostración detenidos:', error.code ?? error.message);
  process.exitCode = 1;
} finally {
  cliente?.release();
  await pool.end();
}
