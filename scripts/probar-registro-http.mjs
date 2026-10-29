// Registro HTTP y comprobación de sus efectos en PostgreSQL.
// No imprime contraseñas, cookies, tokens ni hashes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (process.env.PGDATABASE !== 'aula_circular_sprint2_ensayo' ||
    !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) ||
    process.env.PGUSER !== 'aula_app') {
  throw new Error('Usa la base local de ensayo');
}

const base = 'http://127.0.0.1:3000';
const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
const cookies = new Map();
let token;

async function registrar(entrada, enviarToken = true) {
  const headers = {
    'Content-Type': 'application/json',
    Origin: base,
    Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  };

  if (enviarToken) headers['X-CSRF-Token'] = token;

  const respuesta = await fetch(base + '/api/registro', {
    method: 'POST',
    headers,
    body: JSON.stringify(entrada)
  });

  return {
    codigo: respuesta.status,
    cuerpo: await respuesta.json()
  };
}

function mostrar(nombre, resultado, esperado) {
  console.log(`\n${nombre}\nPOST /api/registro`);
  console.log(`Esperado: ${esperado} | Observado: ${resultado.codigo}`);
  console.log(JSON.stringify(resultado.cuerpo, null, 2));
  assert.equal(resultado.codigo, esperado, nombre);
}

try {
  const curso = await pool.query(
    "SELECT id FROM curso WHERE codigo='DAW-1' AND activo=true"
  );
  assert.equal(curso.rowCount, 1);

  const csrf = await fetch(base + '/api/csrf');
  assert.equal(csrf.status, 200);
  token = (await csrf.json()).token;
  assert.ok(token);

  for (const cabecera of csrf.headers.getSetCookie()) {
    const pareja = cabecera.split(';')[0];
    const i = pareja.indexOf('=');
    cookies.set(pareja.slice(0, i), pareja.slice(i + 1));
  }

  const correo = `registro-${randomUUID()}@example.test`;
  const entrada = {
    alias: 'Registro HTTP de ensayo',
    correo,
    clave: randomUUID(),
    cursoSolicitadoId: curso.rows[0].id,
    rol: 'docente',
    estado: 'activo'
  };

  const alta = await registrar(entrada);
  mostrar('Registro con rol docente y estado activo enviados', alta, 202);

  const consulta = await pool.query(`
    SELECT u.id, u.alias, u.estado,
           ARRAY(
             SELECT r.rol FROM usuario_rol r
             WHERE r.usuario_id=u.id ORDER BY r.rol
           ) AS roles
    FROM usuario u WHERE correo=$1
  `, [correo]);

  assert.equal(consulta.rowCount, 1);
  assert.equal(consulta.rows[0].estado, 'pendiente');
  assert.deepEqual(consulta.rows[0].roles, ['alumno']);

  console.log('\nObservado en PostgreSQL:');
  console.log(JSON.stringify(consulta.rows[0], null, 2));

  const repetido = await registrar(entrada);
  mostrar('Correo repetido', repetido, 202);
  assert.deepEqual(repetido.cuerpo, alta.cuerpo);

  const cantidad = await pool.query(
    'SELECT count(*)::integer AS total FROM usuario WHERE correo=$1',
    [correo]
  );
  assert.equal(cantidad.rows[0].total, 1);
  console.log('Cuentas guardadas para ese correo: 1');

  const inexistente = await pool.query(`
    SELECT COALESCE(max(id), 0) + 1 AS id FROM curso
  `);

  const correoCurso = `curso-${randomUUID()}@example.test`;
  mostrar('Curso inexistente', await registrar({
    ...entrada,
    correo: correoCurso,
    cursoSolicitadoId: inexistente.rows[0].id
  }), 422);

  const correoCsrf = `csrf-${randomUUID()}@example.test`;
  mostrar('Registro sin token CSRF', await registrar({
    ...entrada,
    correo: correoCsrf
  }, false), 403);

  const rechazados = await pool.query(
    'SELECT count(*)::integer AS total FROM usuario WHERE correo=ANY($1::text[])',
    [[correoCurso, correoCsrf]]
  );
  assert.equal(rechazados.rows[0].total, 0);
  console.log('Cuentas creadas en los dos casos rechazados: 0');

  console.log('\nTodas las comprobaciones de registro HTTP pasaron.');
  console.log('Permanece una nueva cuenta ficticia pendiente por ejecución.');
} finally {
  await pool.end();
}