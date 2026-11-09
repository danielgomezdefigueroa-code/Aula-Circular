// Revision T10: conserva v2 historica duplicada y permite crear v3 correctiva en el ensayo existente.
// T10 - Carga documental de demostración mediante la API protegida.
// Idempotente en ejecuciones secuenciales: completa borradores y omite versiones existentes.
// Solo para una base de datos local de desarrollo.
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const origen = process.env.APP_ORIGIN;
if (
  process.env.NODE_ENV !== 'development' ||
  !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) ||
  process.env.PGUSER !== 'aula_app' ||
  !process.env.PGDATABASE?.startsWith('aula_circular_') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(origen ?? '')
) {
  throw new Error('T10 solo puede ejecutarse en el laboratorio local de Aula Circular.');
}

const documentos = [
  {
    titulo: 'Guía de inicio del curso', curso: 'DAW1',
    archivos: ['DOC-001_Guia_inicio_curso_v1.pdf', 'DOC-001_Guia_inicio_curso_v2.pdf']
  },
  {
    titulo: 'Listado de materiales', curso: 'DAW2',
    archivos: ['DOC-002_Listado_material_v1.pdf']
  },
  {
    titulo: 'Plantilla de solicitud de material', curso: null,
    archivos: ['DOC-003_Solicitud_material_v1.pdf']
  },
  {
    titulo: 'Normas de uso de la biblioteca', curso: null,
    archivos: ['DOC-004_Normas_uso_biblioteca_v1.pdf']
  },
  {
    titulo: 'Guía de recursos digitales', curso: 'DAW2',
    archivos: ['DOC-005_Guia_recursos_digitales_v1.pdf']
  },
  {
    titulo: 'Apuntes de consulta SQL — material de ensayo', curso: null,
    archivos: ['RD-01_Apuntes_consulta_SQL_v1.pdf']
  }
];

const pool = new pg.Pool({ max: 1, connectionTimeoutMillis: 3000 });
let cookie = '';
let token = null;
let subidas = 0;
let publicaciones = 0;
let omitidas = 0;

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(origen + ruta, {
    ...opciones,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...opciones.headers
    }
  });
  const nuevaCookie = respuesta.headers.get('set-cookie');
  if (nuevaCookie) cookie = nuevaCookie.split(';')[0];
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(`${ruta}: HTTP ${respuesta.status} ${JSON.stringify(cuerpo)}`);
  }
  return cuerpo;
}

async function autenticar() {
  if (token) return;
  const credenciales = JSON.parse(
    await readFile(new URL('../.docente-local.json', import.meta.url), 'utf8')
  );
  const csrf = await api('/api/csrf');
  const acceso = await api('/api/acceso', {
    method: 'POST',
    headers: {
      Origin: origen,
      'X-CSRF-Token': csrf.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      correo: credenciales.correo,
      clave: credenciales.clave
    })
  });
  token = acceso.token;
  if (!token) throw new Error('No se recibió el token de la sesión docente.');
}

async function escribir(ruta, method, body) {
  await autenticar();
  return api(ruta, {
    method,
    headers: { Origin: origen, 'X-CSRF-Token': token },
    ...(body ? { body } : {})
  });
}

function formularioArchivo(nombre, bytes) {
  const formulario = new FormData();
  formulario.append('archivo', new Blob([bytes], { type: 'application/pdf' }), nombre);
  return formulario;
}

async function versiones(documentoId) {
  const resultado = await pool.query(`
    SELECT v.id AS version_id, v.numero_version, v.estado_version,
           v.actual, a.sha256, a.almacenamiento_privado
    FROM documento_version v
    JOIN archivo a ON a.id = v.archivo_id
    WHERE v.documento_id = $1
    ORDER BY v.numero_version
  `, [documentoId]);
  return resultado.rows;
}


function actualesLegadosValidos(existentes, fuentes) {
  if (fuentes.length !== 2 || ![2, 3].includes(existentes.length)) return false;
  const primera = existentes.find(v => v.numero_version === 1);
  const segunda = existentes.find(v => v.numero_version === 2);
  const tercera = existentes.find(v => v.numero_version === 3);
  if (
    !primera?.almacenamiento_privado ||
    !segunda?.almacenamiento_privado ||
    primera.sha256 !== fuentes[0].sha256 ||
    segunda.sha256 !== primera.sha256 ||
    primera.estado_version !== 'historica'
  ) return false;
  // Antes de la corrección, la v2 es vigente. Durante o después, es histórica.
  if (tercera) {
    return segunda.estado_version === 'historica' ||
      (segunda.estado_version === 'vigente' && tercera.estado_version === 'borrador');
  }
  return segunda.estado_version === 'vigente' && segunda.actual === true;
}

async function procesar(documento) {
  let cursoId = null;
  if (documento.curso) {
    const curso = await pool.query(
      'SELECT id FROM curso WHERE codigo = $1 AND activo = true',
      [documento.curso]
    );
    if (curso.rowCount !== 1) throw new Error(`Falta el curso ${documento.curso}.`);
    cursoId = curso.rows[0].id;
  }

  const resultado = await pool.query(`
    SELECT id, estado_editorial FROM documento
    WHERE titulo = $1 AND curso_id IS NOT DISTINCT FROM $2::integer
  `, [documento.titulo, cursoId]);
  if (resultado.rowCount > 1) {
    throw new Error(`Hay documentos duplicados: ${documento.titulo}.`);
  }

  let documentoId = resultado.rows[0]?.id ?? null;
  if (resultado.rows[0]?.estado_editorial === 'retirado') {
    throw new Error(`El documento está retirado: ${documento.titulo}.`);
  }

  // Validamos todos los PDF de origen antes de intentar publicar nada.
  const fuentes = await Promise.all(documento.archivos.map(async (nombre) => {
    const bytes = await readFile(new URL(`../documentos/${nombre}`, import.meta.url));
    return {
      nombre,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex')
    };
  }));

  let correccionHistorica = false;

  for (const [indice, fuente] of fuentes.entries()) {
    const numero = indice + 1;

    if (documentoId === null) {
      const formulario = formularioArchivo(fuente.nombre, fuente.bytes);
      formulario.append('titulo', documento.titulo);
      formulario.append('cursoId', cursoId === null ? '' : String(cursoId));
      formulario.append('version', 'v1');
      const alta = await escribir('/api/documentos', 'POST', formulario);
      documentoId = alta.datos.documentoId;
      subidas++;
      console.log(`Creado borrador: ${documento.titulo} (ID ${documentoId}).`);
    }

    let existentes = await versiones(documentoId);
    let actual = existentes.find(v => v.numero_version === numero);

    if (!actual && numero === 1) {
      throw new Error(`El documento ${documentoId} existe sin su v1: revisión manual necesaria.`);
    }
    if (!actual) {
      const alta = await escribir(
        `/api/documentos/${documentoId}/versiones`,
        'POST', formularioArchivo(fuente.nombre, fuente.bytes)
      );
      subidas++;
      console.log(`Creado borrador v${numero}: ${documento.titulo}.`);
      existentes = await versiones(documentoId);
      actual = existentes.find(v => v.version_id === alta.datos.versionId);
    }

    // Caso excepcional confirmado en la base de ensayo T10:
    // DOC-001 v1 y v2 se publicaron con el mismo contenido. El PDF
    // realmente diferente (fuente local v2) debe subirse como v3;
    // NUNCA sustituimos la huella ni el archivo de la v2 publicada.
    if (
      documento.titulo === 'Guía de inicio del curso' &&
      numero === 2 &&
      actual?.sha256 !== fuente.sha256 &&
      actualesLegadosValidos(existentes, fuentes)
    ) {
      correccionHistorica = true;
      let tercera = existentes.find(v => v.numero_version === 3);
      if (!tercera) {
        const alta = await escribir(
          `/api/documentos/${documentoId}/versiones`,
          'POST',
          formularioArchivo('DOC-001_Guia_inicio_curso_v3.pdf', fuente.bytes)
        );
        subidas++;
        existentes = await versiones(documentoId);
        tercera = existentes.find(v => v.version_id === alta.datos.versionId);
        console.log('Registrada v3 correctiva; v1 y v2 quedan preservadas.');
      }
      if (!tercera || !tercera.almacenamiento_privado || tercera.sha256 !== fuente.sha256) {
        throw new Error('La v3 correctiva no coincide con el PDF local. No se modifica nada.');
      }
      if (tercera.estado_version === 'borrador') {
        await escribir(
          `/api/documentos/${documentoId}/versiones/${tercera.version_id}/publicar`,
          'PATCH'
        );
        publicaciones++;
        console.log('Publicada v3 correctiva: Guía de inicio del curso.');
      } else if (tercera.estado_version === 'vigente' && tercera.actual === true) {
        omitidas++;
        console.log('V3 correctiva ya vigente; no se duplica.');
      } else {
        throw new Error(`La v3 correctiva presenta un estado inesperado: ${tercera.estado_version}.`);
      }
      continue;
    }

    if (!actual || !actual.almacenamiento_privado || actual.sha256 !== fuente.sha256) {
      throw new Error(`Archivo/huella no coincidente en ${documento.titulo} v${numero}.`);
    }

    if (actual.estado_version === 'borrador') {
      const ruta = numero === 1
        ? `/api/documentos/${documentoId}/publicar`
        : `/api/documentos/${documentoId}/versiones/${actual.version_id}/publicar`;
      await escribir(ruta, 'PATCH');
      publicaciones++;
      console.log(`Publicada v${numero}: ${documento.titulo}.`);
    } else if (['vigente', 'historica'].includes(actual.estado_version)) {
      omitidas++;
    } else {
      throw new Error(`Estado de versión inesperado: ${actual.estado_version}.`);
    }
  }

  const finales = await versiones(documentoId);
  const esperadas = correccionHistorica
    ? [fuentes[0].sha256, fuentes[0].sha256, fuentes[1].sha256]
    : fuentes.map(f => f.sha256);
  if (
    finales.length !== esperadas.length ||
    finales.some((v, i) =>
      v.numero_version !== i + 1 ||
      !v.almacenamiento_privado ||
      v.sha256 !== esperadas[i] ||
      v.estado_version !== (i === finales.length - 1 ? 'vigente' : 'historica') ||
      v.actual !== (i === finales.length - 1)
    )
  ) {
    throw new Error(`Estado final de versiones inesperado: ${documento.titulo}.`);
  }
  const estado = await pool.query('SELECT estado_editorial FROM documento WHERE id = $1', [documentoId]);
  if (estado.rows[0]?.estado_editorial !== 'publicado') {
    throw new Error(`Documento no publicado: ${documento.titulo}.`);
  }
  console.log(`OK: ${documento.titulo} (${finales.length} versión/es).`);
}

try {
  for (const documento of documentos) await procesar(documento);
  console.log(`Carga documental T10 completada. Nuevas versiones: ${subidas}. Publicaciones: ${publicaciones}. Versiones omitidas: ${omitidas}.`);
} catch (error) {
  console.error('Carga T10 interrumpida:', error.message);
  console.error('Revisa los registros antes de repetir. No se han borrado documentos existentes.');
  process.exitCode = 1;
} finally {
  await pool.end();
}

