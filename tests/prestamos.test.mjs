
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';

import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';

test('Préstamos: estados, cancelaciones y devoluciones', async t => {
  const esquema = 'aula_test_' + randomBytes(8).toString('hex');

  const admin = new pg.Pool({
    max: 1,
    connectionTimeoutMillis: 3000
  });

  let pool;
  let servidor;
  let almacen;

  try {
    // Esquema temporal independiente de los datos reales.
    await admin.query(`CREATE SCHEMA ${esquema}`);

    pool = new pg.Pool({
      max: 5,
      options: `-c search_path=${esquema}`,
      connectionTimeoutMillis: 3000
    });

    // Aplicar las migraciones reales.
    const carpeta = new URL('../sql/migraciones/', import.meta.url);

    const migraciones = (await readdir(carpeta))
      .filter(nombre => nombre.endsWith('.sql'))
      .sort();

    for (const nombre of migraciones) {
      const contenido = await readFile(
        new URL(nombre, carpeta),
        'utf8'
      );

      await pool.query(contenido);
    }

    // Preparar cuentas ficticias.
    const clave = 'Clave ficticia de pruebas para préstamos 2026';
    const hash = await crearHash(clave);

    const usuarios = {};

    for (const [alias, rol] of [
      ['DocentePrueba', 'docente'],
      ['AlumnoPrueba1', 'alumno'],
      ['AlumnoPrueba2', 'alumno']
    ]) {
      const resultado = await pool.query(
        `INSERT INTO usuario
           (alias, correo, hash, curso_solicitado_id)
         VALUES ($1, $2, $3, 1)
         RETURNING id`,
        [alias, `${alias.toLowerCase()}@example.invalid`, hash]
      );

      const id = resultado.rows[0].id;

      await pool.query(
        'INSERT INTO usuario_rol(usuario_id, rol) VALUES($1,$2)',
        [id, rol]
      );

      usuarios[alias] = {
        id,
        correo: `${alias.toLowerCase()}@example.invalid`
      };
    }

    const docenteId = usuarios.DocentePrueba.id;

    for (const usuario of Object.values(usuarios)) {
      await pool.query(
        `UPDATE usuario
         SET estado = 'activo',
             curso_confirmado_id = 1,
             validado_por = $1,
             validado_en = now()
         WHERE id = $2`,
        [docenteId, usuario.id]
      );
    }

    // Arrancar aplicación Express sobre el esquema temporal.
    const aplicacion = await crearAplicacion(pool, {
      origen: 'http://127.0.0.1:3000',
      secreto: randomBytes(32).toString('hex'),
      esquema,
      limitar: false
    });

    almacen = aplicacion.almacen;

    servidor = aplicacion.app.listen(0, '127.0.0.1');

    await once(servidor, 'listening');

    const base = `http://127.0.0.1:${servidor.address().port}`;

    
async function pedir(
  sesion,
  ruta,
  metodo = 'GET',
  cuerpo,
  conCsrf = true
) {
  const headers = {};

  if (sesion.cookie) {
    headers.Cookie = sesion.cookie;
  }

  if (metodo !== 'GET') {
    headers.Origin = 'http://127.0.0.1:3000';
    headers['Content-Type'] = 'application/json';

    if (conCsrf && sesion.token) {
      headers['X-CSRF-Token'] = sesion.token;
    }
  }

  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers,
    body: cuerpo === undefined
      ? undefined
      : JSON.stringify(cuerpo)
  });

  const cookie = respuesta.headers.getSetCookie()[0];

  if (cookie) {
    sesion.cookie = cookie.split(';')[0];
  }

  const datos = await respuesta.json();

  if (datos.token) {
    sesion.token = datos.token;
  }

  return {
    status: respuesta.status,
    ...datos
  };
}


    const sesiones = {};

    for (const [alias, usuario] of Object.entries(usuarios)) {
      const sesion = {};

      await pedir(sesion, '/api/csrf');

      const acceso = await pedir(
        sesion,
        '/api/acceso',
        'POST',
        {
          correo: usuario.correo,
          clave
        }
      );

      assert.equal(acceso.status, 200);

      sesiones[alias] = sesion;
    }

    // En el siguiente bloque añadiremos los casos HTTP.
    await t.test('Infraestructura de ensayo preparada', () => {
      assert.ok(servidor.listening);
      assert.equal(Object.keys(sesiones).length, 3);
    });

    
    // Crear un recurso físico y un ejemplar ficticios del centro.
    
    const recurso = await pool.query(
    `INSERT INTO recurso
        (origen, tipo, titulo, descripcion, curso_id, asignatura, edicion)
    VALUES
        (
        'centro',
        'fisico',
        'Manual de préstamo de ensayo',
        'Recurso ficticio para probar préstamos',
        1,
        'Programación',
        '2026'
        )
    RETURNING id`
    );


    const ejemplar = await pool.query(
      `INSERT INTO ejemplar
         (recurso_id, codigo, conservacion)
       VALUES ($1, 'PRESTAMO-TEST-001', 'Buen estado')
       RETURNING id`,
      [recurso.rows[0].id]
    );

    const ejemplarId = ejemplar.rows[0].id;

    await t.test(
      'Solicitud pendiente sin reserva activa',
      async () => {
        const alumno = sesiones.AlumnoPrueba1;
        const docente = sesiones.DocentePrueba;

        
        const anonimo = await pedir(
        {},
        '/api/prestamos/solicitudes',
        'POST',
        { ejemplarId }
        );

        // Sin sesión ni token CSRF, la aplicación debe rechazar
        // la petición antes de crear ninguna solicitud.
        assert.equal(
        anonimo.status,
        403,
        JSON.stringify(anonimo)
        );

        // Un alumno autenticado, pero sin token CSRF,
        // también debe ser rechazado.
        const sinCsrf = await pedir(
            sesiones.AlumnoPrueba1,
            '/api/prestamos/solicitudes',
            'POST',
            { ejemplarId },
            false
        );

        assert.equal(sinCsrf.status, 403);
                // El docente no debe crear solicitudes como alumno.
                const intentoDocente = await pedir(
                docente,
                '/api/prestamos/solicitudes',
                'POST',
                { ejemplarId }
                );

        assert.equal(intentoDocente.status, 403);

        // Un alumno activo solicita el ejemplar.
        const solicitud = await pedir(
          alumno,
          '/api/prestamos/solicitudes',
          'POST',
          { ejemplarId }
        );

        assert.equal(
          solicitud.status,
          201,
          JSON.stringify(solicitud)
        );

        // Verificar el estado real en PostgreSQL.
        const resultado = await pool.query(
          `SELECT estado, solicitante_id
           FROM solicitud
           WHERE ejemplar_id = $1`,
          [ejemplarId]
        );

        assert.equal(resultado.rowCount, 1);
        assert.equal(resultado.rows[0].estado, 'pendiente');
        assert.equal(
          resultado.rows[0].solicitante_id,
          usuarios.AlumnoPrueba1.id
        );

        // Una solicitud pendiente no debe crear una reserva.
        const reserva = await pool.query(
          `SELECT operacion_id
           FROM reserva_activa
           WHERE ejemplar_id = $1`,
          [ejemplarId]
        );

        assert.equal(reserva.rowCount, 0);

        // El catálogo debe seguir mostrando disponibilidad.
        const catalogo = await pedir(
          alumno,
          '/api/biblioteca'
        );

        assert.equal(catalogo.status, 200);

        const ficha = catalogo.datos.find(
          recurso => recurso.titulo ===
            'Manual de préstamo de ensayo'
        );

        assert.ok(ficha);
        assert.equal(ficha.estado, 'disponible');
      }
    );

    
    await t.test(
      'Adjudicación y cancelación antes de la entrega',
      async () => {
        const docente = sesiones.DocentePrueba;
        const alumno1 = sesiones.AlumnoPrueba1;
        const alumno2 = sesiones.AlumnoPrueba2;

        // El segundo alumno también solicita el ejemplar.
        const segundaSolicitud = await pedir(
          alumno2,
          '/api/prestamos/solicitudes',
          'POST',
          { ejemplarId }
        );

        assert.equal(
          segundaSolicitud.status,
          201,
          JSON.stringify(segundaSolicitud)
        );

        // Recuperamos la solicitud pendiente del primer alumno.
        const consulta = await pool.query(
          `SELECT id FROM solicitud
           WHERE ejemplar_id = $1
             AND solicitante_id = $2
             AND estado = 'pendiente'`,
          [ejemplarId, usuarios.AlumnoPrueba1.id]
        );

        assert.equal(consulta.rowCount, 1);
        const solicitudId = consulta.rows[0].id;

        // El docente adjudica el préstamo.
        const vencimiento = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString();

        const adjudicacion = await pedir(
          docente,
          `/api/gestion/prestamos/solicitudes/${solicitudId}/adjudicar`,
          'POST',
          {
            motivo: 'Adjudicación de ensayo',
            vencimiento
          }
        );

        assert.equal(
          adjudicacion.status,
          201,
          JSON.stringify(adjudicacion)
        );

        const operacionId = adjudicacion.datos.id;

        // Comprobar operación y reserva en PostgreSQL.
        const operacion = await pool.query(
          `SELECT tipo, estado FROM operacion WHERE id = $1`,
          [operacionId]
        );

        assert.equal(operacion.rows[0].tipo, 'prestamo');
        assert.equal(operacion.rows[0].estado, 'reservada');

        const reserva = await pool.query(
          `SELECT operacion_id FROM reserva_activa
           WHERE ejemplar_id = $1`,
          [ejemplarId]
        );

        assert.equal(reserva.rowCount, 1);
        assert.equal(reserva.rows[0].operacion_id, operacionId);

        // El segundo alumno no obtiene la adjudicación.
        const solicitudes = await pool.query(
          `SELECT solicitante_id, estado
           FROM solicitud WHERE ejemplar_id = $1`,
          [ejemplarId]
        );

        assert.equal(
          solicitudes.rows.find(
            s => s.solicitante_id === usuarios.AlumnoPrueba1.id
          ).estado,
          'adjudicada'
        );

        assert.equal(
          solicitudes.rows.find(
            s => s.solicitante_id === usuarios.AlumnoPrueba2.id
          ).estado,
          'rechazada'
        );

        // Con una reserva activa, el catálogo no lo ofrece.
        const catalogoReservado = await pedir(
          alumno1,
          '/api/biblioteca'
        );

        const fichaReservada = catalogoReservado.datos.find(
          r => r.titulo === 'Manual de préstamo de ensayo'
        );

        assert.equal(fichaReservada.estado, 'no disponible');

        // El docente cancela ANTES de entregar.
        const cancelacion = await pedir(
          docente,
          `/api/gestion/prestamos/${operacionId}/cancelar`,
          'POST',
          { motivo: 'Cancelación antes de la entrega' }
        );

        assert.equal(
          cancelacion.status,
          200,
          JSON.stringify(cancelacion)
        );

        // La operación queda cancelada.
        const estadoFinal = await pool.query(
          `SELECT estado FROM operacion WHERE id = $1`,
          [operacionId]
        );

        assert.equal(estadoFinal.rows[0].estado, 'cancelada');

        // La reserva se libera.
        const reservaFinal = await pool.query(
          `SELECT 1 FROM reserva_activa
           WHERE ejemplar_id = $1`,
          [ejemplarId]
        );

        assert.equal(reservaFinal.rowCount, 0);

        // El historial de la operación permanece.
        const eventos = await pool.query(
          `SELECT accion FROM evento_operacion
           WHERE operacion_id = $1`,
          [operacionId]
        );

        assert.ok(
          eventos.rows.some(e => e.accion === 'adjudicar_prestamo')
        );

        assert.ok(
          eventos.rows.some(e => e.accion === 'cancelar_prestamo')
        );

        // El catálogo vuelve a mostrar el ejemplar disponible.
        const catalogoFinal = await pedir(
          alumno1,
          '/api/biblioteca'
        );

        const fichaFinal = catalogoFinal.datos.find(
          r => r.titulo === 'Manual de préstamo de ensayo'
        );

        assert.equal(fichaFinal.estado, 'disponible');
      }
    );


    
    await t.test(
      'Entrega, cancelación rechazada y devolución correcta',
      async () => {
        const docente = sesiones.DocentePrueba;
        const alumno = sesiones.AlumnoPrueba1;

        // El ejemplar vuelve a estar disponible tras
        // la cancelación del préstamo anterior.
        const nuevaSolicitud = await pedir(
          alumno,
          '/api/prestamos/solicitudes',
          'POST',
          { ejemplarId }
        );

        assert.equal(
          nuevaSolicitud.status,
          201,
          JSON.stringify(nuevaSolicitud)
        );

        const solicitudId = nuevaSolicitud.datos.id;

        const vencimiento = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString();

        const adjudicacion = await pedir(
          docente,
          `/api/gestion/prestamos/solicitudes/${solicitudId}/adjudicar`,
          'POST',
          {
            motivo: 'Préstamo de ensayo para devolución',
            vencimiento
          }
        );

        assert.equal(
          adjudicacion.status,
          201,
          JSON.stringify(adjudicacion)
        );

        const operacionId = adjudicacion.datos.id;

        // Entrega docente.
        const entrega = await pedir(
          docente,
          `/api/gestion/prestamos/${operacionId}/entregar`,
          'POST',
          {}
        );

        assert.equal(
          entrega.status,
          200,
          JSON.stringify(entrega)
        );

        const entregada = await pool.query(
          `SELECT estado, entregada_en
           FROM operacion
           WHERE id=$1`,
          [operacionId]
        );

        assert.equal(entregada.rows[0].estado, 'prestada');
        assert.ok(entregada.rows[0].entregada_en);

        // La reserva debe mantenerse durante el préstamo.
        const reserva = await pool.query(
          `SELECT 1 FROM reserva_activa
           WHERE ejemplar_id=$1`,
          [ejemplarId]
        );

        assert.equal(reserva.rowCount, 1);

        // Transición inválida: cancelar después de entregar.
        const cancelacionInvalida = await pedir(
          docente,
          `/api/gestion/prestamos/${operacionId}/cancelar`,
          'POST',
          {
            motivo: 'Intento de cancelación fuera de plazo'
          }
        );

        assert.equal(
          cancelacionInvalida.status,
          409,
          JSON.stringify(cancelacionInvalida)
        );

        // Confirmar que el rechazo no cambia el estado.
        const trasRechazo = await pool.query(
          `SELECT estado FROM operacion WHERE id=$1`,
          [operacionId]
        );

        assert.equal(trasRechazo.rows[0].estado, 'prestada');

        const reservaTrasRechazo = await pool.query(
          `SELECT 1 FROM reserva_activa
           WHERE ejemplar_id=$1`,
          [ejemplarId]
        );

        assert.equal(reservaTrasRechazo.rowCount, 1);

        // Devolución correcta con confirmación docente.
        const devolucion = await pedir(
          docente,
          `/api/gestion/prestamos/${operacionId}/devolver`,
          'POST',
          {
            conservacion: 'Buen estado, sin daños visibles',
            confirmoBuenEstado: true
          }
        );

        assert.equal(
          devolucion.status,
          200,
          JSON.stringify(devolucion)
        );

        const operacionFinal = await pool.query(
          `SELECT estado, cerrada_en
           FROM operacion WHERE id=$1`,
          [operacionId]
        );

        assert.equal(operacionFinal.rows[0].estado, 'completada');
        assert.ok(operacionFinal.rows[0].cerrada_en);

        // La reserva queda liberada.
        const reservaFinal = await pool.query(
          `SELECT 1 FROM reserva_activa
           WHERE ejemplar_id=$1`,
          [ejemplarId]
        );

        assert.equal(reservaFinal.rowCount, 0);

        // La conservación queda actualizada.
        const ejemplarFinal = await pool.query(
          `SELECT conservacion FROM ejemplar WHERE id=$1`,
          [ejemplarId]
        );

        assert.equal(
          ejemplarFinal.rows[0].conservacion,
          'Buen estado, sin daños visibles'
        );

        // Conservar el historial de transiciones.
        const eventos = await pool.query(
          `SELECT accion FROM evento_operacion
           WHERE operacion_id=$1`,
          [operacionId]
        );

        for (const accion of [
          'adjudicar_prestamo',
          'entregar_prestamo',
          'devolver_prestamo'
        ]) {
          assert.ok(
            eventos.rows.some(e => e.accion === accion),
            `Falta el evento ${accion}`
          );
        }

        // No se registra una cancelación rechazada.
        assert.equal(
          eventos.rows.some(
            e => e.accion === 'cancelar_prestamo'
          ),
          false
        );
      }
    );  

    
    await t.test(
      'Daños: incidencia, bloqueo y cierre',
      async () => {
        const docente = sesiones.DocentePrueba;
        const alumno = sesiones.AlumnoPrueba1;

        // Crear un nuevo préstamo del ejemplar ya devuelto.
        const solicitud = await pedir(
          alumno,
          '/api/prestamos/solicitudes',
          'POST',
          { ejemplarId }
        );
        assert.equal(solicitud.status, 201, JSON.stringify(solicitud));

        const adjudicacion = await pedir(
          docente,
          `/api/gestion/prestamos/solicitudes/${solicitud.datos.id}/adjudicar`,
          'POST',
          {
            motivo: 'Préstamo para ensayo de incidencia',
            vencimiento: new Date(
              Date.now() + 7 * 86400000
            ).toISOString()
          }
        );
        assert.equal(adjudicacion.status, 201, JSON.stringify(adjudicacion));

        const operacionId = adjudicacion.datos.id;

        const entrega = await pedir(
          docente,
          `/api/gestion/prestamos/${operacionId}/entregar`,
          'POST',
          {}
        );
        assert.equal(entrega.status, 200, JSON.stringify(entrega));

        // Registrar daños mientras el ejemplar está prestado.
        const incidencia = await pedir(
          docente,
          `/api/gestion/prestamos/${operacionId}/incidencias`,
          'POST',
          {
            tipo: 'dano',
            descripcion: 'Cubierta deteriorada durante el préstamo'
          }
        );
        assert.equal(incidencia.status, 201, JSON.stringify(incidencia));

        const abierta = await pool.query(
          `SELECT tipo, estado FROM incidencia
           WHERE operacion_id=$1 AND ejemplar_id=$2`,
          [operacionId, ejemplarId]
        );
        assert.equal(abierta.rowCount, 1);
        assert.equal(abierta.rows[0].tipo, 'dano');
        assert.equal(abierta.rows[0].estado, 'abierta');

        // El ejemplar sigue ocupado durante la incidencia.
        const reserva = await pool.query(
          'SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1',
          [ejemplarId]
        );
        assert.equal(reserva.rowCount, 1);

        // No se permite una devolución normal con incidencia abierta.
        const devolucionRechazada = await pedir(
          docente,
          `/api/gestion/prestamos/${operacionId}/devolver`,
          'POST',
          {
            conservacion: 'Cubierta deteriorada',
            confirmoBuenEstado: true
          }
        );
        assert.equal(
          devolucionRechazada.status,
          409,
          JSON.stringify(devolucionRechazada)
        );

        // Resolver y cerrar la operación por incidencia.
        const cierre = await pedir(
          docente,
          `/api/gestion/prestamos/${operacionId}/cerrar-incidencia`,
          'POST',
          {
            resolucion: 'Ejemplar retirado para revisión y reparación'
          }
        );
        assert.equal(cierre.status, 200, JSON.stringify(cierre));

        const estadoFinal = await pool.query(
          'SELECT estado FROM operacion WHERE id=$1',
          [operacionId]
        );
        assert.equal(estadoFinal.rows[0].estado, 'cerrada_por_incidencia');

        const incidenciaFinal = await pool.query(
          'SELECT estado, resolucion FROM incidencia WHERE operacion_id=$1',
          [operacionId]
        );
        assert.equal(incidenciaFinal.rows[0].estado, 'resuelta');
        assert.ok(incidenciaFinal.rows[0].resolucion);

        const ejemplarFinal = await pool.query(
          'SELECT estado_servicio FROM ejemplar WHERE id=$1',
          [ejemplarId]
        );
        assert.equal(ejemplarFinal.rows[0].estado_servicio, 'retirado');

        const reservaFinal = await pool.query(
          'SELECT 1 FROM reserva_activa WHERE ejemplar_id=$1',
          [ejemplarId]
        );
        assert.equal(reservaFinal.rowCount, 0);

        // Conservar los eventos y los avisos de la operación.
        const eventos = await pool.query(
          'SELECT accion FROM evento_operacion WHERE operacion_id=$1',
          [operacionId]
        );
        assert.ok(eventos.rowCount >= 4);

        const avisos = await pool.query(
          'SELECT id FROM aviso WHERE operacion_id=$1',
          [operacionId]
        );
        assert.ok(avisos.rowCount >= 1);
      }
    );


  } finally {
    if (servidor) {
      await new Promise(resolve => servidor.close(resolve));
    }

    if (almacen) {
      await almacen.close();
    }

    if (pool) {
      await pool.end();
    }

    // Eliminar exclusivamente el esquema temporal creado.
    if (/^aula_test_[a-f0-9]{16}$/.test(esquema)) {
      await admin.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    }

    await admin.end();
  }
});
