// Preparación local de cuentas ficticias. No es una ruta pública.
// Las claves aleatorias quedan fuera de Git y nunca se imprimen.
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { crearHash } from '../src/cuentas/contraseñas.mjs';

if (process.env.PGDATABASE !== 'aula_circular_sprint2_ensayo' ||
    !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) ||
    process.env.PGUSER !== 'aula_app' ||
    process.env.NODE_ENV !== 'development') {
  throw new Error('Usa exclusivamente la base local de ensayo');
}

const archivo = '.cuentas-ensayo.json';

if (existsSync(archivo)) {
  throw new Error('Ya existe el archivo privado; no se sobrescribe');
}

const cuentas = [
  { alias: 'ADM01', correo: 'admin@example.test', rol: 'admin' },
  { alias: 'D01', correo: 'docente@example.test', rol: 'docente' },
  { alias: 'A01', correo: 'activo@example.test', rol: 'alumno' },
  { alias: 'P01', correo: 'pendiente@example.test', rol: 'alumno' }
];

for (const cuenta of cuentas) {
  cuenta.clave = randomBytes(24).toString('hex');
  cuenta.hash = await crearHash(cuenta.clave);
}

const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
let cliente;
let abierta = false;

try {
  cliente = await pool.connect();
  await cliente.query('BEGIN');
  abierta = true;

  const cursos = await cliente.query(
    "SELECT id FROM curso WHERE codigo = 'DAW-1' AND activo = true"
  );
  if (!cursos.rowCount) throw new Error('Falta el curso DAW-1 activo');
  const cursoId = cursos.rows[0].id;

  for (const cuenta of cuentas) {
    const resultado = await cliente.query(`
      INSERT INTO usuario
        (alias, correo, hash, curso_solicitado_id, estado)
      VALUES ($1, $2, $3, $4, 'pendiente')
      RETURNING id
    `, [cuenta.alias, cuenta.correo, cuenta.hash, cursoId]);

    cuenta.id = resultado.rows[0].id;

    await cliente.query(
      'INSERT INTO usuario_rol (usuario_id, rol) VALUES ($1, $2)',
      [cuenta.id, cuenta.rol]
    );
  }

  // Bootstrap local: establece las primeras cuentas del entorno.
  // No concede al administrador permiso docente mediante la API.
  // El primer administrador se referencia a sí mismo; es una
  // excepción de preparación documentada, no una validación pública.
  const admin = cuentas[0];
  const docente = cuentas[1];
  const alumno = cuentas[2];

  for (const [cuenta, validador] of [
    [admin, admin],
    [docente, admin],
    [alumno, docente]
  ]) {
    await cliente.query(`
      UPDATE usuario
      SET estado = 'activo',
          curso_confirmado_id = $1,
          validado_por = $2,
          validado_en = now()
      WHERE id = $3
    `, [cursoId, validador.id, cuenta.id]);
  }

  // Escribe sin sobrescribir y no incluye los hashes.
  writeFileSync(archivo, JSON.stringify({
    cursoId,
    cuentas: cuentas.map(({ id, alias, correo, clave, rol }) => ({
      id, alias, correo, clave, rol,
      estado: alias === 'P01' ? 'pendiente' : 'activo'
    }))
  }, null, 2), { flag: 'wx', mode: 0o600 });

  await cliente.query('COMMIT');
  abierta = false;

  console.log('Cuentas ficticias creadas:');
  for (const cuenta of cuentas) {
    console.log(
      `${cuenta.alias}: ${cuenta.rol}, ` +
      (cuenta.alias === 'P01' ? 'pendiente' : 'activo')
    );
  }
  console.log('Credenciales guardadas localmente; no compartir ni capturar.');
} catch (error) {
  if (cliente && abierta) {
    try { await cliente.query('ROLLBACK'); } catch {}
  }
  console.error('Preparación detenida:', error.code ?? 'ERROR_LOCAL');
  console.error('Si se creó el archivo privado, conserva y revisa su estado antes de repetir.');
  process.exitCode = 1;
} finally {
  cliente?.release();
  await pool.end();
}