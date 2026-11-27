import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';
import { crearAplicacion } from '../src/app.mjs';
import { crearHash } from '../src/claves.mjs';
import { eliminarArchivoPrivado } from '../src/documentos/archivos.mjs';

const ORIGEN = 'http://127.0.0.1:3000';
const CLAVE = 'Frase ficticia de pruebas MVP 2026';

async function preparar(reportes) {
  const esquema = 'aula_mvp_' + randomBytes(8).toString('hex');
  const admin = new pg.Pool({ max: 1, connectionTimeoutMillis: 3000 });
  let pool, servidor, almacen;
  try {
    // Cada caso usa un esquema temporal nuevo y lo elimina al finalizar.
    await admin.query(`CREATE SCHEMA "${esquema}"`);
    pool = new pg.Pool({
      max: 5,
      options: `-c search_path=${esquema}`,
      connectionTimeoutMillis: 3000
    });
    const carpeta = new URL('../sql/migraciones/', import.meta.url);
    for (const nombre of (await readdir(carpeta))
      .filter(nombre => nombre.endsWith('.sql')).sort()) {
      await pool.query(await readFile(new URL(nombre, carpeta), 'utf8'));
    }

    const hash = await crearHash(CLAVE);
    const usuarios = {};
    for (const [clave, alias, rol, curso] of [
      ['a', 'Alumna A', 'alumno', 1],
      ['b', 'Alumno B', 'alumno', 1],
      ['c', 'Alumno C', 'alumno', 1],
      ['e', 'Alumno DAW2', 'alumno', 2],
      ['d', 'Docente MVP', 'docente', 1]
    ]) {
      const correo = `${randomUUID()}@example.invalid`;
      const fila = await pool.query(`INSERT INTO usuario
        (alias,correo,hash,curso_solicitado_id,curso_confirmado_id,estado)
        VALUES($1,$2,$3,$4,$4,'activo') RETURNING id`,
      [alias, correo, hash, curso]);
      const id = fila.rows[0].id;
      await pool.query('INSERT INTO usuario_rol(usuario_id,rol) VALUES($1,$2)', [id, rol]);
      usuarios[clave] = { id, alias, correo };
    }

    const aplicacion = await crearAplicacion(pool, {
      origen: ORIGEN,
      secreto: randomBytes(32).toString('hex'),
      esquema,
      limitar: false
    });
    almacen = aplicacion.almacen;
    servidor = aplicacion.app.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const base = `http://127.0.0.1:${servidor.address().port}`;

    async function pedir(sesion, ruta, metodo = 'GET', cuerpo, opciones = {}) {
      const headers = { Cookie: sesion?.cookie ?? '', ...opciones.headers };
      if (metodo !== 'GET' && !(cuerpo instanceof FormData)) {
        Object.assign(headers, {
          Origin: ORIGEN,
          'Content-Type': 'application/json',
          'X-CSRF-Token': sesion?.token ?? ''
        });
      } else if (metodo !== 'GET') {
        Object.assign(headers, {
          Origin: ORIGEN,
          'X-CSRF-Token': sesion?.token ?? ''
        });
      }
      const respuesta = await fetch(base + ruta, {
        method: metodo,
        headers,
        body: cuerpo === undefined
          ? undefined
          : cuerpo instanceof FormData ? cuerpo : JSON.stringify(cuerpo)
      });
      const cookies = respuesta.headers.getSetCookie();
      if (cookies.length && sesion) sesion.cookie = cookies[0].split(';')[0];
      const tipo = respuesta.headers.get('content-type') ?? '';
      let datos;
      if (respuesta.status === 204) datos = null;
      else if (tipo.includes('application/json')) datos = await respuesta.json();
      else if (tipo.startsWith('text/')) datos = await respuesta.text();
      else datos = Buffer.from(await respuesta.arrayBuffer());
      if (sesion && datos?.token) sesion.token = datos.token;
      return { status: respuesta.status, datos, headers: respuesta.headers };
    }

    function informar(esperada, recibida, consulta) {
      const imprimir = valor => JSON.stringify(valor, (_clave, dato) =>
        Buffer.isBuffer(dato) ? `[Buffer ${dato.length} bytes]` : dato);
      const estado = respuesta => {
        const codigo = Array.isArray(respuesta.status)
          ? respuesta.status.join(', ')
          : String(respuesta.status);
        const error = respuesta.error ?? respuesta.datos?.error;
        return error ? `${codigo} (${error})` : codigo;
      };
      reportes.push({
        consulta,
        esperado: estado(esperada),
        obtenido: estado(recibida)
      });
      const comparar = Array.isArray(esperada.status) || Array.isArray(recibida.status)
        ? assert.deepEqual
        : assert.equal;
      comparar(recibida.status, esperada.status,
        `Esperada ${imprimir(esperada)}; recibida ${imprimir(recibida)}`);
      if (esperada.error !== undefined) {
        assert.equal(recibida.datos?.error, esperada.error);
      }
      return recibida;
    }

    async function esperar(sesion, ruta, esperada, metodo = 'GET', cuerpo) {
      return informar(esperada, await pedir(sesion, ruta, metodo, cuerpo),
        `${metodo} ${ruta}`);
    }

    async function acceder(claveUsuario) {
      const sesion = {};
      await pedir(sesion, '/api/csrf');
      const usuario = usuarios[claveUsuario];
      const resultado = await pedir(sesion, '/api/acceso', 'POST', {
        correo: usuario.correo,
        clave: CLAVE
      });
      assert.equal(resultado.status, 200, JSON.stringify(resultado.datos));
      return sesion;
    }

    const sesiones = {
      a: await acceder('a'),
      b: await acceder('b'),
      c: await acceder('c'),
      e: await acceder('e'),
      d: await acceder('d')
    };

    async function crearMaterial(
      propietario, modalidad, titulo = `Material ${randomUUID()}`, cursoId = 1
    ) {
      const alta = await pedir(propietario, '/api/anuncios', 'POST', {
        titulo,
        descripcion: 'Material ficticio para prueba MVP',
        cursoId,
        asignatura: 'Programación',
        edicion: '2026',
        isbn: '',
        conservacion: 'Buen estado',
        modalidad
      });
      assert.equal(alta.status, 201, JSON.stringify(alta.datos));
      const envio = await pedir(propietario, `/api/anuncios/${alta.datos.datos.id}/enviar`,
        'POST', { version: alta.datos.datos.version });
      assert.equal(envio.status, 200, JSON.stringify(envio.datos));
      const revision = await pedir(sesiones.d, `/api/gestion/anuncios/${alta.datos.datos.id}/revision`,
        'POST', { version: envio.datos.datos.version, decision: 'aprobar', motivo: '' });
      assert.equal(revision.status, 200, JSON.stringify(revision.datos));
      const detalle = await pedir(propietario, `/api/anuncios/${alta.datos.datos.id}`);
      assert.equal(detalle.status, 200);
      return {
        id: alta.datos.datos.id,
        ejemplar: detalle.datos.datos.ejemplar_id,
        version: revision.datos.datos.version
      };
    }

    async function solicitarCesion(sesion, ejemplarId) {
      const r = await pedir(sesion, '/api/solicitudes', 'POST', { ejemplarId });
      assert.equal(r.status, 201, JSON.stringify(r.datos));
      return r.datos.datos.id;
    }

    async function asignarCesion(id) {
      const r = await pedir(sesiones.d, `/api/gestion/solicitudes/${id}/asignar`,
        'POST', { motivo: 'Asignación de prueba MVP' });
      assert.equal(r.status, 201, JSON.stringify(r.datos));
      return r.datos.datos.id;
    }

    async function solicitarPrestamo(sesion, ejemplarId) {
      const r = await pedir(sesion, '/api/prestamos/solicitudes', 'POST', { ejemplarId });
      assert.equal(r.status, 201, JSON.stringify(r.datos));
      return r.datos.datos.id;
    }

    async function adjudicarPrestamo(id) {
      const r = await pedir(sesiones.d, `/api/gestion/prestamos/solicitudes/${id}/adjudicar`,
        'POST', {
          motivo: 'Adjudicación de prueba MVP',
          vencimiento: new Date(Date.now() + 7 * 86400000).toISOString()
        });
      assert.equal(r.status, 201, JSON.stringify(r.datos));
      return r.datos.datos.id;
    }

    async function proponerIntercambio(proponente, receptor, ofrecido, solicitado) {
      const propuesta = await pedir(proponente, '/api/intercambios', 'POST', {
        ejemplarOfrecidoId: ofrecido.ejemplar,
        ejemplarSolicitadoId: solicitado.ejemplar,
        confirmoPropuesta: true
      });
      assert.equal(propuesta.status, 201, JSON.stringify(propuesta.datos));
      return propuesta.datos.datos;
    }

    async function aceptarIntercambio(sesion, propuesta) {
      return pedir(sesion, `/api/intercambios/${propuesta.id}/aceptar`, 'POST', {
        ejemplarOfrecidoId: propuesta.ejemplarOfrecidoId,
        ejemplarSolicitadoId: propuesta.ejemplarSolicitadoId,
        versionOfrecida: propuesta.versionOfrecida,
        versionSolicitada: propuesta.versionSolicitada,
        confirmoAceptacion: true
      });
    }

    return {
      admin, pool, servidor, almacen, esquema, base, usuarios, sesiones,
      pedir, esperar, informar, crearMaterial, solicitarCesion, asignarCesion,
      solicitarPrestamo, adjudicarPrestamo, proponerIntercambio,
      aceptarIntercambio
    };
  } catch (error) {
    if (servidor) {
      servidor.closeAllConnections();
      await new Promise(resolve => servidor.close(resolve));
    }
    almacen?.stopExpiringSessions?.();
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin.end();
    throw error;
  }
}

async function cerrar(env) {
  if (env.servidor) {
    env.servidor.closeAllConnections();
    await new Promise((resolve, reject) =>
      env.servidor.close(error => error ? reject(error) : resolve()));
  }
  env.almacen?.stopExpiringSessions?.();
  const archivo = await env.pool.query(
    "SELECT ruta FROM archivo WHERE almacenamiento_privado=true");
  await env.pool.end();
  for (const fila of archivo.rows) await eliminarArchivoPrivado(fila.ruta);
  await env.admin.query(`DROP SCHEMA IF EXISTS "${env.esquema}" CASCADE`);
  await env.admin.end();
}

function caso(numero, nombre, ejecutar) {
  test(`Test ${numero} - ${nombre}`, async () => {
    const reportes = [];
    const titulo = `Test ${numero} - ${nombre}`;
    const env = await preparar(reportes);
    try {
      await ejecutar(env);
    } finally {
      try {
        await cerrar(env);
      } finally {
        imprimirTablaResultados(titulo, reportes);
      }
    }
  });
}

function imprimirTablaResultados(titulo, reportes) {
  const cabeceras = ['', 'Estado esperado', 'Estado obtenido'];
  const filas = reportes.map(({ consulta, esperado, obtenido }) =>
    [consulta, esperado, obtenido]);
  const anchos = cabeceras.map((cabecera, i) =>
    Math.max(cabecera.length, ...filas.map(fila => fila[i].length)));
  const borde = '+' + anchos.map(ancho => '-'.repeat(ancho + 2)).join('+') + '+';
  const fila = valores => '| ' + valores.map((valor, i) =>
    valor.padEnd(anchos[i])).join(' | ') + ' |';

  console.log(`\n${titulo}`);
  console.log(borde);
  console.log(fila(cabeceras));
  console.log(borde);
  for (const resultado of filas) console.log(fila(resultado));
  console.log(borde);
}

caso(1, 'Inicio sin sesión activa', async env => {
  const respuesta = await env.pedir(null, '/');
  env.informar({ status: 200 }, respuesta, 'GET /');
  assert.match(respuesta.datos, /<html|<!doctype html/i);
  const inicio = await env.esperar(null, '/html/index.html', { status: 200 });
  assert.match(inicio.datos, /<html|<!doctype html/i);
});

caso(2, 'Permisos de una cuenta alumno aleatoria', async env => {
  const libros = await env.esperar(env.sesiones.a, '/api/libros', { status: 200 });
  const gestion = await env.esperar(env.sesiones.a, '/api/gestion/usuarios',
    { status: 403, error: 'PERMISO_DOCENTE_NECESARIO' });
  assert.ok(Array.isArray(libros.datos.datos));
  assert.equal(gestion.datos.error, 'PERMISO_DOCENTE_NECESARIO');
});

caso(3, 'Permisos de la cuenta docente', async env => {
  const gestion = await env.esperar(env.sesiones.d, '/api/gestion/usuarios', { status: 200 });
  const alumnos = await env.esperar(env.sesiones.d, '/api/libros', { status: 200 });
  assert.ok(Array.isArray(gestion.datos.datos));
  assert.ok(Array.isArray(alumnos.datos.datos));
});

caso(4, 'Crear un nuevo usuario alumno', async env => {
  const sesion = {};
  await env.pedir(sesion, '/api/csrf');
  const correo = `${randomUUID()}@example.invalid`;
  const alta = await env.esperar(sesion, '/api/registro', { status: 202 }, 'POST', {
    alias: 'Alumno MVP nuevo',
    correo,
    clave: CLAVE,
    cursoId: 1
  });
  const estado = await env.pool.query(
    "SELECT estado FROM usuario WHERE correo=$1", [correo]);
  assert.deepEqual(estado.rows, [{ estado: 'pendiente' }]);
});

caso(5, 'Validar el nuevo alumno desde docente', async env => {
  const sesion = {};
  await env.pedir(sesion, '/api/csrf');
  const correo = `${randomUUID()}@example.invalid`;
  await env.pedir(sesion, '/api/registro', 'POST', {
    alias: 'Alumno MVP validable', correo, clave: CLAVE, cursoId: 1
  });
  await env.pedir(sesion, '/api/acceso', 'POST', { correo, clave: CLAVE });
  const perfil = await env.pedir(sesion, '/api/yo');
  await env.esperar(env.sesiones.d,
    `/api/gestion/usuarios/${perfil.datos.datos.id}/validar`,
    { status: 200 }, 'POST', { cursoId: 1 });
  const estado = await env.pool.query(
    'SELECT estado,curso_confirmado_id FROM usuario WHERE id=$1',
    [perfil.datos.datos.id]);
  assert.deepEqual(estado.rows, [{ estado: 'activo', curso_confirmado_id: 1 }]);
});

caso(6, 'Añadir material alumno en cesión, préstamo e intercambio', async env => {
  for (const modalidad of ['cesion', 'prestamo', 'intercambio']) {
    const titulo = `MVP ${modalidad} ${randomUUID()}`;
    const alta = await env.esperar(env.sesiones.a, '/api/anuncios', { status: 201 }, 'POST', {
      titulo,
      descripcion: 'Material ficticio para prueba MVP',
      cursoId: 1,
      asignatura: 'Programación',
      edicion: '2026',
      isbn: '',
      conservacion: 'Buen estado',
      modalidad
    });
    const envio = await env.esperar(env.sesiones.a,
      `/api/anuncios/${alta.datos.datos.id}/enviar`, { status: 200 }, 'POST',
      { version: alta.datos.datos.version });
    await env.esperar(env.sesiones.d,
      `/api/gestion/anuncios/${alta.datos.datos.id}/revision`, { status: 200 }, 'POST', {
        version: envio.datos.datos.version,
        decision: 'aprobar',
        motivo: ''
      });
  }
  const catalogo = await env.pedir(env.sesiones.a, '/api/libros');
  assert.deepEqual(
    ['cesion', 'prestamo', 'intercambio'].map(m =>
      catalogo.datos.datos.some(f => f.modalidad === m)),
    [true, true, true]
  );
  env.informar({ status: 200, modalidades: ['cesion', 'prestamo', 'intercambio'] },
    { status: catalogo.status, modalidades: ['cesion', 'prestamo', 'intercambio'] },
    'GET /api/libros (comprobar las tres modalidades)');
});

caso(7, 'Descargar un archivo de documentación', async env => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 200]);
  const contenido = Buffer.from(await pdf.save());
  const form = new FormData();
  form.set('titulo', 'Documento MVP');
  form.set('cursoId', '1');
  form.set('version', 'v1');
  form.set('archivo', new Blob([contenido], { type: 'application/pdf' }), 'mvp.pdf');
  const subida = await env.pedir(env.sesiones.d, '/api/documentos', 'POST', form);
  env.informar({ status: 201 }, subida, 'POST /api/documentos (subir archivo)');
  const archivoId = subida.datos.datos.archivoId;
  const publicado = await env.esperar(env.sesiones.d,
    `/api/documentos/${subida.datos.datos.documentoId}/publicar`, { status: 200 }, 'PATCH');
  assert.equal(publicado.status, 200);
  const descarga = await env.pedir(env.sesiones.a,
    `/api/documentos/${archivoId}/descargar`);
  env.informar({ status: 200, bytes: contenido.length },
    { status: descarga.status, bytes: descarga.datos.length },
    `GET /api/documentos/${archivoId}/descargar`);
  assert.deepEqual(descarga.datos, contenido);
});

caso(8, 'Solicitar una cesión y cancelar desde quien la solicitó', async env => {
  const material = await env.crearMaterial(env.sesiones.a, 'cesion');
  const solicitud = await env.solicitarCesion(env.sesiones.b, material.ejemplar);
  const respuesta = await env.esperar(env.sesiones.b,
    `/api/solicitudes/${solicitud}/cancelar`, { status: 200 }, 'POST', {});
  assert.equal(respuesta.datos.datos.estado, 'cancelada');
});

caso(9, 'Solicitar una cesión y cancelar desde docente', async env => {
  const material = await env.crearMaterial(env.sesiones.a, 'cesion');
  const solicitud = await env.solicitarCesion(env.sesiones.b, material.ejemplar);
  const operacion = await env.asignarCesion(solicitud);
  const respuesta = await env.esperar(env.sesiones.d,
    `/api/gestion/operaciones/${operacion}/cancelar`, { status: 200 }, 'POST',
    { motivo: 'Cancelación docente de prueba' });
  assert.equal(respuesta.datos.datos.estado, 'cancelada');
});

caso(10, 'Solicitar un préstamo y cancelar desde quien lo solicitó', async env => {
  const material = await env.crearMaterial(env.sesiones.a, 'prestamo');
  const solicitud = await env.solicitarPrestamo(env.sesiones.b, material.ejemplar);
  const respuesta = await env.esperar(env.sesiones.b,
    `/api/solicitudes/${solicitud}/cancelar`, { status: 200 }, 'POST', {});
  assert.equal(respuesta.datos.datos.estado, 'cancelada');
});

caso(11, 'Solicitar un préstamo y cancelar desde docente', async env => {
  const material = await env.crearMaterial(env.sesiones.a, 'prestamo');
  const solicitud = await env.solicitarPrestamo(env.sesiones.b, material.ejemplar);
  const operacion = await env.adjudicarPrestamo(solicitud);
  const respuesta = await env.esperar(env.sesiones.d,
    `/api/gestion/prestamos/${operacion}/cancelar`, { status: 200 }, 'POST',
    { motivo: 'Cancelación docente de prueba' });
  assert.equal(respuesta.datos.datos.estado, 'cancelada');
});

caso(12, 'Solicitar un intercambio y cancelar desde quien lo solicitó', async env => {
  const ofrecido = await env.crearMaterial(env.sesiones.a, 'intercambio');
  const solicitado = await env.crearMaterial(env.sesiones.b, 'intercambio');
  const propuesta = await env.proponerIntercambio(
    env.sesiones.a, env.sesiones.b, ofrecido, solicitado);
  const respuesta = await env.esperar(env.sesiones.a,
    `/api/intercambios/${propuesta.id}/cancelar`, { status: 200 }, 'POST', {});
  assert.equal(respuesta.datos.datos.estado, 'cancelada');
  const receptor = await env.esperar(env.sesiones.b,
    `/api/intercambios/${propuesta.id}/aceptar`,
    { status: 409, error: 'PROPUESTA_NO_VIGENTE' }, 'POST', {
      ejemplarOfrecidoId: propuesta.ejemplarOfrecidoId,
      ejemplarSolicitadoId: propuesta.ejemplarSolicitadoId,
      versionOfrecida: propuesta.versionOfrecida,
      versionSolicitada: propuesta.versionSolicitada,
      confirmoAceptacion: true
    });
  assert.equal(receptor.datos.error, 'PROPUESTA_NO_VIGENTE');
  const detalle = await env.pedir(env.sesiones.b, `/api/intercambios/${propuesta.id}`);
  assert.equal(detalle.datos.datos.canceladoPor, 'Alumna A');
  const panel = await env.pedir(env.sesiones.b, '/api/mi-espacio/panel');
  assert.ok(panel.datos.datos.avisos.some(aviso =>
    aviso.mensaje === 'Intercambio cancelado por Alumna A'));
});

caso(13, 'Solicitar un intercambio y cancelar desde propietario del segundo material', async env => {
  const ofrecido = await env.crearMaterial(env.sesiones.a, 'intercambio');
  const solicitado = await env.crearMaterial(env.sesiones.b, 'intercambio');
  const propuesta = await env.proponerIntercambio(
    env.sesiones.a, env.sesiones.b, ofrecido, solicitado);
  const respuesta = await env.esperar(env.sesiones.b,
    `/api/intercambios/${propuesta.id}/rechazar`, { status: 200 }, 'POST', {});
  assert.equal(respuesta.datos.datos.estado, 'cancelada');
});

caso(14, 'Cancelar intercambio desde docente tras aceptación del otro propietario', async env => {
  const ofrecido = await env.crearMaterial(env.sesiones.a, 'intercambio');
  const solicitado = await env.crearMaterial(env.sesiones.b, 'intercambio');
  const propuesta = await env.proponerIntercambio(
    env.sesiones.a, env.sesiones.b, ofrecido, solicitado);
  const aceptacion = await env.aceptarIntercambio(env.sesiones.b, propuesta);
  assert.equal(aceptacion.status, 200);
  await env.esperar(env.sesiones.d,
    `/api/gestion/intercambios/${propuesta.id}/reservar`, { status: 200 }, 'POST', {});
  const respuesta = await env.esperar(env.sesiones.d,
    `/api/gestion/operaciones/${propuesta.id}/cancelar`, { status: 200 }, 'POST',
    { motivo: 'Cancelación docente de prueba' });
  assert.equal(respuesta.datos.datos.estado, 'cancelada');
});

caso(15, 'Solicitar un intercambio sin tener material para ofrecer', async env => {
  const solicitado = await env.crearMaterial(env.sesiones.a, 'intercambio');
  const ajeno = await env.crearMaterial(env.sesiones.b, 'intercambio');
  const respuesta = await env.esperar(env.sesiones.c, '/api/intercambios',
    { status: 403, error: 'PROPIEDAD_NECESARIA' }, 'POST', {
      ejemplarOfrecidoId: ajeno.ejemplar,
      ejemplarSolicitadoId: solicitado.ejemplar,
      confirmoPropuesta: true
    });
});

caso(16, 'Completar una cesión', async env => {
  const material = await env.crearMaterial(env.sesiones.a, 'cesion');
  const solicitud = await env.solicitarCesion(env.sesiones.b, material.ejemplar);
  const operacion = await env.asignarCesion(solicitud);
  const respuesta = await env.esperar(env.sesiones.d,
    `/api/gestion/operaciones/${operacion}/entregar`, { status: 200 }, 'POST', {});
  assert.equal(respuesta.datos.datos.estado, 'completada');
});

caso(17, 'Completar un préstamo', async env => {
  const material = await env.crearMaterial(env.sesiones.a, 'prestamo');
  const solicitud = await env.solicitarPrestamo(env.sesiones.b, material.ejemplar);
  const operacion = await env.adjudicarPrestamo(solicitud);
  await env.esperar(env.sesiones.d,
    `/api/gestion/prestamos/${operacion}/entregar`, { status: 200 }, 'POST', {});
  const respuesta = await env.esperar(env.sesiones.d,
    `/api/gestion/prestamos/${operacion}/devolver`, { status: 200 }, 'POST', {
      conservacion: 'Buen estado',
      confirmoBuenEstado: true
    });
  assert.equal(respuesta.datos.datos.estado, 'completada');
});

caso(18, 'Completar un intercambio', async env => {
  const ofrecido = await env.crearMaterial(env.sesiones.a, 'intercambio');
  const solicitado = await env.crearMaterial(env.sesiones.b, 'intercambio');
  const propuesta = await env.proponerIntercambio(
    env.sesiones.a, env.sesiones.b, ofrecido, solicitado);
  const aceptacion = await env.aceptarIntercambio(env.sesiones.b, propuesta);
  assert.equal(aceptacion.status, 200);
  await env.esperar(env.sesiones.d,
    `/api/gestion/intercambios/${propuesta.id}/reservar`, { status: 200 }, 'POST', {});
  const respuesta = await env.esperar(env.sesiones.d,
    `/api/gestion/operaciones/${propuesta.id}/entregar`, { status: 200 }, 'POST', {});
  assert.equal(respuesta.datos.datos.estado, 'completada');
});

caso(19, 'Dos usuarios solicitan la misma cesión y docente resuelve ambas', async env => {
  const material = await env.crearMaterial(env.sesiones.a, 'cesion');
  const resultados = await Promise.all([
    env.pedir(env.sesiones.b, '/api/solicitudes', 'POST', { ejemplarId: material.ejemplar }),
    env.pedir(env.sesiones.c, '/api/solicitudes', 'POST', { ejemplarId: material.ejemplar })
  ]);
  env.informar({ status: [201, 201] }, { status: resultados.map(r => r.status) },
    'POST /api/solicitudes (dos usuarios, misma cesión)');
  const asignaciones = [];
  for (const solicitud of resultados) {
    asignaciones.push(await env.pedir(env.sesiones.d,
      `/api/gestion/solicitudes/${solicitud.datos.datos.id}/asignar`,
      'POST', { motivo: 'Asignación concurrente MVP' }));
  }
  env.informar({ status: [201, 409] }, { status: asignaciones.map(r => r.status) },
    'POST /api/gestion/solicitudes/:id/asignar (primera y segunda solicitud)');
});

caso(20, 'Dos usuarios solicitan el mismo préstamo y docente resuelve ambas', async env => {
  const material = await env.crearMaterial(env.sesiones.a, 'prestamo');
  const resultados = await Promise.all([
    env.pedir(env.sesiones.b, '/api/prestamos/solicitudes', 'POST', { ejemplarId: material.ejemplar }),
    env.pedir(env.sesiones.c, '/api/prestamos/solicitudes', 'POST', { ejemplarId: material.ejemplar })
  ]);
  env.informar({ status: [201, 201] }, { status: resultados.map(r => r.status) },
    'POST /api/prestamos/solicitudes (dos usuarios, mismo préstamo)');
  const adjudicaciones = [];
  for (const solicitud of resultados) {
    adjudicaciones.push(await env.pedir(env.sesiones.d,
      `/api/gestion/prestamos/solicitudes/${solicitud.datos.datos.id}/adjudicar`,
      'POST', {
        motivo: 'Adjudicación concurrente MVP',
        vencimiento: new Date(Date.now() + 7 * 86400000).toISOString()
      }));
  }
  env.informar({ status: [201, 409] }, { status: adjudicaciones.map(r => r.status) },
    'POST /api/gestion/prestamos/solicitudes/:id/adjudicar (primera y segunda solicitud)');
});

caso(21, 'Dos intercambios concurrentes y aceptación del propietario receptor', async env => {
  const solicitado = await env.crearMaterial(env.sesiones.a, 'intercambio');
  const ofrecidoB = await env.crearMaterial(env.sesiones.b, 'intercambio');
  const ofrecidoC = await env.crearMaterial(env.sesiones.c, 'intercambio');

  const propuestas = await Promise.all([
    env.proponerIntercambio(env.sesiones.b, env.sesiones.a, ofrecidoB, solicitado),
    env.proponerIntercambio(env.sesiones.c, env.sesiones.a, ofrecidoC, solicitado)
  ]);

  const aceptaciones = await Promise.all(propuestas.map(p =>
    env.aceptarIntercambio(env.sesiones.a, p)));

  // El orden de procesamiento de las peticiones concurrentes
  // no garantiza qué propuesta será aceptada primero.
  const estados = aceptaciones
    .map(r => r.status)
    .sort((a, b) => a - b);

  env.informar(
    { status: [200, 409] },
    { status: estados },
    'POST /api/intercambios/:id/aceptar (dos propuestas sobre el mismo material, sin importar el orden)'
  );
});

caso(22, 'Carrera entre cancelar y aceptar un intercambio', async env => {
  const ofrecido = await env.crearMaterial(env.sesiones.a, 'intercambio');
  const solicitado = await env.crearMaterial(env.sesiones.b, 'intercambio');
  const propuesta = await env.proponerIntercambio(
    env.sesiones.a, env.sesiones.b, ofrecido, solicitado);
  const entrada = {
    ejemplarOfrecidoId: propuesta.ejemplarOfrecidoId,
    ejemplarSolicitadoId: propuesta.ejemplarSolicitadoId,
    versionOfrecida: propuesta.versionOfrecida,
    versionSolicitada: propuesta.versionSolicitada,
    confirmoAceptacion: true
  };
  const [cancelacion, aceptacion] = await Promise.all([
    env.pedir(env.sesiones.a, `/api/intercambios/${propuesta.id}/cancelar`, 'POST', {}),
    env.pedir(env.sesiones.b, `/api/intercambios/${propuesta.id}/aceptar`, 'POST', entrada)
  ]);
  env.informar({ status: [200, 409] },
    { status: [cancelacion.status, aceptacion.status] },
    'POST cancelar y aceptar simultáneamente (cancelación iniciada primero)');
  assert.equal(cancelacion.datos.datos.estado, 'cancelada');

  await env.esperar(env.sesiones.b, `/api/intercambios/${propuesta.id}/aceptar`,
    { status: 409, error: 'PROPUESTA_NO_VIGENTE' }, 'POST', entrada);
});

caso(23, 'Cancelar libera los dos materiales para otra propuesta', async env => {
  const ofrecido = await env.crearMaterial(env.sesiones.a, 'intercambio');
  const solicitado = await env.crearMaterial(env.sesiones.b, 'intercambio');
  const propuesta = await env.proponerIntercambio(
    env.sesiones.a, env.sesiones.b, ofrecido, solicitado);
  await env.esperar(env.sesiones.a, `/api/intercambios/${propuesta.id}/cancelar`,
    { status: 200 }, 'POST', {});

  await env.esperar(env.sesiones.b, '/api/intercambios', { status: 201 }, 'POST', {
    ejemplarOfrecidoId: solicitado.ejemplar,
    ejemplarSolicitadoId: ofrecido.ejemplar,
    confirmoPropuesta: true
  });
});

caso(24, 'El solicitante no puede cancelar después de reservar', async env => {
  const ofrecido = await env.crearMaterial(env.sesiones.a, 'intercambio');
  const solicitado = await env.crearMaterial(env.sesiones.b, 'intercambio');
  const propuesta = await env.proponerIntercambio(
    env.sesiones.a, env.sesiones.b, ofrecido, solicitado);
  await env.esperar(env.sesiones.b, `/api/intercambios/${propuesta.id}/aceptar`,
    { status: 200 }, 'POST', {
      ejemplarOfrecidoId: propuesta.ejemplarOfrecidoId,
      ejemplarSolicitadoId: propuesta.ejemplarSolicitadoId,
      versionOfrecida: propuesta.versionOfrecida,
      versionSolicitada: propuesta.versionSolicitada,
      confirmoAceptacion: true
    });
  await env.esperar(env.sesiones.d, `/api/gestion/intercambios/${propuesta.id}/reservar`,
    { status: 200 }, 'POST', {});

  await env.esperar(env.sesiones.a, `/api/intercambios/${propuesta.id}/cancelar`,
    { status: 409, error: 'PROPUESTA_NO_VIGENTE' }, 'POST', {});
});

caso(25, 'Cancelar dos veces no duplica el evento ni el aviso', async env => {
  const ofrecido = await env.crearMaterial(env.sesiones.a, 'intercambio');
  const solicitado = await env.crearMaterial(env.sesiones.b, 'intercambio');
  const propuesta = await env.proponerIntercambio(
    env.sesiones.a, env.sesiones.b, ofrecido, solicitado);
  await env.esperar(env.sesiones.a, `/api/intercambios/${propuesta.id}/cancelar`,
    { status: 200 }, 'POST', {});
  await env.esperar(env.sesiones.a, `/api/intercambios/${propuesta.id}/cancelar`,
    { status: 409, error: 'PROPUESTA_NO_VIGENTE' }, 'POST', {});

  const eventos = await env.pool.query(`SELECT count(*)::int AS cantidad
    FROM evento_operacion
    WHERE operacion_id=$1 AND accion='cancelar_intercambio_solicitante'`,
  [propuesta.id]);
  env.informar({ status: 1 }, { status: eventos.rows[0].cantidad },
    'BD evento de cancelación (debe existir una sola vez)');

  const avisos = await env.pool.query(`SELECT count(*)::int AS cantidad
    FROM aviso
    WHERE operacion_id=$1 AND destinatario_id=$2
      AND mensaje='Intercambio cancelado por Alumna A'`,
  [propuesta.id, env.usuarios.b.id]);
  env.informar({ status: 1 }, { status: avisos.rows[0].cantidad },
    'BD aviso al receptor (debe existir una sola vez)');
});

caso(26, 'Alumno DAW1 no puede solicitar cesión de material DAW2', async env => {
  const material = await env.crearMaterial(
    env.sesiones.e, 'cesion', 'Cesión de material DAW2', 2);
  await env.esperar(env.sesiones.a, '/api/solicitudes',
    { status: 403 }, 'POST', { ejemplarId: material.ejemplar });
});

caso(27, 'Alumno DAW1 no puede solicitar préstamo de material DAW2', async env => {
  const material = await env.crearMaterial(
    env.sesiones.e, 'prestamo', 'Préstamo de material DAW2', 2);
  await env.esperar(env.sesiones.a, '/api/prestamos/solicitudes',
    { status: 403 }, 'POST', { ejemplarId: material.ejemplar });
});

caso(28, 'Alumno DAW1 no puede intercambiar por material DAW2', async env => {
  const ofrecido = await env.crearMaterial(
    env.sesiones.a, 'intercambio', 'Material ofrecido DAW1', 1);
  const solicitado = await env.crearMaterial(
    env.sesiones.e, 'intercambio', 'Material solicitado DAW2', 2);
  await env.esperar(env.sesiones.a, '/api/intercambios',
    { status: 403 }, 'POST', {
      ejemplarOfrecidoId: ofrecido.ejemplar,
      ejemplarSolicitadoId: solicitado.ejemplar,
      confirmoPropuesta: true
    });
});

caso(29, 'Alumno DAW2 puede solicitar cesión de material DAW1', async env => {
  const material = await env.crearMaterial(
    env.sesiones.a, 'cesion', 'Cesión de material DAW1', 1);
  await env.esperar(env.sesiones.e, '/api/solicitudes',
    { status: 201 }, 'POST', { ejemplarId: material.ejemplar });
});

caso(30, 'Alumno DAW2 puede solicitar préstamo de material DAW1', async env => {
  const material = await env.crearMaterial(
    env.sesiones.a, 'prestamo', 'Préstamo de material DAW1', 1);
  await env.esperar(env.sesiones.e, '/api/prestamos/solicitudes',
    { status: 201 }, 'POST', { ejemplarId: material.ejemplar });
});

caso(31, 'Alumno DAW2 puede intercambiar materiales DAW1 con alumno DAW1', async env => {
  const ofrecido = await env.crearMaterial(
    env.sesiones.e, 'intercambio', 'Material DAW1 ofrecido por DAW2', 1);
  const solicitado = await env.crearMaterial(
    env.sesiones.a, 'intercambio', 'Material solicitado DAW1', 1);
  await env.esperar(env.sesiones.e, '/api/intercambios',
    { status: 201 }, 'POST', {
      ejemplarOfrecidoId: ofrecido.ejemplar,
      ejemplarSolicitadoId: solicitado.ejemplar,
      confirmoPropuesta: true
    });
});

caso(32, 'Alumno DAW2 no puede ofrecer material DAW2 a alumno DAW1', async env => {
  const ofrecido = await env.crearMaterial(
    env.sesiones.e, 'intercambio', 'Material ofrecido DAW2', 2);
  const solicitado = await env.crearMaterial(
    env.sesiones.a, 'intercambio', 'Material solicitado DAW1', 1);
  await env.esperar(env.sesiones.e, '/api/intercambios',
    { status: 403 }, 'POST', {
      ejemplarOfrecidoId: ofrecido.ejemplar,
      ejemplarSolicitadoId: solicitado.ejemplar,
      confirmoPropuesta: true
    });
});

