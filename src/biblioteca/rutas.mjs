
/**
 * ============================================================
 * AULA CIRCULAR
 * ÁREA: Biblioteca y Documentos
 * 
 * Gestión de consiltas HTTP del catálogo de Biblioteca.
 *
 * En esta primera versión se implementa:
 * - GET /api/biblioteca
 * - Filtros por curso, categoría y texto.
 * - Paginación y orden estable.
 * - Consultas parametrizadas mediante PostgreSQL.
 *
 * El control de sesiones y roles se incorpora desde
 * src/app.mjs, reutilizando el sistema de cuentas.
 * ============================================================
 */

import { Router } from 'express';
import { obtenerAccionRecurso } from './acciones.mjs';

/**
 * Valida un número entero recibido en los parámetros
 * de la URL y comprueba que esté dentro de un intervalo.
 *
 * No usamos parseInt porque aceptaría entradas parciales
 * como "2abc", que deberían considerarse incorrectas.
 */
function leerEntero(valor, predeterminado, minimo, maximo) {
  if (valor === undefined) {
    return predeterminado;
  }

  if (typeof valor !== 'string' || !/^\d+$/.test(valor)) {
    return null;
  }

  const numero = Number(valor);

  if (!Number.isSafeInteger(numero) ||
      numero < minimo ||
      numero > maximo) {
    return null;
  }

  return numero;
}

/**
 * Crea las rutas de Biblioteca utilizando la conexión
 * compartida con PostgreSQL que recibe del servidor.
 *
 * @param {import('pg').Pool} pool
 * @returns {import('express').Router}
 */
export function crearRutasBiblioteca(pool) {
  const router = Router();

  /**
   * ----------------------------------------------------------
   * GET /api/biblioteca
   *
   * Consulta el catálogo de recursos publicados.
   *
   * Parámetros opcionales:
   * - curso: identificador numérico de un curso.
   * - categoria: identificador numérico de categoría.
   * - q: texto que se busca en título o descripción.
   * - page: número de página, desde 1.
   * - limit: recursos por página, entre 1 y 20.
   *
   * El curso se utiliza exclusivamente como filtro.
   * No limita los materiales que un usuario puede consultar
   * por estar matriculado en un curso diferente.
   * ----------------------------------------------------------
   */
  router.get('/biblioteca', async (req, res, next) => {
    try {
      // 1. Validación de paginación.
      const pagina = leerEntero(req.query.page, 1, 1, 1000000);
      const limite = leerEntero(req.query.limit, 10, 1, 20);

      // 2. Validación de filtros numéricos.
      const curso = req.query.curso === undefined
        ? null
        : leerEntero(req.query.curso, null, 1, 2147483647);

      const categoria = req.query.categoria === undefined
        ? null
        : leerEntero(req.query.categoria, null, 1, 2147483647);

      // 3. Validación del texto de búsqueda.
      const textoValido =
        req.query.q === undefined ||
        (typeof req.query.q === 'string' &&
         req.query.q.trim().length <= 80);

      if (pagina === null ||
          limite === null ||
          (req.query.curso !== undefined && curso === null) ||
          (req.query.categoria !== undefined && categoria === null) ||
          !textoValido) {
        return res.status(400).json({
          error: 'PARAMETROS_INVALIDOS'
        });
      }

      const texto = String(req.query.q ?? '').trim();

      // El desplazamiento indica desde qué fila comienza
      // la página solicitada.
      const desplazamiento = (pagina - 1) * limite;

/**
* CONSULTA PRINCIPAL
*
* 1. El CTE coincidencias reúne los recursos filtrados.
* 2. El CTE recuento calcula el total de esos recursos.
* 3. La consulta final obtiene la página solicitada.
*
* LEFT JOIN LATERAL permite devolver una fila de recuento
* incluso cuando la página solicitada no tiene recursos.
*
* El orden utiliza título e ID para garantizar que dos
* recursos con el mismo título tengan un desempate estable.
*/
const sql = `
WITH coincidencias AS (
  SELECT
    r.id,
    r.titulo,
    r.descripcion,
    r.tipo,
    r.origen,
    r.estado_editorial,
    r.url,
    c.id AS categoria_id,
    c.nombre AS categoria,

    -- Cuenta los ejemplares disponibles del recurso.
    (
      SELECT COUNT(*)::integer
      FROM ejemplar AS e
      WHERE e.recurso_id = r.id
        AND e.estado_servicio = 'disponible'
    ) AS ejemplares_disponibles,

    -- Metadatos descriptivos del documento digital.
    md.formato AS formato_digital,
    md.version_documento AS version_digital,
    md.descarga_disponible

  FROM recurso AS r

  INNER JOIN categoria AS c
    ON c.id = r.categoria_id

  -- Relación opcional: solo los recursos digitales
  -- disponen de metadatos en esta tabla.
  LEFT JOIN metadato_digital AS md
    ON md.recurso_id = r.id

  WHERE r.estado_editorial = 'publicado'
    AND c.activo = true

    -- Filtro opcional por curso sin duplicar recursos.
    AND (
      $1::integer IS NULL
      OR EXISTS (
        SELECT 1
        FROM recurso_curso AS rc
        WHERE rc.recurso_id = r.id
          AND rc.curso_id = $1::integer
      )
    )

    -- Filtro opcional por categoría.
    AND (
      $2::integer IS NULL
      OR r.categoria_id = $2::integer
    )

    -- Búsqueda por título o descripción.
    AND (
      $3::text = ''
      OR r.titulo ILIKE '%' || $3::text || '%'
      OR COALESCE(r.descripcion, '') ILIKE '%' || $3::text || '%'
    )
),
recuento AS (
  SELECT COUNT(*)::integer AS total
  FROM coincidencias
)
SELECT
  recuento.total,
  pagina.id,
  pagina.titulo,
  pagina.descripcion,
  pagina.tipo,
  pagina.origen,
  pagina.estado_editorial,
  pagina.url,
  pagina.categoria_id,
  pagina.categoria,

  -- Información para las acciones según tipo.
  pagina.ejemplares_disponibles,
  pagina.formato_digital,
  pagina.version_digital,
  pagina.descarga_disponible

FROM recuento

LEFT JOIN LATERAL (
  SELECT *
  FROM coincidencias
  ORDER BY titulo ASC, id ASC
  LIMIT $4::integer
  OFFSET $5::integer
) AS pagina ON true
ORDER BY pagina.titulo ASC NULLS LAST,
         pagina.id ASC NULLS LAST
`;

// Parámetros enviados de forma segura a PostgreSQL.
const valores = [
curso,
categoria,
texto,
limite,
desplazamiento
];

// Ejecutamos la consulta contra PostgreSQL.
const resultado = await pool.query(sql, valores);

// El total existe aunque la página solicitada esté vacía.
const total = resultado.rows[0]?.total ?? 0;

/**
 * ============================================================
 * CONSTRUCCIÓN DE LA RESPUESTA DEL CATÁLOGO
 * 
 * Transformar los resultados de PostgreSQL en fichas
 * que incluyan la acción correspondiente a cada tipo.
 *
 * Los campos auxiliares obtenidos mediante SQL se utilizan
 * para calcular las acciones, pero no se devuelven como
 * propiedades independientes de cada ficha.
 *
 * La función obtenerAccionRecurso() diferencia:
 * - Físico: solicitar préstamo.
 * - Digital: descarga pendiente de integración.
 * - Enlace: abrir dirección HTTPS.
 *
 * No se incluyen datos personales de propietarios.
 * ============================================================
 */

const datos = resultado.rows
  // La página vacía produce una fila sin recurso.
  // La excluimos para devolver correctamente datos: [].
  .filter(fila => fila.id !== null)

  // Construimos la ficha pública y su acción.
  .map(({
    total: _total,
    ejemplares_disponibles,
    formato_digital,
    version_digital,
    descarga_disponible,
    ...recurso
  }) => {

    // Preparamos los metadatos del documento digital,
    // si el recurso dispone de ellos.
    const metadatos = recurso.tipo === 'digital'
      ? {
          formato: formato_digital,
          version_documento: version_digital,
          descarga_disponible
        }
      : null;

    // Calculamos la acción correspondiente al tipo.
    const accion = obtenerAccionRecurso(recurso, {
      ejemplaresDisponibles: ejemplares_disponibles,
      metadatos
    });

    // Devolvemos la ficha de catálogo junto a la acción.
    return {
      ...recurso,
      accion
    };
  });


// Respuesta pública del catálogo.
res.json({
datos,
paginacion: {
  pagina,
  limite,
  total
}
});

    } catch (error) {
      next(error);
    }
  });
  
  /**
   * ==========================================================
   * GET /api/biblioteca/:id
   * Obtener el detalle de un recurso publicado junto
   * con sus ejemplares físicos, si existen.
   *
   * VALIDACIONES:
   * - El identificador debe ser un entero positivo.
   * - Un recurso inexistente devuelve HTTP 404.
   * - Un recurso no publicado no es visible.
   *
   * SEGURIDAD:
   * - Consultas SQL parametrizadas.
   * - No se devuelven datos personales de propietarios.
   * - Se reutiliza la autenticación configurada en app.mjs.
   *
   * REGLA DEL MODELO:
   * Los recursos digitales y enlaces no tienen ejemplares.
   * ==========================================================
   */
  router.get('/biblioteca/:id', async (req, res, next) => {
    try {
      // ------------------------------------------------------
      // 1. VALIDAR EL IDENTIFICADOR
      //
      // Evitamos valores negativos, decimales o cadenas
      // que no representen identificadores válidos.
      // ------------------------------------------------------
      const id = leerEntero(req.params.id, null, 1, 2147483647);

      if (id === null) {
        return res.status(400).json({
          error: 'ID_INVALIDO'
        });
      }

      // ------------------------------------------------------
      // 2. CONSULTAR LA FICHA DEL RECURSO
      //
      // La consulta solo devuelve recursos publicados
      // y asociados a categorías activas.
      //
      // El ID se transmite como parámetro SQL ($1).
      // ------------------------------------------------------
      const consultaRecurso = `
        SELECT
          r.id,
          r.titulo,
          r.descripcion,
          r.tipo,
          r.origen,
          r.estado_editorial,
          r.url,
          c.id AS categoria_id,
          c.nombre AS categoria
        FROM recurso AS r
        INNER JOIN categoria AS c
          ON c.id = r.categoria_id
        WHERE r.id = $1
          AND r.estado_editorial = 'publicado'
          AND c.activo = true
      `;

      const resultadoRecurso = await pool.query(
        consultaRecurso,
        [id]
      );

      // Si el recurso no existe o no está publicado,
      // devolvemos una respuesta 404.
      if (resultadoRecurso.rowCount === 0) {
        return res.status(404).json({
          error: 'RECURSO_NO_ENCONTRADO'
        });
      }

      const recurso = resultadoRecurso.rows[0];

      // ------------------------------------------------------
      // 3. CONSULTAR LOS EJEMPLARES FÍSICOS
      //
      // Solo buscamos ejemplares si el recurso es físico.
      //
      // No recuperamos propietario_usuario_id ni información
      // de la tabla usuario para proteger datos personales.
      // ------------------------------------------------------
      let ejemplares = [];

      if (recurso.tipo === 'fisico') {
        const consultaEjemplares = `
          SELECT
            id,
            codigo,
            conservacion,
            estado_servicio
          FROM ejemplar
          WHERE recurso_id = $1
          ORDER BY codigo ASC, id ASC
        `;

        const resultadoEjemplares = await pool.query(
          consultaEjemplares,
          [id]
        );

        ejemplares = resultadoEjemplares.rows;
      }

      // ------------------------------------------------------
      // 4. CONSULTAR LOS CURSOS ASOCIADOS
      //
      // Un recurso puede estar relacionado con varios cursos.
      // No restringimos el acceso al curso del usuario:
      // los cursos son información de clasificación.
      // ------------------------------------------------------
      const consultaCursos = `
        SELECT
          c.id,
          c.codigo,
          c.nombre
        FROM recurso_curso AS rc
        INNER JOIN curso AS c
          ON c.id = rc.curso_id
        WHERE rc.recurso_id = $1
          AND c.activo = true
        ORDER BY c.id ASC
      `;

      const resultadoCursos = await pool.query(
        consultaCursos,
        [id]
      );

     
/**
 * ============================================================
 * ACCIONES EN EL DETALLE DEL RECURSO
 *
 * Incorporar al detalle la acción correspondiente
 * al tipo del recurso consultado.
 *
 * FÍSICO:
 * Contamos los ejemplares disponibles para determinar
 * si se puede mostrar la solicitud de préstamo.
 *
 * DIGITAL:
 * Consultamos sus metadatos descriptivos sin ofrecer
 * todavía una descarga protegida.
 *
 * ENLACE:
 * Utilizamos la URL HTTPS almacenada en el recurso.
 *
 * SEGURIDAD:
 * No se consultan ni devuelven datos personales.
 * ============================================================
 */

// 1. Contamos los ejemplares disponibles del recurso físico.
// Para documentos digitales y enlaces el valor será cero.
const ejemplaresDisponibles = recurso.tipo === 'fisico'
? ejemplares.filter(
    ejemplar => ejemplar.estado_servicio === 'disponible'
  ).length
: 0;

// 2. Consultamos los metadatos únicamente si el recurso
// es digital. No recuperamos archivos ni rutas privadas.
let metadatos = null;

if (recurso.tipo === 'digital') {
const resultadoMetadatos = await pool.query(
  `SELECT
     formato,
     version_documento,
     descarga_disponible
   FROM metadato_digital
   WHERE recurso_id = $1`,
  [id]
);

metadatos = resultadoMetadatos.rows[0] ?? null;
}

// 3. Construimos la acción mediante la función compartida.
// Así aplicamos las mismas reglas que en el listado.
const accion = obtenerAccionRecurso(recurso, {
ejemplaresDisponibles,
metadatos
});

// 4. Devolvemos el detalle completo del catálogo.
//
// Los ejemplares físicos incluyen únicamente su código,
// estado y conservación, nunca información del propietario.
//
// La descarga protegida sigue pendiente de integración.
res.json({
datos: {
  ...recurso,
  cursos: resultadoCursos.rows,
  ejemplares,
  accion
}
});


    } catch (error) {
      // Delegamos los errores inesperados al middleware
      // general de Express definido en app.mjs.
      next(error);
    }
  });

  return router;
}
