import { Router } from 'express';

// Catálogo integrado: metadatos y disponibilidad de Biblioteca (T11-T14),
// versiones autorizadas de Documentación (T8) y filtros/paginación de Interfaz.
const TIPOS = new Set(['fisico', 'digital', 'enlace']);

function leerTexto(valor) {
  if (valor === undefined) return '';
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  return texto.length <= 80 ? texto : null;
}

function normalizarBusqueda(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Solo se reciben identificadores SQL fijos definidos en este módulo.
function sinAcentos(columna) {
  return `translate(lower(${columna}), 'áéíóúüñ', 'aeiouun')`;
}

function leerEntero(valor, porDefecto, minimo, maximo) {
  if (valor === undefined || valor === '') return porDefecto;
  if (typeof valor !== 'string' || !/^\d+$/.test(valor)) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= minimo && numero <= maximo
    ? numero
    : null;
}

function leerCurso(valor) {
  if (valor === undefined || valor === '') return { id: null, general: false };
  if (valor === 'general') return { id: null, general: true };
  const id = leerEntero(valor, null, 1, 2147483647);
  return id === null ? null : { id, general: false };
}

function leerDisponible(valor) {
  if (valor === undefined || valor === '' || valor === '0') return false;
  if (valor === '1') return true;
  return null;
}

function parametrosInvalidos(res) {
  return res.status(422).json({ error: 'PARAMETROS_INVALIDOS' });
}

// Un curso retirado del catálogo no puede usarse como filtro: si el valor ya no
// existe o está inactivo, el cliente debe explicarlo en vez de mostrar vacío.
async function cursoActivo(pool, curso) {
  if (!curso || curso.id === null) return true;
  const resultado = await pool.query(
    'SELECT 1 FROM curso WHERE id = $1 AND activo',
    [curso.id]
  );
  return resultado.rowCount > 0;
}

function puedeConsultar(req, res, next) {
  return req.usuario.roles.some((rol) => rol === 'alumno' || rol === 'docente')
    ? next()
    : res.status(403).json({ error: 'PERMISO_INSUFICIENTE' });
}

export function rutasCatalogo(pool, sesionNecesaria, activaNecesaria) {
  const rutas = Router();

  // Listado público para alumnado/docentes autenticados: filtros, inventario y reservas.
  rutas.get(
    '/biblioteca',
    sesionNecesaria,
    activaNecesaria,
    puedeConsultar,
    async (req, res) => {
      const permitidos = ['q', 'tipo', 'curso', 'disponible', 'pagina', 'limite'];
      if (Object.keys(req.query).some((clave) => !permitidos.includes(clave))) {
        return parametrosInvalidos(res);
      }

      const texto = leerTexto(req.query.q);
      const tipo = req.query.tipo ?? '';
      const curso = leerCurso(req.query.curso);
      const disponible = leerDisponible(req.query.disponible);
      const pagina = leerEntero(req.query.pagina, 1, 1, 100000);
      const limite = leerEntero(req.query.limite, 20, 1, 20);

      if (texto === null || (tipo !== '' && !TIPOS.has(tipo)) ||
          curso === null || disponible === null ||
          pagina === null || limite === null) {
        return parametrosInvalidos(res);
      }
      if (!(await cursoActivo(pool, curso))) {
        return res.status(422).json({ error: 'CURSO_NO_DISPONIBLE' });
      }

      const busqueda = normalizarBusqueda(texto);
      const desplazamiento = (pagina - 1) * limite;
      const titulo = sinAcentos('r.titulo');
      const descripcion = sinAcentos("COALESCE(r.descripcion, '')");
      const cursoNombre = sinAcentos("COALESCE(c.nombre, '')");
      const asignatura = sinAcentos("COALESCE(r.asignatura, '')");
      const isbn = sinAcentos("COALESCE(r.isbn, '')");
      const codigoEjemplar = sinAcentos('e.codigo');

      const resultado = await pool.query(
        `WITH coincidencias AS (
          SELECT r.id,
                 'biblioteca' AS seccion,
                 r.titulo,
                 r.tipo,
                 r.edicion,
                 r.asignatura,
                 r.isbn,
                 r.categoria_id AS "categoriaId",
                 ca.nombre AS categoria,
                 ca.activo AS categoria_activa,
                 'Centro educativo' AS procedencia,
                 COALESCE(NULLIF(r.descripcion, ''), 'Recurso del centro.') AS detalle,
                 c.nombre AS curso,
                 CASE WHEN r.tipo = 'enlace' THEN r.descripcion ELSE NULL END AS url_externa,
                 CASE r.tipo
                   WHEN 'fisico' THEN 'prestamo'
                   WHEN 'digital' THEN 'consulta'
                   WHEN 'enlace' THEN 'enlace'
                 END AS modalidad,
                 CASE
                   WHEN r.tipo IN ('digital', 'enlace') THEN 'disponible'
                   WHEN EXISTS (
                     SELECT 1 FROM ejemplar e
                     WHERE e.recurso_id = r.id
                       AND e.estado_servicio = 'habilitado'
                       AND NOT EXISTS (
                         SELECT 1 FROM reserva_activa ra WHERE ra.ejemplar_id = e.id
                       )
                   ) THEN 'disponible'
                   ELSE 'no disponible'
                 END AS estado,
                 (SELECT COUNT(*)::integer
                  FROM ejemplar e WHERE e.recurso_id = r.id) AS total_ejemplares,
                 (SELECT COUNT(*)::integer
                  FROM ejemplar e
                  WHERE e.recurso_id = r.id
                    AND e.estado_servicio = 'habilitado'
                    AND NOT EXISTS (
                      SELECT 1 FROM reserva_activa ra WHERE ra.ejemplar_id = e.id
                    )) AS ejemplares_disponibles,
                 (SELECT COUNT(*)::integer
                  FROM ejemplar e
                  WHERE e.recurso_id = r.id
                    AND e.estado_servicio = 'habilitado') AS ejemplares,
                 COALESCE((
                   SELECT array_agg(e.codigo ORDER BY e.codigo)
                   FROM ejemplar e
                   WHERE e.recurso_id = r.id
                     AND e.estado_servicio = 'habilitado'
                 ), ARRAY[]::text[]) AS codigos,
                 (SELECT MIN(e.codigo)
                  FROM ejemplar e WHERE e.recurso_id = r.id) AS codigo
          FROM recurso r
          LEFT JOIN curso c ON c.id = r.curso_id
          LEFT JOIN categoria ca ON ca.id = r.categoria_id
          WHERE r.origen = 'centro'
            AND (
              $1 = '' OR
              ${titulo} LIKE '%' || $1 || '%' OR
              ${descripcion} LIKE '%' || $1 || '%' OR
              ${cursoNombre} LIKE '%' || $1 || '%' OR
              ${asignatura} LIKE '%' || $1 || '%' OR
              ${isbn} LIKE '%' || $1 || '%' OR
              EXISTS (
                SELECT 1 FROM ejemplar e
                WHERE e.recurso_id = r.id
                  AND ${codigoEjemplar} LIKE '%' || $1 || '%'
              ) OR
              ${sinAcentos("COALESCE(ca.nombre, '')")} LIKE '%' || $1 || '%'
            )
            AND ($2 = '' OR r.tipo = $2)
            AND ($3::integer IS NULL OR r.curso_id = $3)
            AND (NOT $4::boolean OR r.curso_id IS NULL)
            AND (
              NOT $5::boolean OR r.tipo IN ('digital', 'enlace') OR
              EXISTS (
                SELECT 1 FROM ejemplar e
                WHERE e.recurso_id = r.id
                  AND e.estado_servicio = 'habilitado'
                  AND NOT EXISTS (
                    SELECT 1 FROM reserva_activa ra WHERE ra.ejemplar_id = e.id
                  )
              )
            )
        ), recuento AS (
          SELECT COUNT(*)::integer AS total FROM coincidencias
        )
        SELECT recuento.total, pagina.*
        FROM recuento
        LEFT JOIN LATERAL (
          SELECT * FROM coincidencias
          ORDER BY LOWER(titulo), edicion NULLS LAST, id
          LIMIT $6 OFFSET $7
        ) pagina ON true
        ORDER BY LOWER(pagina.titulo) NULLS LAST,
                 pagina.edicion NULLS LAST, pagina.id`,
        [busqueda, tipo, curso.id, curso.general, disponible, limite, desplazamiento]
      );

      const total = resultado.rows[0]?.total ?? 0;
      const datos = resultado.rows
        .filter((fila) => fila.id !== null)
        .map(({ total: _total, ...fila }) => fila);
      res.json({ datos, pagina, limite, total });
    }
  );

  // T13: mantener la ficha individual y sus códigos de respuesta 200/400/404.
  rutas.get(
    '/biblioteca/:id',
    sesionNecesaria,
    activaNecesaria,
    puedeConsultar,
    async (req, res) => {
      const textoId = req.params.id;
      if (!/^[1-9]\d*$/.test(textoId)) {
        return res.status(400).json({ error: 'ID_INVALIDO' });
      }
      const id = Number(textoId);
      if (!Number.isSafeInteger(id) || id > 2147483647) {
        return res.status(400).json({ error: 'ID_INVALIDO' });
      }

      const resultado = await pool.query(
        `SELECT r.id,
                'biblioteca' AS seccion,
                r.titulo, r.tipo, r.descripcion,
                r.asignatura, r.edicion, r.isbn,
                r.curso_id AS "cursoId",
                r.categoria_id AS "categoriaId",
                ca.nombre AS categoria,
                ca.activo AS categoria_activa,
                c.nombre AS curso
         FROM recurso r
         LEFT JOIN curso c ON c.id = r.curso_id
         LEFT JOIN categoria ca ON ca.id = r.categoria_id
         WHERE r.id = $1 AND r.origen = 'centro'`,
        [id]
      );
      if (resultado.rowCount === 0) {
        return res.status(404).json({ error: 'RECURSO_NO_ENCONTRADO' });
      }

      const ejemplares = resultado.rows[0].tipo === 'fisico'
        ? (await pool.query(
          `SELECT e.id, e.codigo, e.estado_servicio,
                  (e.estado_servicio = 'habilitado' AND NOT EXISTS (
                    SELECT 1 FROM reserva_activa ra WHERE ra.ejemplar_id = e.id
                  ) AND NOT EXISTS (
                    SELECT 1
                    FROM operacion_item oi
                    JOIN operacion o ON o.id = oi.operacion_id
                    WHERE oi.ejemplar_id = e.id
                      AND o.estado IN ('reservada','prestada')
                  )) AS disponible,
                  EXISTS (
                    SELECT 1
                    FROM solicitud s
                    WHERE s.ejemplar_id = e.id
                      AND s.solicitante_id = $2
                      AND s.estado = 'pendiente'
                  ) AS solicitud_pendiente
           FROM ejemplar e
           WHERE e.recurso_id = $1
           ORDER BY e.codigo, e.id`,
          [id, req.usuario.id]
        )).rows
        : [];

      return res.status(200).json({
        datos: { ...resultado.rows[0], ejemplares }
      });
    }
  );

  // Documentación: sólo versiones vigentes y publicadas; los filtros nunca
  // pueden ampliar el acceso por curso concedido al usuario autenticado.
  rutas.get(
    '/documentacion',
    sesionNecesaria,
    activaNecesaria,
    puedeConsultar,
    async (req, res) => {
      const permitidos = ['q', 'curso', 'disponible', 'pagina', 'limite'];
      if (Object.keys(req.query).some((clave) => !permitidos.includes(clave))) {
        return parametrosInvalidos(res);
      }

      const texto = leerTexto(req.query.q);
      const curso = leerCurso(req.query.curso);
      const disponible = leerDisponible(req.query.disponible);
      const pagina = leerEntero(req.query.pagina, 1, 1, 100000);
      const limite = leerEntero(req.query.limite, 20, 1, 20);
      if (texto === null || curso === null || disponible === null ||
          pagina === null || limite === null) {
        return parametrosInvalidos(res);
      }
      if (!(await cursoActivo(pool, curso))) {
        return res.status(422).json({ error: 'CURSO_NO_DISPONIBLE' });
      }

      const busqueda = normalizarBusqueda(texto);
      const desplazamiento = (pagina - 1) * limite;
      const titulo = sinAcentos('d.titulo');
      const codigo = sinAcentos('d.codigo');
      const cursoNombre = sinAcentos("COALESCE(c.nombre, '')");
      const propietario = sinAcentos("COALESCE(d.propietario, '')");
      const procedencia = sinAcentos("COALESCE(d.procedencia, '')");
      const esDocente = req.usuario.roles.includes('docente');

      const resultado = await pool.query(
        `WITH coincidencias AS (
          SELECT d.id,
                 'documentacion' AS seccion,
                 'Documentos del centro' AS categoria,
                 d.codigo, d.titulo,
                 d.propietario,
                 d.procedencia,
                 CONCAT_WS(' · ', NULLIF(d.propietario, ''),
                                NULLIF(d.procedencia, '')) AS detalle,
                 c.nombre AS curso,
                 'documento' AS tipo,
                 CASE WHEN a.almacenamiento_privado = true
                      THEN 'descarga' ELSE 'consulta' END AS modalidad,
                 d.estado_editorial AS estado,
                 v.numero_version AS version,
                 v.id AS version_id
          FROM documento d
          LEFT JOIN curso c ON c.id = d.curso_id
          JOIN documento_version v
            ON v.documento_id = d.id
           AND v.actual = true
           AND v.estado_version = 'vigente'
          LEFT JOIN archivo a ON a.id = v.archivo_id
          WHERE d.estado_editorial = 'publicado'
            AND (d.curso_id IS NULL OR d.curso_id = $6 OR $7::boolean)
            AND (
              $1 = '' OR
              ${titulo} LIKE '%' || $1 || '%' OR
              ${codigo} LIKE '%' || $1 || '%' OR
              ${cursoNombre} LIKE '%' || $1 || '%' OR
              ${propietario} LIKE '%' || $1 || '%' OR
              ${procedencia} LIKE '%' || $1 || '%'
            )
            AND ($2::integer IS NULL OR d.curso_id = $2)
            AND (NOT $3::boolean OR d.curso_id IS NULL)
            AND (NOT $4::boolean OR a.almacenamiento_privado = true)
        ), recuento AS (
          SELECT COUNT(*)::integer AS total FROM coincidencias
        )
        SELECT recuento.total, pagina.*
        FROM recuento
        LEFT JOIN LATERAL (
          SELECT * FROM coincidencias
          ORDER BY titulo, id
          LIMIT $5 OFFSET $8
        ) pagina ON true
        ORDER BY pagina.titulo NULLS LAST, pagina.id`,
        [busqueda, curso.id, curso.general, disponible, limite,
          req.usuario.curso_confirmado_id, esDocente, desplazamiento]
      );

      const total = resultado.rows[0]?.total ?? 0;
      const datos = resultado.rows
        .filter((fila) => fila.id !== null)
        .map(({ total: _total, ...fila }) => fila);
      res.json({ datos, pagina, limite, total });
    }
  );

  return rutas;
}
