// HTTP real de la parte de Daniel. No reserva ni entrega intercambios.
// Conserva cuentas y anuncios ficticios de cada ejecucion en la base del Sprint 4.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/aplicacion.mjs';
import { crearHash } from '../src/claves.mjs';

if (process.env.PGDATABASE !== 'aula_circular_sprint4_ensayo' ||
    !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) || process.env.PGUSER !== 'aula_app' ||
    (process.env.NODE_ENV && process.env.NODE_ENV !== 'development')) {
  throw new Error('Usa solo la base local del Sprint 4 como aula_app en desarrollo.');
}
const pool = new pg.Pool({ max: 5, connectionTimeoutMillis: 4000 });
const origen = 'http://127.0.0.1:3000';
const sufijo = randomUUID().slice(0, 8);
// Solo reduce la salida para la captura; se ejecutan siempre los 21 casos.
const captura = process.argv.includes('--captura');
const casosVisibles = new Set(['Propuesta valida', 'Tercero acepta', 'Version manipulada',
  'Receptor acepta', 'Aceptacion repetida', 'Editar material aceptado',
  'Aceptar acuerdo cancelado', 'Nueva propuesta tras republicar']);
let servidor, almacen, total = 0;

try {
  const cursoId = (await pool.query('SELECT id FROM curso WHERE activo ORDER BY id LIMIT 1')).rows[0]?.id;
  assert.ok(cursoId, 'Falta preparar los cursos');
  const cuentas = {};
  for (const [nombre, rol, activo] of [['D01', 'docente', true], ['A01', 'alumno', true],
    ['A02', 'alumno', true], ['A03', 'alumno', true], ['P01', 'alumno', false]]) {
    const clave = randomUUID(), hash = await crearHash(clave);
    const correo = `${nombre.toLowerCase()}-${sufijo}@example.test`;
    const id = (await pool.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id)
      VALUES($1,$2,$3,$4) RETURNING id`, [`${nombre}-${sufijo}`, correo, hash, cursoId])).rows[0].id;
    await pool.query('INSERT INTO usuario_rol(usuario_id,rol) VALUES($1,$2)', [id, rol]);
    if (activo) await pool.query(`UPDATE usuario SET estado='activo', curso_confirmado_id=$1,
      validado_por=$2, validado_en=now() WHERE id=$3`, [cursoId, cuentas.D01?.id ?? id, id]);
    cuentas[nombre] = { id, correo, clave, sesion: {} };
  }
  const app = await crearAplicacion(pool, { origen, secreto: randomBytes(32).toString('hex'), limitar: false });
  almacen = app.almacen;
  servidor = app.app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const base = `http://127.0.0.1:${servidor.address().port}`;

  // Cookies y tokens separados por identidad; nunca se muestran.
  async function pedir(s, ruta, metodo = 'GET', cuerpo, csrf = true) {
    const headers = {};
    if (s.cookie) headers.Cookie = s.cookie;
    if (metodo !== 'GET') {
      headers.Origin = origen;
      headers['Content-Type'] = 'application/json';
      if (csrf && s.token) headers['X-CSRF-Token'] = s.token;
    }
    const r = await fetch(base + ruta, { method: metodo, headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(6000) });
    const cookie = r.headers.getSetCookie()[0];
    if (cookie) s.cookie = cookie.split(';')[0];
    const texto = await r.text(), datos = texto ? JSON.parse(texto) : null;
    if (datos?.token) s.token = datos.token;
    return { codigo: r.status, cuerpo: datos };
  }
  for (const c of Object.values(cuentas)) {
    assert.equal((await pedir(c.sesion, '/api/csrf')).codigo, 200);
    assert.equal((await pedir(c.sesion, '/api/acceso', 'POST', { correo: c.correo, clave: c.clave })).codigo, 200);
  }
  const a = cuentas.A01.sesion, b = cuentas.A02.sesion, tercero = cuentas.A03.sesion;
  const d = cuentas.D01.sesion;
  const post = (s, ruta, datos) => pedir(s, ruta, 'POST', datos);

  async function anuncio(s, modalidad = 'intercambio', publicar = true) {
    const datos = { titulo: `Manual de ensayo ${randomUUID().slice(0, 8)}`, descripcion: 'Ejemplar ficticio',
      cursoId, asignatura: 'Bases de datos', edicion: '2026', isbn: '', conservacion: 'Completo', modalidad };
    const alta = await post(s, '/api/anuncios', datos);
    assert.equal(alta.codigo, 201);
    const id = alta.cuerpo.datos.id;
    if (publicar) {
      const envio = await post(s, `/api/anuncios/${id}/enviar`, { version: alta.cuerpo.datos.version });
      assert.equal(envio.codigo, 200);
      assert.equal((await post(d, `/api/gestion/anuncios/${id}/revision`,
        { version: envio.cuerpo.datos.version, decision: 'aprobar', motivo: '' })).codigo, 200);
    }
    const actual = (await pedir(s, `/api/anuncios/${id}`)).cuerpo.datos;
    return { id, ejemplarId: actual.ejemplar_id, version: actual.version, datos };
  }
  console.log('RESERVA CONJUNTA | HTTP real y PostgreSQL');
  console.log('Ensayo:', sufijo);

  async function comprobar(nombre, sesion, ruta, esperado, csrf = true) {
    const r = await pedir(sesion, ruta, 'POST', {}, csrf);
    console.log(`\n${nombre}: POST ${ruta}`);
    console.log(`Esperado: ${esperado} | Observado: ${r.codigo}`);
    console.log(JSON.stringify(r.cuerpo));
    assert.equal(r.codigo, esperado, nombre);
    return r;
  }

  async function estadoSql(id) {
    return (await pool.query(
      `SELECT o.estado, o.docente_id,
        (SELECT count(*)::int FROM aceptacion_intercambio
         WHERE operacion_id=o.id) AS aceptaciones,
        (SELECT count(*)::int FROM reserva_activa
         WHERE operacion_id=o.id) AS reservas,
        (SELECT count(*)::int FROM evento_operacion
         WHERE operacion_id=o.id) AS eventos,
        (SELECT count(*)::int FROM aviso
         WHERE operacion_id=o.id) AS avisos
       FROM operacion o WHERE o.id=$1`,
      [id]
    )).rows[0];
  }

  async function prepararAcuerdo(sesionA, sesionB, materialA, materialB) {
    const r = await post(sesionA, '/api/intercambios', {
      ejemplarOfrecidoId: materialA.ejemplarId,
      ejemplarSolicitadoId: materialB.ejemplarId,
      confirmoPropuesta: true
    });
    assert.equal(r.codigo, 201);
    const propuesta = r.cuerpo.datos;

    return {
      id: propuesta.id,
      aceptar: async () => {
        const respuesta = await post(
          sesionB,
          `/api/intercambios/${propuesta.id}/aceptar`,
          {
            ejemplarOfrecidoId: propuesta.ejemplarOfrecidoId,
            ejemplarSolicitadoId: propuesta.ejemplarSolicitadoId,
            versionOfrecida: propuesta.versionOfrecida,
            versionSolicitada: propuesta.versionSolicitada,
            confirmoAceptacion: true
          }
        );
        assert.equal(respuesta.codigo, 200);
      }
    };
  }
  console.log('\nCAMBIOS POSTERIORES A LAS ACEPTACIONES');

  const variantes = [
    {
      nombre: 'Participante suspendido',
      esperado: 'PARTICIPANTES_NO_ACTIVOS',
      cambiar: async () => {
        await pool.query(
          "UPDATE usuario SET estado='suspendido' WHERE id=$1",
          [cuentas.A02.id]
        );
      },
      restaurar: async () => {
        await pool.query(
          "UPDATE usuario SET estado='activo' WHERE id=$1",
          [cuentas.A02.id]
        );
      }
    },
    {
      nombre: 'Propietario modificado',
      esperado: 'ACUERDO_DESACTUALIZADO',
      cambiar: async x => {
        await pool.query(
          'UPDATE ejemplar SET propietario_usuario_id=$2 WHERE id=$1',
          [x.ejemplarId, cuentas.A03.id]
        );
      },
      restaurar: async x => {
        await pool.query(
          'UPDATE ejemplar SET propietario_usuario_id=$2 WHERE id=$1',
          [x.ejemplarId, cuentas.A01.id]
        );
      }
    },
    {
      nombre: 'Modalidad modificada',
      esperado: 'MODALIDAD_NO_ADMITIDA',
      cambiar: async x => {
        await pool.query(
          "UPDATE anuncio SET modalidad='cesion' WHERE id=$1",
          [x.id]
        );
      },
      restaurar: async x => {
        await pool.query(
          "UPDATE anuncio SET modalidad='intercambio' WHERE id=$1",
          [x.id]
        );
      }
    },
    {
      nombre: 'Version modificada',
      esperado: 'ACUERDO_DESACTUALIZADO',
      cambiar: async x => {
        await pool.query(
          'UPDATE anuncio SET version=version+1 WHERE id=$1',
          [x.id]
        );
      },
      restaurar: async x => {
        await pool.query(
          'UPDATE anuncio SET version=$2 WHERE id=$1',
          [x.id, x.version]
        );
      }
    }
  ];

  async function fotografia(id, x, y) {
    return {
      operacion: (await pool.query(
        'SELECT * FROM operacion WHERE id=$1', [id]
      )).rows,
      resumen: await estadoSql(id),
      items: (await pool.query(
        `SELECT * FROM operacion_item WHERE operacion_id=$1
         ORDER BY ejemplar_id`, [id]
      )).rows,
      materiales: (await pool.query(
        `SELECT e.id,e.propietario_usuario_id,e.estado_servicio,
                a.modalidad,a.version,a.estado_revision
         FROM ejemplar e JOIN anuncio a ON a.ejemplar_id=e.id
         WHERE e.id=ANY($1::integer[]) ORDER BY e.id`,
        [[x.ejemplarId, y.ejemplarId]]
      )).rows,
      reservas: (await pool.query(
        `SELECT * FROM reserva_activa
         WHERE ejemplar_id=ANY($1::integer[])
         ORDER BY ejemplar_id`,
        [[x.ejemplarId, y.ejemplarId]]
      )).rows
    };
  }

  for (const variante of variantes) {
    const x = await anuncio(a), y = await anuncio(b);
    const acuerdo = await prepararAcuerdo(a, b, x, y);
    await acuerdo.aceptar();

    try {
      await variante.cambiar(x);

      // Comparamos contra el estado que ya contiene el cambio del ensayo.
      const antes = await fotografia(acuerdo.id, x, y);

      const resultado = await comprobar(
        variante.nombre,
        d,
        `/api/gestion/intercambios/${acuerdo.id}/reservar`,
        variante.esperado === 'MODALIDAD_NO_ADMITIDA' ? 422 : 409
      );

      assert.equal(resultado.cuerpo.error, variante.esperado);
      assert.deepEqual(
        await fotografia(acuerdo.id, x, y),
        antes,
        'El rechazo no debe modificar la operacion ni sus materiales'
      );

      assert.equal(antes.resumen.estado, 'propuesta');
      assert.equal(antes.resumen.aceptaciones, 2);
      assert.equal(antes.reservas.length, 0);

      console.log(
        'SQL: propuesta intacta, dos aceptaciones y cero reservas; ' +
        'sin nuevos eventos ni avisos.'
      );
    } finally {
      // Restauramos exclusivamente la alteración de este caso ficticio.
      await variante.restaurar(x);
    }
  }

  console.log('\nRESULTADO: cuatro cambios de condiciones rechazados.');
  console.log('Ningun rechazo dejo reservas ni modificaciones parciales.');
  console.log('Cambios SQL de ensayo restaurados; datos ficticios conservados.');
  } catch (error) {
  console.error('PRUEBA FALLIDA. Codigo:', error.code ?? 'sin codigo');
  if (error.code === 'ERR_ASSERTION') console.error('Comprobacion:', error.message);
  process.exitCode = 1;
} finally {
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  if (almacen) await almacen.close();
  await pool.end();
}
