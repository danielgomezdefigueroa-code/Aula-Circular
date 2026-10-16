// Prueba directa de las funciones: todavía no realiza peticiones HTTP.
// Solo permite la base de ensayo. Deja una cuenta ficticia por ejecución.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { registrarCuenta } from '../src/cuentas/registro.mjs';
import { comprobarClave } from '../src/cuentas/contraseñas.mjs';

if (process.env.PGDATABASE !== 'aula_circular_sprint2_ensayo' ||
    !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) ||
    process.env.PGUSER !== 'aula_app') {
  throw new Error('Usa la base local de ensayo y la cuenta aula_app.');
}
const pool = new pg.Pool({ connectionTimeoutMillis: 4000 });
try {
  const cursos = await pool.query('SELECT id FROM curso WHERE activo = true ORDER BY id');
  assert.ok(cursos.rowCount > 0, 'Debe existir un curso activo');
  // Contraseña aleatoria: no se imprime ni se guarda en archivos.
  const clave = randomUUID();
  const correo = `ensayo-${randomUUID()}@example.test`;
  const entrada = {
    alias: 'Alumno de ensayo', correo, clave,
    cursoSolicitadoId: cursos.rows[0].id,
    rol: 'docente', estado: 'activo'
  };

  const alta = await registrarCuenta(pool, entrada);
  assert.equal(alta.codigo, 202);
  console.log('1. Registro: codigo 202 (resultado de la funcion, sin HTTP).');

  const cuenta = await pool.query(
    'SELECT id, estado, hash FROM usuario WHERE correo = $1', [correo]
  );
  assert.equal(cuenta.rowCount, 1);
  assert.equal(cuenta.rows[0].estado, 'pendiente');
  const roles = await pool.query(
    'SELECT rol FROM usuario_rol WHERE usuario_id = $1 ORDER BY rol', [cuenta.rows[0].id]
  );
  assert.deepEqual(roles.rows.map(fila => fila.rol), ['alumno']);
  console.log('2. Guardado: alumno pendiente, aunque se envio docente y activo.');

  assert.notEqual(cuenta.rows[0].hash, clave);
  assert.ok(cuenta.rows[0].hash.startsWith('scrypt$'));
  assert.equal(await comprobarClave(clave, cuenta.rows[0].hash), true);
  assert.equal(await comprobarClave(randomUUID(), cuenta.rows[0].hash), false);
  console.log('3. Hash recuperado: clave correcta aceptada e incorrecta rechazada.');

  const repetido = await registrarCuenta(pool, entrada);
  assert.deepEqual(repetido, alta);
  const cantidad = await pool.query('SELECT count(*)::int AS total FROM usuario WHERE correo = $1', [correo]);
  assert.equal(cantidad.rows[0].total, 1);
  console.log('4. Correo repetido: misma respuesta generica y una sola cuenta.');

  const invalido = await registrarCuenta(pool, { ...entrada, cursoSolicitadoId: 2147483647 });
  assert.equal(invalido.codigo, 422);
  console.log('5. Curso inexistente: codigo 422.');
  console.log('RESULTADO: todas las comprobaciones superadas.');
  console.log('Base: aula_circular_sprint2_ensayo | Usuario: aula_app');
  console.log('Queda una cuenta ficticia pendiente en esta base por ejecucion.');
} catch (error) {
  // No imprimimos SQL, datos de conexion, hashes ni contraseñas.
  console.error('PRUEBA FALLIDA. Codigo:', error.code || 'sin codigo');
  process.exitCode = 1;
} finally {
  await pool.end();
}
