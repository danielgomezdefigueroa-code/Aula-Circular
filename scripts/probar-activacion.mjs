import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

if (process.env.PGDATABASE !== 'aula_circular_sprint2_ensayo' ||
    !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) ||
    process.env.PGUSER !== 'aula_app') {
  throw new Error('Usa la base local de ensayo');
}

const base = 'http://127.0.0.1:3000';
const privado = JSON.parse(readFileSync('.cuentas-ensayo.json', 'utf8'));
const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });

function clienteNuevo() {
  return { cookies: new Map(), token: null };
}

async function pedir(cliente, metodo, ruta, cuerpo) {
  const headers = {
    Cookie: [...cliente.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  };

  if (metodo !== 'GET') {
    headers.Origin = base;
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = cliente.token;
  }

  const r = await fetch(base + ruta, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });

  for (const cabecera of r.headers.getSetCookie()) {
    const pareja = cabecera.split(';')[0];
    const i = pareja.indexOf('=');
    const nombre = pareja.slice(0, i);
    const valor = pareja.slice(i + 1);
    if (valor) cliente.cookies.set(nombre, valor);
    else cliente.cookies.delete(nombre);
  }

  const texto = await r.text();
  const contenido = texto ? JSON.parse(texto) : null;
  if (contenido?.token) cliente.token = contenido.token;
  return { codigo: r.status, contenido };
}

function comprobar(nombre, metodo, ruta, resultado, esperado) {
  const visible = resultado.contenido
    ? { ...resultado.contenido }
    : null;
  if (visible) delete visible.token;

  console.log(`\n${nombre}\n${metodo} ${ruta}`);
  console.log(`Esperado: ${esperado} | Observado: ${resultado.codigo}`);
  console.log(JSON.stringify(visible, null, 2));
  assert.equal(resultado.codigo, esperado, nombre);
}

async function acceder(cuenta) {
  const cliente = clienteNuevo();
  assert.equal((await pedir(cliente, 'GET', '/api/csrf')).codigo, 200);
  const acceso = await pedir(cliente, 'POST', '/api/acceso', {
    correo: cuenta.correo,
    clave: cuenta.clave
  });
  assert.equal(acceso.codigo, 200);
  return cliente;
}

try {
  const curso = await pool.query(
    "SELECT id FROM curso WHERE codigo='DAW-1' AND activo=true"
  );
  assert.equal(curso.rowCount, 1);
  const cursoId = curso.rows[0].id;

  const nueva = {
    alias: 'Cuenta para activacion',
    correo: `activar-${randomUUID()}@example.test`,
    clave: randomUUID(),
    cursoSolicitadoId: cursoId
  };

  const registro = clienteNuevo();
  await pedir(registro, 'GET', '/api/csrf');
  assert.equal(
    (await pedir(registro, 'POST', '/api/registro', nueva)).codigo,
    202
  );

  const consulta = await pool.query(
    'SELECT id FROM usuario WHERE correo=$1', [nueva.correo]
  );
  assert.equal(consulta.rowCount, 1);
  const id = consulta.rows[0].id;
  const ruta = `/api/gestion/usuarios/${id}/validar`;

  const alumno = await acceder(
    privado.cuentas.find(c => c.alias === 'A01')
  );
  const admin = await acceder(
    privado.cuentas.find(c => c.alias === 'ADM01')
  );
  const docente = await acceder(
    privado.cuentas.find(c => c.alias === 'D01')
  );
  const pendiente = await acceder(nueva);

  comprobar('Alumno intenta activar y conceder rol',
    'POST', ruta,
    await pedir(alumno, 'POST', ruta, {
      cursoConfirmadoId: cursoId, rol: 'docente'
    }), 403);

  comprobar('Administrador sin rol docente intenta activar',
    'POST', ruta,
    await pedir(admin, 'POST', ruta, {
      cursoConfirmadoId: cursoId
    }), 403);

  comprobar('Docente intenta conceder rol mediante activacion',
    'POST', ruta,
    await pedir(docente, 'POST', ruta, {
      cursoConfirmadoId: cursoId, rol: 'docente'
    }), 422);

  const anterior = await pool.query(
    'SELECT estado FROM usuario WHERE id=$1', [id]
  );
  assert.equal(anterior.rows[0].estado, 'pendiente');
  console.log('\nTras los rechazos, la cuenta sigue pendiente.');

  comprobar('Docente activa la cuenta',
    'POST', ruta,
    await pedir(docente, 'POST', ruta, {
      cursoConfirmadoId: cursoId
    }), 200);

  comprobar('La sesion anterior requiere nuevo acceso',
    'GET', '/api/yo',
    await pedir(pendiente, 'GET', '/api/yo'), 401);

  const activada = await acceder(nueva);
  comprobar('Cuenta activada consulta Biblioteca',
    'GET', '/api/biblioteca',
    await pedir(activada, 'GET', '/api/biblioteca'), 200);

  const final = await pool.query(`
    SELECT u.id, u.estado, u.curso_confirmado_id,
           u.validado_por, u.validado_en IS NOT NULL AS fecha_registrada,
           ARRAY(
             SELECT r.rol FROM usuario_rol r
             WHERE r.usuario_id=u.id ORDER BY r.rol
           ) AS roles
    FROM usuario u WHERE u.id=$1
  `, [id]);

  const docenteId = privado.cuentas.find(c => c.alias === 'D01').id;
  assert.equal(final.rows[0].estado, 'activo');
  assert.equal(final.rows[0].curso_confirmado_id, cursoId);
  assert.equal(final.rows[0].validado_por, docenteId);
  assert.equal(final.rows[0].fecha_registrada, true);
  assert.deepEqual(final.rows[0].roles, ['alumno']);

  console.log('\nEstado final comprobado en PostgreSQL:');
  console.log(JSON.stringify(final.rows[0], null, 2));
  console.log('\nTodas las comprobaciones de activacion pasaron.');
} finally {
  await pool.end();
}