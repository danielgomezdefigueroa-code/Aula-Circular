import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { crearAplicacion } from '../src/aplicacion.mjs';
import { crearHash } from '../src/claves.mjs';

test('Intercambios concurrentes con HTTP y PostgreSQL',async t => {
  const esquema='aula_test_'+randomBytes(8).toString('hex');
  const admin=new pg.Pool({max:1,connectionTimeoutMillis:3000});
  let pool,servidor,almacen;
  try {
    await admin.query(`CREATE SCHEMA ${esquema}`);
    pool = new pg.Pool({
  max: 8,
  options: `-c search_path=${esquema}`,
  application_name: esquema,
  connectionTimeoutMillis: 3000
});
    const dir=new URL('../sql/migraciones/',import.meta.url);
    for (const n of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(n,dir),'utf8'));
    const clave=randomBytes(24).toString('hex'),hash=await crearHash(clave),ids={},sesiones={};
    for (const [nombre, rol, estado] of [
  ['doc', 'docente', 'activo'],
  ['doc2', 'docente', 'activo'],
  ['alumno', 'alumno', 'activo'],
  ['alumno2', 'alumno', 'activo'],
  ['alumno3', 'alumno', 'activo']
]) {
  ids[nombre] = (await pool.query(
    `INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,estado)
     VALUES($1,$2,$3,1,$4) RETURNING id`,
    [nombre, nombre + '@example.invalid', hash, estado]
  )).rows[0].id;

  await pool.query(
    'INSERT INTO usuario_rol VALUES($1,$2)',
    [ids[nombre], rol]
  );
}
    const resultado=await crearAplicacion(pool,{origen:'http://127.0.0.1:3000',secreto:randomBytes(32).toString('hex'),esquema,limitar:false});
    almacen=resultado.almacen;servidor=resultado.app.listen(0,'127.0.0.1');await once(servidor,'listening');
    const base='http://127.0.0.1:'+servidor.address().port;
    async function pedir(s,ruta,body,csrf=true) {
      const r=await fetch(base+ruta,{method:body===undefined?'GET':'POST',headers:{Cookie:s.cookie??'',
        Origin:'http://127.0.0.1:3000','Content-Type':'application/json',...(csrf&&s.token?{'X-CSRF-Token':s.token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      if(r.headers.getSetCookie().length)s.cookie=r.headers.getSetCookie()[0].split(';')[0];
      const b=await r.json();if(b.token)s.token=b.token;return {codigo:r.status,cuerpo:b};
    }
    for(const nombre of Object.keys(ids)) {
      const s={};await pedir(s,'/api/csrf');assert.equal((await pedir(s,'/api/acceso',{correo:nombre+'@example.invalid',clave})).codigo,200);sesiones[nombre]=s;
    }
        // Anuncios y consentimientos se crean por HTTP.
    async function crearAnuncio(nombre, codigoEnsayo) {
      const s = sesiones[nombre];
      const alta = await pedir(s, '/api/anuncios', {
        titulo: `Libro ${codigoEnsayo}`,
        descripcion: 'Material ficticio para concurrencia',
        cursoId: 1,
        asignatura: 'Bases de datos',
        edicion: '2026',
        isbn: '',
        conservacion: 'Completo',
        modalidad: 'intercambio'
      });
      assert.equal(alta.codigo, 201, JSON.stringify(alta.cuerpo));

      const anuncio = alta.cuerpo.datos;
      const envio = await pedir(s, `/api/anuncios/${anuncio.id}/enviar`, {
        version: anuncio.version
      });
      assert.equal(envio.codigo, 200);

      const revision = await pedir(
        sesiones.doc,
        `/api/gestion/anuncios/${anuncio.id}/revision`,
        {
          version: envio.cuerpo.datos.version,
          decision: 'aprobar',
          motivo: ''
        }
      );
      assert.equal(revision.codigo, 200);

      return (await pedir(s, `/api/anuncios/${anuncio.id}`)).cuerpo.datos;
    }

    async function crearAcuerdo(ofrecido, solicitado, receptor) {
      const alta = await pedir(sesiones.alumno, '/api/intercambios', {
        ejemplarOfrecidoId: ofrecido.ejemplar_id,
        ejemplarSolicitadoId: solicitado.ejemplar_id,
        confirmoPropuesta: true
      });
      assert.equal(alta.codigo, 201, JSON.stringify(alta.cuerpo));
      const op = alta.cuerpo.datos;

      const aceptacion = await pedir(
        sesiones[receptor],
        `/api/intercambios/${op.id}/aceptar`,
        {
          ejemplarOfrecidoId: op.ejemplarOfrecidoId,
          ejemplarSolicitadoId: op.ejemplarSolicitadoId,
          versionOfrecida: op.versionOfrecida,
          versionSolicitada: op.versionSolicitada,
          confirmoAceptacion: true
        }
      );
      assert.equal(aceptacion.codigo, 200);
      return op.id;
    }

    async function fotoOperacion(id) {
      return {
        operacion: (await pool.query(
          'SELECT * FROM operacion WHERE id=$1', [id]
        )).rows,
        items: (await pool.query(
          `SELECT * FROM operacion_item WHERE operacion_id=$1
           ORDER BY ejemplar_id`, [id]
        )).rows,
        reservas: (await pool.query(
          `SELECT * FROM reserva_activa WHERE operacion_id=$1
           ORDER BY ejemplar_id`, [id]
        )).rows,
        eventos: (await pool.query(
          'SELECT * FROM evento_operacion WHERE operacion_id=$1 ORDER BY id',
          [id]
        )).rows,
        avisos: (await pool.query(
          'SELECT * FROM aviso WHERE operacion_id=$1 ORDER BY id', [id]
        )).rows
      };
    }

    const e10 = await crearAnuncio('alumno', 'E10');
    const e20 = await crearAnuncio('alumno2', 'E20');
    const e30 = await crearAnuncio('alumno3', 'E30');

    const opA = await crearAcuerdo(e10, e20, 'alumno2');
    const opB = await crearAcuerdo(e10, e30, 'alumno3');
    const inicialA = await fotoOperacion(opA);
    const inicialB = await fotoOperacion(opB);

    assert.equal(inicialA.reservas.length, 0);
    assert.equal(inicialB.reservas.length, 0);
    assert.notEqual(ids.doc, ids.doc2);
    assert.notEqual(sesiones.doc.cookie, sesiones.doc2.cookie);

    const bloquear = await pool.connect();
    let pendientes;

    try {
      await bloquear.query('BEGIN');
      await bloquear.query(
        'SELECT id FROM ejemplar WHERE id=$1 FOR UPDATE',
        [e10.ejemplar_id]
      );

      // Promise.allSettled recoge también un posible error de petición.
      // El bloqueo anterior mantiene las dos reservas en espera.
      pendientes = Promise.allSettled([
        pedir(
          sesiones.doc,
          `/api/gestion/intercambios/${opA}/reservar`,
          {}
        ),
        pedir(
          sesiones.doc2,
          `/api/gestion/intercambios/${opB}/reservar`,
          {}
        )
      ]);

      let esperando = 0;
      const limite = Date.now() + 2000;

      while (Date.now() < limite) {
        const observacion = await admin.query(
          `SELECT count(*)::int AS total
           FROM pg_stat_activity
           WHERE application_name=$1
             AND state='active'
             AND wait_event_type='Lock'
             AND query ILIKE '%FROM ejemplar%'
             AND query ILIKE '%FOR UPDATE%'`,
          [esquema]
        );

        esperando = observacion.rows[0].total;
        if (esperando === 2) break;

        // Solo espaciar la observación; no decide quién gana.
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      assert.equal(
        esperando, 2,
        'No se observaron ambas peticiones bloqueadas; concurrencia no acreditada'
      );

      t.diagnostic('Barrera SQL: dos peticiones esperando el bloqueo de E10.');
    } finally {
      // Liberamos inmediatamente tras observar las dos esperas,
      // o al fallar la comprobación.
      await bloquear.query('ROLLBACK').catch(() => {});
      bloquear.release();

      // Esperar las peticiones evita cerrar el servidor con trabajo pendiente.
      if (pendientes) {
        await pendientes;
      }
    }

    const resultados = await pendientes;
    for (const r of resultados) {
      assert.equal(r.status, 'fulfilled', String(r.reason));
    }

    const respuestas = resultados.map(r => r.value);
    assert.deepEqual(
      respuestas.map(r => r.codigo).sort((a, b) => a - b),
      [200, 409]
    );

    const ganaA = respuestas[0].codigo === 200;
    const ganadora = ganaA ? opA : opB;
    const perdedora = ganaA ? opB : opA;
    const otroGanador = ganaA ? e20 : e30;
    const otroPerdedor = ganaA ? e30 : e20;

    assert.equal(
      respuestas[ganaA ? 1 : 0].cuerpo.error,
      'EJEMPLAR_OCUPADO'
    );

    const finGanadora = await fotoOperacion(ganadora);
    const finPerdedora = await fotoOperacion(perdedora);
    const inicioGanadora = ganaA ? inicialA : inicialB;
    const inicioPerdedora = ganaA ? inicialB : inicialA;

    assert.equal(finGanadora.operacion[0].estado, 'reservada');
    assert.equal(finGanadora.reservas.length, 2);
    assert.deepEqual(
      finGanadora.reservas.map(r => r.ejemplar_id).sort((a, b) => a - b),
      [e10.ejemplar_id, otroGanador.ejemplar_id].sort((a, b) => a - b)
    );
    assert.deepEqual(finGanadora.items, inicioGanadora.items);
    assert.equal(
      finGanadora.eventos.length, inicioGanadora.eventos.length + 1
    );
    assert.equal(
      finGanadora.avisos.length, inicioGanadora.avisos.length + 2
    );

    // El perdedor conserva operación, ítems, reservas, eventos y avisos.
    assert.deepEqual(finPerdedora, inicioPerdedora);

    const reservaCompartida = await pool.query(
      'SELECT operacion_id FROM reserva_activa WHERE ejemplar_id=$1',
      [e10.ejemplar_id]
    );
    assert.equal(reservaCompartida.rowCount, 1);
    assert.equal(reservaCompartida.rows[0].operacion_id, ganadora);

    assert.equal((await pool.query(
      'SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1',
      [otroPerdedor.ejemplar_id]
    )).rowCount, 0);

    for (let i = 0; i < respuestas.length; i++) {
      t.diagnostic(
        `Docente ${i + 1}: POST /api/gestion/intercambios/` +
        `${[opA, opB][i]}/reservar → HTTP ${respuestas[i].codigo} ` +
        JSON.stringify(respuestas[i].cuerpo)
      );
    }

    t.diagnostic(
      `SQL: operación ${ganadora} reservada con dos reservas; ` +
      `operación ${perdedora} sin cambios y con cero reservas.`
    );
    t.diagnostic(
      'E10 tiene una sola reserva; el otro ejemplar del perdedor sigue libre.'
    );
    t.diagnostic(
      'Sin eventos ni avisos nuevos para el perdedor. No se presupone qué docente gana.'
    );
      // Caso independiente: una pareja nueva, sin reservas.
    const e40 = await crearAnuncio('alumno', 'E40');
    const e50 = await crearAnuncio('alumno2', 'E50');
    const opFallo = await crearAcuerdo(e40, e50, 'alumno2');
    const antesFallo = await fotoOperacion(opFallo);

    assert.equal(antesFallo.operacion[0].estado, 'propuesta');
    assert.equal(antesFallo.reservas.length, 0);

    // Esta función y este trigger pertenecen SOLO al esquema temporal.
    // El aviso se escribe al final del servicio, tras reservas y evento.
    await pool.query(`
      CREATE FUNCTION fallar_aviso_reserva() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Fallo de ensayo antes del COMMIT';
      END;
      $$`);

    await pool.query(`
      CREATE TRIGGER fallo_aviso_reserva
      BEFORE INSERT ON aviso
      FOR EACH ROW EXECUTE FUNCTION fallar_aviso_reserva()`);

    try {
      const respuesta = await pedir(
        sesiones.doc,
        `/api/gestion/intercambios/${opFallo}/reservar`,
        {}
      );

      assert.equal(respuesta.codigo, 500);
      assert.equal(respuesta.cuerpo.error, 'ERROR_INTERNO');

      // La respuesta pública no expone el error SQL del trigger.
      assert.ok(!JSON.stringify(respuesta.cuerpo).includes('P0001'));
      assert.ok(!JSON.stringify(respuesta.cuerpo).includes(
        'Fallo de ensayo antes del COMMIT'
      ));

      // Compara operación, ítems, reservas, eventos y avisos.
      assert.deepEqual(await fotoOperacion(opFallo), antesFallo);

      t.diagnostic(
        'FALLO CONTROLADO: HTTP 500 ERROR_INTERNO, sin detalles SQL.'
      );
      t.diagnostic(
        'ROLLBACK: propuesta intacta, cero reservas y sin nuevos eventos ni avisos.'
      );
    } finally {
      await pool.query('DROP TRIGGER fallo_aviso_reserva ON aviso');
      await pool.query('DROP FUNCTION fallar_aviso_reserva()');
    }

    // El mismo acuerdo debe poder reservarse tras retirar el fallo.
    const reintento = await pedir(
      sesiones.doc,
      `/api/gestion/intercambios/${opFallo}/reservar`,
      {}
    );

    assert.equal(reintento.codigo, 200, JSON.stringify(reintento.cuerpo));
    const trasReintento = await fotoOperacion(opFallo);
    assert.equal(trasReintento.operacion[0].estado, 'reservada');
    assert.equal(trasReintento.reservas.length, 2);
    assert.equal(
      trasReintento.eventos.length,
      antesFallo.eventos.length + 1
    );
    assert.equal(
      trasReintento.avisos.length,
      antesFallo.avisos.length + 2
    );

    t.diagnostic(
      'Mecanismo de fallo retirado. Reintento: HTTP 200, dos reservas y un solo evento de reserva.'
    );

    // Tras retirar el trigger y confirmar la reserva, probamos la entrega.
    // Retenemos su resultado en el cliente de ensayo.
    const rutaEntrega =
      `/api/gestion/operaciones/${opFallo}/entregar`;

    let liberarRespuesta;
    const permisoRecibir = new Promise(resolve => {
      liberarRespuesta = resolve;
    });

    let notificarRespuestaRetenida;
    const respuestaRetenida = new Promise(resolve => {
      notificarRespuestaRetenida = resolve;
    });

    const entregaPendiente = pedir(
      sesiones.doc,
      rutaEntrega,
      {}
    ).then(async respuesta => {
      notificarRespuestaRetenida();
      await permisoRecibir;
      return respuesta;
    }, error => {
      notificarRespuestaRetenida();
      throw error;
    });

    // Registrar enseguida ambos resultados evita rechazos sin manejar.
    const entregaTerminada = Promise.allSettled([entregaPendiente]);

    try {
      await respuestaRetenida;

      // Todavía no utilizamos el resultado de la entrega original.
      // Consultamos la operación como uno de sus participantes.
      const consulta = await pedir(
        sesiones.alumno,
        `/api/intercambios/${opFallo}`
      );

      assert.equal(consulta.codigo, 200);
      assert.equal(consulta.cuerpo.datos.estado, 'completada');

      const antesRepetir = await fotoOperacion(opFallo);
      assert.equal(antesRepetir.operacion[0].estado, 'completada');
      assert.equal(antesRepetir.reservas.length, 0);
      assert.equal(
        antesRepetir.eventos.filter(e => e.accion === 'entregar').length,
        1
      );
      assert.deepEqual(antesRepetir.items, trasReintento.items);
      assert.equal(
        antesRepetir.avisos.length,
        trasReintento.avisos.length + 2
      );

      // Repetición controlada después de conocer el estado confirmado.
      const repetida = await pedir(
        sesiones.doc2,
        rutaEntrega,
        {}
      );

      assert.equal(repetida.codigo, 200);
      assert.equal(repetida.cuerpo.datos.estado, 'completada');

      // Sin otro evento, aviso, fecha o modificación de los ítems.
      assert.deepEqual(
        await fotoOperacion(opFallo),
        antesRepetir
      );

      const materiales = (await pool.query(
        `SELECT id, estado_servicio, propietario_usuario_id
         FROM ejemplar WHERE id=ANY($1::integer[]) ORDER BY id`,
        [[e40.ejemplar_id, e50.ejemplar_id]]
      )).rows;

      assert.equal(materiales.length, 2);
      assert.ok(materiales.every(e => e.estado_servicio === 'retirado'));
      assert.equal(
        materiales.find(e => e.id === e40.ejemplar_id).propietario_usuario_id,
        ids.alumno
      );
      assert.equal(
        materiales.find(e => e.id === e50.ejemplar_id).propietario_usuario_id,
        ids.alumno2
      );

      t.diagnostic(
        'RESPUESTA TARDIA: resultado original retenido por el cliente de ensayo.'
      );
      t.diagnostic(
        `Consulta previa: GET /api/intercambios/${opFallo} → HTTP 200, completada.`
      );
      t.diagnostic(
        `Repeticion: POST ${rutaEntrega} → HTTP ${repetida.codigo}, completada.`
      );
      t.diagnostic(
        'SQL: cero reservas, un evento de entrega; sin avisos adicionales ni cambios de propietarios.'
      );
    } finally {
      // La respuesta original se libera incluso si falla una comprobación.
      liberarRespuesta();
      await entregaTerminada;
    }

    const [original] = await entregaTerminada;
    assert.equal(original.status, 'fulfilled', String(original.reason));
    assert.equal(original.value.codigo, 200);
    assert.equal(original.value.cuerpo.datos.estado, 'completada');

    t.diagnostic(
      'Respuesta original liberada: HTTP 200. No se modifico el servidor para retrasarla.'
    );

} finally {
    if(servidor)await new Promise((ok,mal)=>servidor.close(e=>e?mal(e):ok()));
    if(almacen)await almacen.close();if(pool)await pool.end();
    if(/^aula_test_[a-f0-9]{16}$/.test(esquema))await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await admin.end();
  }
});
