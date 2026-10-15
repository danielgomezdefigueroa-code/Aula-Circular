
/**
 * ============================================================
 * AULA CIRCULAR - BIBLIOTECA Y DOCUMENTOS
 * Comprobar mediante peticiones HTTP reales:
 * 1. Listado de Biblioteca sin filtros.
 * 2. Filtro por curso existente.
 * 3. Filtro por curso sin recursos.
 * 4. Filtro por categoría.
 * 5. Filtro por texto.
 * 6. Paginación y orden estable.
 * 7. Rechazo de parámetros incorrectos.
 * 8. Ausencia de datos personales en las respuestas.
 *
 * SEGURIDAD:
 * - Se utiliza una cuenta ficticia activa.
 * - Las credenciales se leen de un archivo local.
 * - No se imprimen contraseñas, cookies ni tokens CSRF.
 * - Las pruebas no modifican recursos de PostgreSQL.
 *
 * REQUISITOS:
 * - Servidor iniciado en http://127.0.0.1:3000
 * - Base de ensayo preparada.
 * - Cuentas ficticias creadas previamente.
 * ============================================================
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Dirección del servidor local de Aula Circular.
const BASE = 'http://127.0.0.1:3000';

// Leemos las credenciales ficticias del archivo privado.
// Este archivo está excluido de Git mediante .gitignore.
const datos = JSON.parse(
  readFileSync('.cuentas-ensayo.json', 'utf8')
);

// Localizamos la cuenta del alumno activo.
const alumno = datos.cuentas.find(
  cuenta => cuenta.alias === 'A01'
);

assert.ok(alumno, 'No existe el alumno ficticio A01');

// Almacenamos las cookies de sesión únicamente en memoria.
const cliente = {
  cookies: new Map(),
  token: null
};

/**
 * ------------------------------------------------------------
 * FUNCIÓN: peticion
 *
 * Realiza una petición HTTP y conserva las cookies de sesión.
 *
 * Las peticiones POST incorporan el token CSRF correspondiente.
 *
 * No imprime credenciales ni cabeceras privadas.
 * ------------------------------------------------------------
 */
async function peticion(metodo, ruta, cuerpo) {
  const headers = {};

  // Adjuntamos las cookies obtenidas en peticiones anteriores.
  if (cliente.cookies.size > 0) {
    headers.Cookie = [...cliente.cookies]
      .map(([nombre, valor]) => `${nombre}=${valor}`)
      .join('; ');
  }

  // Las peticiones que modifican datos requieren cabeceras.
  if (metodo !== 'GET') {
    headers.Origin = BASE;
    headers['Content-Type'] = 'application/json';

    if (cliente.token) {
      headers['X-CSRF-Token'] = cliente.token;
    }
  }

  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers,
    body: cuerpo === undefined
      ? undefined
      : JSON.stringify(cuerpo)
  });

  // Recuperamos las cookies sin mostrarlas en pantalla.
  for (const cabecera of respuesta.headers.getSetCookie()) {
    const pareja = cabecera.split(';')[0];
    const separador = pareja.indexOf('=');

    const nombre = pareja.slice(0, separador);
    const valor = pareja.slice(separador + 1);

    if (valor) {
      cliente.cookies.set(nombre, valor);
    } else {
      cliente.cookies.delete(nombre);
    }
  }

  // Convertimos la respuesta JSON en un objeto JavaScript.
  const texto = await respuesta.text();
  const contenido = texto ? JSON.parse(texto) : null;

  // Guardamos el token CSRF exclusivamente en memoria.
  if (contenido?.token) {
    cliente.token = contenido.token;
  }

  return {
    codigo: respuesta.status,
    contenido
  };
}

/**
 * ------------------------------------------------------------
 * FUNCIÓN: comprobar
 *
 * Comprueba el código HTTP esperado e imprime únicamente
 * un resumen de los resultados de Biblioteca.
 *
 * No imprime datos de autenticación ni sesiones.
 * ------------------------------------------------------------
 */
function comprobar(nombre, ruta, respuesta, esperado) {
  console.log(`\n${nombre}`);
  console.log(`GET ${ruta}`);
  console.log(
    `Esperado: HTTP ${esperado} | Observado: HTTP ${respuesta.codigo}`
  );

  assert.equal(
    respuesta.codigo,
    esperado,
    `Resultado HTTP incorrecto en: ${nombre}`
  );

  // Mostramos los identificadores y títulos del catálogo.
  if (Array.isArray(respuesta.contenido?.datos)) {
    const recursos = respuesta.contenido.datos;

    console.log(
      'Recursos:',
      recursos.map(recurso => ({
        id: recurso.id,
        titulo: recurso.titulo
      }))
    );

    console.log('Paginación:', respuesta.contenido.paginacion);

    // Ninguna ficha debe incluir información personal.
    for (const recurso of recursos) {
      for (const campo of [
        'correo',
        'hash',
        'clave',
        'propietario_usuario_id'
      ]) {
        assert.equal(
          Object.hasOwn(recurso, campo),
          false,
          `El recurso ${recurso.id} expone el campo ${campo}`
        );
      }
    }
  } else {
    // En los errores solo mostramos su identificador público.
    console.log('Error:', respuesta.contenido?.error);
  }
}

/**
 * ------------------------------------------------------------
 * PASO 1: INICIAR SESIÓN COMO ALUMNO ACTIVO
 *
 * Se utiliza la autenticación existente de Aula Circular.
 * Las credenciales nunca se muestran en pantalla.
 * ------------------------------------------------------------
 */

// Primero solicitamos el token CSRF.
const csrf = await peticion('GET', '/api/csrf');
assert.equal(csrf.codigo, 200);

// Después iniciamos sesión con la cuenta ficticia A01.
const acceso = await peticion('POST', '/api/acceso', {
  correo: alumno.correo,
  clave: alumno.clave
});

assert.equal(acceso.codigo, 200);
console.log('Sesión del alumno activo: HTTP 200');

/**
 * ------------------------------------------------------------
 * PASO 2: EJECUTAR LAS PRUEBAS DEL CATÁLOGO
 *
 * Los resultados se almacenan para comprobar tanto los
 * códigos HTTP como los datos de las respuestas.
 * ------------------------------------------------------------
 */

// CASO 1: Listado sin filtros.
// Debe devolver los cuatro recursos publicados del ensayo.
const listado = await peticion('GET', '/api/biblioteca');

comprobar(
  'Caso 1 - Listado sin filtros',
  '/api/biblioteca',
  listado,
  200
);

assert.equal(listado.contenido.datos.length, 4);
// Verificamos que las cuatro fichas esperadas aparecen
// exactamente una vez, independientemente del orden.
assert.deepEqual(
  listado.contenido.datos.map(recurso => recurso.id).sort((a, b) => a - b),
  [1, 2, 3, 4]
);

// CASO 2: Curso DAW-1.
// El curso con ID 1 tiene tres recursos asociados.
const cursoExistente = await peticion(
  'GET',
  '/api/biblioteca?curso=1'
);

comprobar(
  'Caso 2 - Curso existente DAW-1',
  '/api/biblioteca?curso=1',
  cursoExistente,
  200
);

assert.equal(cursoExistente.contenido.datos.length, 3);

// DAW-1 debe contener exactamente estos tres recursos.
// Así evitamos dar por válida una lista con otros IDs.
assert.deepEqual(
  cursoExistente.contenido.datos
    .map(recurso => recurso.id)
    .sort((a, b) => a - b),
  [1, 2, 3]
);
// CASO 3: Curso inexistente.
// El filtro debe devolver una lista vacía.
const cursoVacio = await peticion(
  'GET',
  '/api/biblioteca?curso=999'
);

comprobar(
  'Caso 3 - Curso sin recursos',
  '/api/biblioteca?curso=999',
  cursoVacio,
  200
);

assert.equal(cursoVacio.contenido.datos.length, 0);

// La respuesta debe ser un array vacío y su total cero.
assert.deepEqual(cursoVacio.contenido.datos, []);
assert.equal(cursoVacio.contenido.paginacion.total, 0);

// CASO 4: Categoría Material de estudio.
// En nuestro ensayo tiene ID 1 y dos recursos.
const categoria = await peticion(
  'GET',
  '/api/biblioteca?categoria=1'
);

comprobar(
  'Caso 4 - Filtro por categoría',
  '/api/biblioteca?categoria=1',
  categoria,
  200
);

assert.equal(categoria.contenido.datos.length, 2);

// CASO 5: Búsqueda por texto.
// Debe encontrar el Manual de SQL.
const texto = await peticion(
  'GET',
  '/api/biblioteca?q=Manual'
);

comprobar(
  'Caso 5 - Filtro por texto',
  '/api/biblioteca?q=Manual',
  texto,
  200
);

assert.equal(texto.contenido.datos.length, 1);
assert.equal(texto.contenido.datos[0].titulo, 'Manual de SQL');

// CASO 6: Primera página con dos recursos.
const paginaUno = await peticion(
  'GET',
  '/api/biblioteca?page=1&limit=2'
);

comprobar(
  'Caso 6 - Primera página',
  '/api/biblioteca?page=1&limit=2',
  paginaUno,
  200
);

assert.equal(paginaUno.contenido.datos.length, 2);

// CASO 7: Segunda página con dos recursos.
const paginaDos = await peticion(
  'GET',
  '/api/biblioteca?page=2&limit=2'
);

comprobar(
  'Caso 7 - Segunda página',
  '/api/biblioteca?page=2&limit=2',
  paginaDos,
  200
);

assert.equal(paginaDos.contenido.datos.length, 2);

// Comprobamos que las dos páginas no repiten recursos.
const idsPrimera = new Set(
  paginaUno.contenido.datos.map(recurso => recurso.id)
);

for (const recurso of paginaDos.contenido.datos) {
  assert.equal(
    idsPrimera.has(recurso.id),
    false,
    `Recurso repetido entre páginas: ${recurso.id}`
  );
}

/**
 * ------------------------------------------------------------
 * CASO ADICIONAL: PÁGINA VACÍA
 *
 * OBJETIVO:
 * Comprobar que una página sin resultados devuelve
 * un array vacío, pero conserva el número total
 * de recursos que cumplen los filtros.
 *
 * DATOS:
 * - Existen cuatro recursos publicados.
 * - Cada página admite dos recursos.
 * - La tercera página no debería contener registros.
 *
 * ESPERADO:
 * - HTTP 200.
 * - datos = [].
 * - paginacion.total = 4.
 *
 * Esta prueba detecta un posible error en el cálculo
 * del total cuando OFFSET supera el número de filas.
 * ------------------------------------------------------------
 */

const paginaVacia = await peticion(
    'GET',
    '/api/biblioteca?page=3&limit=2'
  );
  
  comprobar(
    'Caso adicional - Página vacía',
    '/api/biblioteca?page=3&limit=2',
    paginaVacia,
    200
  );
  
  // La tercera página debe estar vacía.
  assert.equal(paginaVacia.contenido.datos.length, 0);
  
  // El total debe seguir indicando los cuatro recursos.
  // Con la implementación actual, esta comprobación
  // probablemente fallará; servirá para justificar
  // la corrección posterior de la consulta.
  assert.equal(paginaVacia.contenido.paginacion.total, 4);

// ------------------------------------------------------------
// CASO 10: DETALLE DEL MANUAL DE SQL
//
// El recurso con ID 1 debe contener dos ejemplares físicos.
// Ambos pertenecen a la misma ficha de catálogo.
// ------------------------------------------------------------

const detalleManual = await peticion(
    'GET',
    '/api/biblioteca/1'
  );
  
  assert.equal(detalleManual.codigo, 200);
  
  const manual = detalleManual.contenido.datos;
  
  assert.equal(manual.id, 1);
  assert.equal(manual.tipo, 'fisico');
  assert.equal(manual.ejemplares.length, 2);
  
  // Verificamos los códigos de los ejemplares.
  const codigosManual = manual.ejemplares.map(
    ejemplar => ejemplar.codigo
  );
  
  assert.deepEqual(codigosManual, [
    'MAN-001',
    'MAN-002'
  ]);
  
  console.log('\nCaso 10 - Detalle del Manual de SQL');
  console.log('Esperado: HTTP 200 | Observado:', detalleManual.codigo);
  console.log('Recurso:', manual.id, manual.titulo);
  console.log('Ejemplares:', codigosManual);
  
  // ------------------------------------------------------------
  // CASO 11: DETALLE DE UN RECURSO DIGITAL
  //
  // La guía digital con ID 3 no debe tener ejemplares.
  // ------------------------------------------------------------
  
  const detalleDigital = await peticion(
    'GET',
    '/api/biblioteca/3'
  );
  
  assert.equal(detalleDigital.codigo, 200);
  
  const digital = detalleDigital.contenido.datos;
  
  assert.equal(digital.tipo, 'digital');
  assert.deepEqual(digital.ejemplares, []);
  
  console.log('\nCaso 11 - Detalle de recurso digital');
  console.log('Esperado: HTTP 200 | Observado:', detalleDigital.codigo);
  console.log('Tipo:', digital.tipo);
  console.log('Ejemplares:', digital.ejemplares.length);
  
  // ------------------------------------------------------------
  // CASO 12: DETALLE DE UN RECURSO INEXISTENTE
  //
  // El recurso 999 no existe en el catálogo de ensayo.
  // La API debe responder con HTTP 404.
  // ------------------------------------------------------------
  
  const detalleInexistente = await peticion(
    'GET',
    '/api/biblioteca/999'
  );
  
  assert.equal(detalleInexistente.codigo, 404);
  assert.equal(
    detalleInexistente.contenido.error,
    'RECURSO_NO_ENCONTRADO'
  );
  
  console.log('\nCaso 12 - Recurso inexistente');
  console.log('Esperado: HTTP 404 | Observado:', detalleInexistente.codigo);
  console.log('Error:', detalleInexistente.contenido.error);
  
  // ------------------------------------------------------------
  // COMPROBACIÓN DE PRIVACIDAD
  //
  // Revisamos que los ejemplares del manual no expongan
  // información personal de sus propietarios.
  // ------------------------------------------------------------
  
  for (const ejemplar of manual.ejemplares) {
    for (const campo of [
      'propietario_usuario_id',
      'correo',
      'alias',
      'hash',
      'clave'
    ]) {
      assert.equal(
        Object.hasOwn(ejemplar, campo),
        false,
        `El ejemplar expone información privada: ${campo}`
      );
    }
  }
  
  console.log('\nPrivacidad de los ejemplares: correcta');

/**
 * ============================================================
 * AULA CIRCULAR - BIBLIOTECA Y DOCUMENTOS
 * PUNTO 3 T4: PRUEBAS DE ACCIONES SEGÚN TIPO
 *
 * Casos 13 a 16
 * 
 * Comprobar que las respuestas del catálogo indican
 * la acción adecuada para recursos físicos, digitales
 * y enlaces.
 *
 * ALCANCE:
 * Solo comprobamos los metadatos de las acciones.
 * No ejecutamos préstamos ni descargas protegidas.
 *
 * SEGURIDAD:
 * No se muestran cookies, contraseñas ni tokens.
 * ============================================================
 */

// ------------------------------------------------------------
// CASO 13: ACCIÓN DE UN RECURSO FÍSICO
//
// El Manual de SQL tiene dos ejemplares disponibles.
// Debe permitir representar la solicitud de préstamo.
// ------------------------------------------------------------

const accionManual = detalleManual.contenido.datos.accion;

assert.equal(accionManual.tipo, 'solicitar_prestamo');
assert.equal(accionManual.habilitada, true);
assert.equal(accionManual.ejemplaresDisponibles, 2);

console.log('\nCaso 13 - Acción del Manual de SQL');
console.log('Esperado: solicitar_prestamo, habilitada, 2 ejemplares');
console.log('Observado:', accionManual);

// ------------------------------------------------------------
// CASO 14: ACCIÓN DE UN RECURSO DIGITAL
//
// La guía tiene metadatos PDF, versión v1.
// Su descarga continúa deshabilitada porque todavía
// no se ha integrado el sistema de archivos protegidos.
// ------------------------------------------------------------

const accionDigital = detalleDigital.contenido.datos.accion;

assert.equal(accionDigital.tipo, 'descargar');
assert.equal(accionDigital.habilitada, false);
assert.equal(accionDigital.descargaDisponible, false);
assert.equal(accionDigital.formato, 'PDF');
assert.equal(accionDigital.version, 'v1');
assert.equal(accionDigital.url, null);

console.log('\nCaso 14 - Acción de la guía digital');
console.log('Esperado: descargar deshabilitada, PDF, v1');
console.log('Observado:', accionDigital);

// ------------------------------------------------------------
// CASO 15: ACCIÓN DE UN RECURSO DE TIPO ENLACE
//
// El recurso 4 contiene la documentación de PostgreSQL.
// Debe ofrecer una URL HTTPS válida.
// ------------------------------------------------------------

const detalleEnlace = await peticion(
  'GET',
  '/api/biblioteca/4'
);

assert.equal(detalleEnlace.codigo, 200);

const accionEnlace = detalleEnlace.contenido.datos.accion;

assert.equal(accionEnlace.tipo, 'abrir_enlace');
assert.equal(accionEnlace.habilitada, true);
assert.equal(
  accionEnlace.url,
  'https://www.postgresql.org/docs/'
);

console.log('\nCaso 15 - Acción de enlace externo');
console.log('Esperado: abrir_enlace habilitada, URL HTTPS');
console.log('Observado:', accionEnlace);

// ------------------------------------------------------------
// CASO 16: COHERENCIA ENTRE LISTADO Y DETALLE
//
// Comprobamos que una misma ficha tenga la misma acción
// tanto en el listado como en su endpoint de detalle.
// ------------------------------------------------------------

for (const detalle of [
  detalleManual,
  detalleDigital,
  detalleEnlace
]) {
  const recursoDetalle = detalle.contenido.datos;

  const recursoListado = listado.contenido.datos.find(
    recurso => recurso.id === recursoDetalle.id
  );

  assert.ok(
    recursoListado,
    `No aparece el recurso ${recursoDetalle.id} en el listado`
  );

  assert.deepEqual(
    recursoListado.accion,
    recursoDetalle.accion,
    `Acción diferente para el recurso ${recursoDetalle.id}`
  );
}

console.log('\nCaso 16 - Acciones de listado y detalle');
console.log('Esperado: acciones equivalentes');
console.log('Observado: acciones equivalentes');


// CASO 8: Límite mayor que veinte.
// La API debe rechazar el parámetro incorrecto.
const limiteInvalido = await peticion(
  'GET',
  '/api/biblioteca?limit=21'
);

comprobar(
  'Caso 8 - Límite superior a veinte',
  '/api/biblioteca?limit=21',
  limiteInvalido,
  400
);

// CASO 9: Página cero.
// Las páginas deben comenzar en uno.
const paginaInvalida = await peticion(
  'GET',
  '/api/biblioteca?page=0'
);

comprobar(
  'Caso 9 - Página inválida',
  '/api/biblioteca?page=0',
  paginaInvalida,
  400
);

/**
 * ------------------------------------------------------------
 * FINALIZACIÓN
 *
 * Cerramos la sesión utilizada durante la prueba para
 * evitar mantener una sesión de ensayo innecesaria.
 * ------------------------------------------------------------
 */

const salida = await peticion('POST', '/api/salida', {});
assert.equal(salida.codigo, 204);

console.log('\nTodas las pruebas de Biblioteca han pasado.');
