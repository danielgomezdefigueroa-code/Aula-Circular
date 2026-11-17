import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';

const ORIGEN = 'http://127.0.0.1:3000';

test('T14 - catalogo, duplicados, categorias y disponibilidad', async t => {
  const esquema = 'aula_t14_' + randomBytes(8).toString('hex');
  const admin = new pg.Pool({ max: 1 });
  let pool;
  let servidor;
  let almacen;
  let creado = false;

  try {
    await admin.query(`CREATE SCHEMA "${esquema}"`);
    creado = true;
    pool = new pg.Pool({max: 5, options: `-c search_path=${esquema}`});
    const carpeta = new URL('../sql/migraciones/', import.meta.url);
    for (const nombre of (await readdir(carpeta)).filter(x => x.endsWith('.sql')).sort()) {
      await pool.query(await readFile(new URL(nombre, carpeta), 'utf8'));
    }
    const curso1 = (await pool.query("SELECT id FROM curso WHERE codigo='DAW1'")).rows[0].id;
    const curso2 = (await pool.query("SELECT id FROM curso WHERE codigo='DAW2'")).rows[0].id;
    const categorias = (await pool.query('SELECT id, nombre FROM categoria')).rows;
    const fisicaId = categorias.find(c => c.nombre === 'Material físico').id;
    const digitalId = categorias.find(c => c.nombre === 'Material digital').id;
    const clave = 'Clave T14 de pruebas con seguridad 2026';
    const hash = await crearHash(clave);
    for (const [alias, rol, cursoId] of [['docente', 'docente', curso1], ['alumno', 'alumno', curso2]]) {
      const usuario = await pool.query(`
        INSERT INTO usuario (alias,correo,hash,curso_solicitado_id,curso_confirmado_id,estado)
        VALUES ($1,$2,$3,$4,$4,'activo') RETURNING id`,
        [alias, `${alias}@example.invalid`, hash, cursoId]);
      await pool.query('INSERT INTO usuario_rol(usuario_id,rol) VALUES ($1,$2)', [usuario.rows[0].id, rol]);
    }
    const aplicacion = await crearAplicacion(pool, {
      origen: ORIGEN, secreto: randomBytes(32).toString('hex'), esquema, limitar: false
    });
    almacen = aplicacion.almacen;
    servidor = aplicacion.app.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const base = `http://127.0.0.1:${servidor.address().port}`;

    async function pedir(sesion, ruta, metodo='GET', datos) {
      const cabeceras = {Cookie: sesion.cookie ?? ''};
      if (metodo !== 'GET') {
        cabeceras.Origin = ORIGEN;
        cabeceras['X-CSRF-Token'] = sesion.token ?? '';
        cabeceras['Content-Type'] = 'application/json';
      }
      const respuesta = await fetch(base + ruta, {
        method: metodo, headers: cabeceras,
        body: datos === undefined ? undefined : JSON.stringify(datos)
      });
      const cookie = respuesta.headers.getSetCookie()[0];
      if (cookie) sesion.cookie = cookie.split(';')[0];
      const cuerpo = await respuesta.json();
      if (cuerpo.token) sesion.token = cuerpo.token;
      return {status: respuesta.status, cuerpo};
    }
    async function acceder(alias) {
      const sesion = {};
      await pedir(sesion, '/api/csrf');
      const respuesta = await pedir(sesion, '/api/acceso', 'POST', {
        correo: `${alias}@example.invalid`, clave
      });
      assert.equal(respuesta.status, 200, JSON.stringify(respuesta.cuerpo));
      return sesion;
    }
    const docente = await acceder('docente');
    const alumno = await acceder('alumno');
    const ruta = '/api/gestion/biblioteca/recursos';
    const datosBase = {
      titulo: 'Calculadora de comprobación T14',
      descripcion: 'Dos ejemplares independientes', tipo: 'fisico',
      cursoId: curso1, categoriaId: fisicaId, asignatura: 'Matemáticas',
      edicion: '2026', isbn: null, codigo: 'T14-PRUEBA-001',
      conservacion: 'Buen estado'
    };
    let recursoId;
    let ejemplar1;
    let ejemplar2;

    await t.test('1. Alta valida guarda recurso y primer ejemplar', async () => {
      const respuesta = await pedir(docente, ruta, 'POST', datosBase);
      assert.equal(respuesta.status, 201, JSON.stringify(respuesta.cuerpo));
      recursoId = respuesta.cuerpo.datos.id;
      ejemplar1 = respuesta.cuerpo.datos.ejemplarId;
      assert.ok(Number.isInteger(recursoId) && Number.isInteger(ejemplar1));
    });

    await t.test('2. Codigo repetido devuelve 409 y no deja ficha huerfana', async () => {
      const antes = (await pool.query('SELECT COUNT(*)::int AS n FROM recurso')).rows[0].n;
      const respuesta = await pedir(docente, ruta, 'POST', {
        ...datosBase, titulo: 'Recurso que debe revertirse'
      });
      assert.equal(respuesta.status, 409, JSON.stringify(respuesta.cuerpo));
      assert.equal(respuesta.cuerpo.error, 'CODIGO_DUPLICADO');
      const despues = (await pool.query('SELECT COUNT(*)::int AS n FROM recurso')).rows[0].n;
      assert.equal(despues, antes);
      assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM recurso WHERE titulo='Recurso que debe revertirse' ")).rows[0].n, 0);
    });

    await t.test('3. Segundo ejemplar valido, variante del primero rechazada', async () => {
      const segunda = await pedir(docente, `${ruta}/${recursoId}/ejemplares`, 'POST', {
        codigo: 'T14-PRUEBA-002', conservacion: 'Buen estado'
      });
      assert.equal(segunda.status, 201, JSON.stringify(segunda.cuerpo));
      ejemplar2 = segunda.cuerpo.datos.id;
      const repetida = await pedir(docente, `${ruta}/${recursoId}/ejemplares`, 'POST', {
        codigo: 't14-prueba-001', conservacion: 'Buen estado'
      });
      assert.equal(repetida.status, 409, JSON.stringify(repetida.cuerpo));
      const unidades = (await pool.query('SELECT COUNT(*)::int AS n FROM ejemplar WHERE recurso_id=$1',[recursoId])).rows[0].n;
      assert.equal(unidades, 2);
    });

    await t.test('4. Dos ediciones del manual con igual titulo son validas', async () => {
      const ids=[];
      for (const edicion of ['2026', '2027']) {
        const respuesta = await pedir(docente, ruta, 'POST', {
          ...datosBase, titulo: 'Manual T14 de ejemplo', edicion,
          codigo: `T14-MANUAL-${edicion}`
        });
        assert.equal(respuesta.status, 201, JSON.stringify(respuesta.cuerpo));
        ids.push(respuesta.cuerpo.datos.id);
      }
      assert.notEqual(ids[0], ids[1]);
      const ediciones = (await pool.query("SELECT edicion FROM recurso WHERE titulo='Manual T14 de ejemplo' ORDER BY edicion")).rows;
      assert.deepEqual(ediciones.map(r => r.edicion), ['2026', '2027']);
    });

    await t.test('5. Recurso digital no admite ejemplares', async () => {
      const respuesta = await pedir(docente, ruta, 'POST', {
        ...datosBase, tipo: 'digital', categoriaId: digitalId,
        titulo: 'Manual digital T14', codigo: undefined, conservacion: undefined
      });
      assert.equal(respuesta.status, 201, JSON.stringify(respuesta.cuerpo));
      const intento = await pedir(docente, `${ruta}/${respuesta.cuerpo.datos.id}/ejemplares`, 'POST', {
        codigo: 'T14-NO-DIGITAL', conservacion: 'Bien'
      });
      assert.equal(intento.status, 422);
      const tipoInvalido = await pedir(docente, ruta, 'POST', {...datosBase, tipo: 'audio'});
      assert.equal(tipoInvalido.status, 422);
    });

    await t.test('6. Modificaciones validas y rechazo de cambio incompatible', async () => {
      const ficha = await pedir(docente, `${ruta}/${recursoId}`, 'PATCH', {
        titulo: datosBase.titulo, descripcion: 'Descripcion actualizada',
        tipo: 'fisico', cursoId: curso1, categoriaId: fisicaId,
        asignatura: 'Matematicas', edicion: '2026', isbn: null
      });
      assert.equal(ficha.status, 200, JSON.stringify(ficha.cuerpo));
      const incompatible = await pedir(docente, `${ruta}/${recursoId}`, 'PATCH', {
        titulo: datosBase.titulo, descripcion: 'Sin ejemplares',
        tipo: 'digital', cursoId: curso1, categoriaId: digitalId,
        asignatura: 'Matematicas', edicion: '2026', isbn: null
      });
      assert.equal(incompatible.status, 422, JSON.stringify(incompatible.cuerpo));
      const actual = (await pool.query('SELECT tipo FROM recurso WHERE id=$1',[recursoId])).rows[0];
      assert.equal(actual.tipo, 'fisico');
      const duplicado = await pedir(docente, `/api/gestion/biblioteca/ejemplares/${ejemplar2}`, 'PATCH', {
        codigo: 't14-prueba-001', conservacion: 'Nuevo estado'
      });
      assert.equal(duplicado.status, 409, JSON.stringify(duplicado.cuerpo));
      const original = (await pool.query('SELECT codigo FROM ejemplar WHERE id=$1',[ejemplar2])).rows[0];
      assert.equal(original.codigo, 'T14-PRUEBA-002');
    });

    await t.test('7. Alumno no puede dar de alta inventario', async () => {
      const respuesta = await pedir(alumno, ruta, 'POST', {...datosBase, codigo: 'T14-ALUMNO'});
      assert.equal(respuesta.status, 403);
    });

    await t.test('8. Reservar una unidad mantiene otra disponible', async () => {
      const solicitud = await pedir(alumno, '/api/prestamos/solicitudes', 'POST', {ejemplarId: ejemplar1});
      assert.equal(solicitud.status, 201, JSON.stringify(solicitud.cuerpo));
      const adjudicacion = await pedir(docente,
        `/api/gestion/prestamos/solicitudes/${solicitud.cuerpo.datos.id}/adjudicar`, 'POST', {
          motivo: 'T14: comprobar independencia de ejemplares',
          vencimiento: new Date(Date.now() + 7 * 86400000).toISOString()
        });
      assert.equal(adjudicacion.status, 201, JSON.stringify(adjudicacion.cuerpo));
      const estado = (await pool.query(`
        SELECT e.id, EXISTS(SELECT 1 FROM reserva_activa ra WHERE ra.ejemplar_id=e.id) AS reservado
        FROM ejemplar e WHERE e.recurso_id=$1 ORDER BY id`, [recursoId])).rows;
      assert.equal(estado.length, 2);
      assert.equal(estado.find(e => e.id === ejemplar1).reservado, true);
      assert.equal(estado.find(e => e.id === ejemplar2).reservado, false);
    });

    await t.test('9. Categoria inactiva rechaza nuevas altas pero mantiene historia', async () => {
      const cambio = await pedir(docente,
        `/api/gestion/biblioteca/categorias/${fisicaId}`, 'PATCH', {activo: false});
      assert.equal(cambio.status, 200, JSON.stringify(cambio.cuerpo));
      const respuesta = await pedir(docente, ruta, 'POST', {...datosBase, codigo: 'T14-NUEVO-INVALIDO'});
      assert.equal(respuesta.status, 422, JSON.stringify(respuesta.cuerpo));
      assert.equal(respuesta.cuerpo.error, 'CATEGORIA_INVALIDA');
      const historico = await pool.query(`
        SELECT r.id,c.nombre,c.activo FROM recurso r
        JOIN categoria c ON c.id=r.categoria_id WHERE r.id=$1`, [recursoId]);
      assert.equal(historico.rows[0].nombre, 'Material físico');
      assert.equal(historico.rows[0].activo, false);
      const listado = await pedir(docente, '/api/biblioteca');
      assert.equal(listado.status, 200);
      assert.ok(listado.cuerpo.datos.some(r => r.id === recursoId));
    });

    await t.test('10. Curso inactivo se rechaza y no se crea ficha', async () => {
      await pool.query('UPDATE curso SET activo=false WHERE id=$1', [curso2]);
      const respuesta = await pedir(docente, ruta, 'POST', {
        ...datosBase, titulo: 'Digital con curso inactivo', tipo: 'digital',
        cursoId: curso2, categoriaId: digitalId,
        codigo: undefined, conservacion: undefined
      });
      assert.equal(respuesta.status, 422, JSON.stringify(respuesta.cuerpo));
      assert.equal(respuesta.cuerpo.error, 'CURSO_INACTIVO');
    });
  } finally {
    if (servidor) {
      await new Promise((resolve, reject) => {
        servidor.close(error => error ? reject(error) : resolve());
        servidor.closeAllConnections();
      });
    }
    almacen?.stopExpiringSessions?.();
    if (pool) await pool.end();
    if (creado) await admin.query(`DROP SCHEMA "${esquema}" CASCADE`);
    await admin.end();
  }
});
