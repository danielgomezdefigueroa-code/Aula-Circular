
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
 * ----------------------------------------------------------
 * CONSULTAS SQL PARAMETRIZADAS DEL CATÁLOGO
 *
 * OBJETIVO:
 * Obtener los recursos de la página solicitada y el
 * número total de coincidencias de forma independiente.
 *
 * MOTIVO DE LA CORRECCIÓN:
 * COUNT(*) OVER() no permite recuperar el total cuando
 * OFFSET deja la página sin filas.
 *
 * Utilizamos un CTE (WITH) para aplicar exactamente los
 * mismos filtros al recuento y al listado.
 *
 * SEGURIDAD:
 * Los valores se envían mediante parámetros $1 a $5.
 * No se concatenan entradas del usuario en el SQL.
 * ----------------------------------------------------------
 */

// Filtros comunes para el recuento y el listado.
const filtrosSql = `
FROM recurso AS r
INNER JOIN categoria AS c
  ON c.id = r.categoria_id
WHERE r.estado_editorial = 'publicado'
  AND c.activo = true

  -- Filtrado opcional por curso.
  -- EXISTS evita duplicar recursos asociados a varios cursos.
  AND (
    $1::integer IS NULL
    OR EXISTS (
      SELECT 1
      FROM recurso_curso AS rc
      WHERE rc.recurso_id = r.id
        AND rc.curso_id = $1::integer
    )
  )

  -- Filtrado opcional por categoría.
  AND (
    $2::integer IS NULL
    OR r.categoria_id = $2::integer
  )

  -- Búsqueda de texto en título o descripción.
  AND (
    $3::text = ''
    OR r.titulo ILIKE '%' || $3::text || '%'
    OR COALESCE(r.descripcion, '') ILIKE '%' || $3::text || '%'
  )
`;

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
    c.nombre AS categoria
  ${filtrosSql}
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
  pagina.categoria
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
* Si la página está vacía, el LEFT JOIN devuelve una fila
* cuyo identificador de recurso es NULL.
*
* Por eso excluimos las filas sin recurso antes de generar
* la respuesta JSON.
*
* También eliminamos el campo interno "total", que no
* debe repetirse dentro de cada recurso.
*/
const datos = resultado.rows
.filter(fila => fila.id !== null)
.map(({ total: _total, ...recurso }) => recurso);

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

      // ------------------------------------------------------
      // 5. RESPUESTA DEL DETALLE
      //
      // Agrupamos la ficha general, los cursos y las
      // unidades físicas en una sola respuesta JSON.
      //
      // Para recursos digitales y enlaces, el array de
      // ejemplares será siempre vacío.
      // ------------------------------------------------------
      res.json({
        datos: {
          ...recurso,
          cursos: resultadoCursos.rows,
          ejemplares
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
