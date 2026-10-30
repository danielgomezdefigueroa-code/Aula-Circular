import { Router } from 'express';

const TIPOS = new Set(['fisico', 'digital', 'enlace']);

function leerTexto(valor) {
  if (valor === undefined) return '';
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  return texto.length <= 80 ? texto : null;
}

function normalizarBusqueda(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Expresión SQL para buscar sin distinguir mayúsculas ni acentos.
// Las columnas que se pasan son siempre nombres fijos de este archivo.
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

function puedeConsultar(req, res, next) {
  return req.usuario.roles.some((rol) => rol === 'alumno' || rol === 'docente')
    ? next()
    : res.status(403).json({ error: 'PERMISO_INSUFICIENTE' });
}

/**
 * Rutas de lectura del catálogo de producto sobre el esquema actual.
 * No sustituyen al futuro módulo completo de Biblioteca: exponen los
 * recursos y documentos ya sembrados para que las páginas no usen los
 * datos retirados de public/local.
 */
export function rutasCatalogo(pool, sesionNecesaria, activaNecesaria) {
  const rutas = Router();

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

      if (texto === null || !TIPOS.has(tipo) && tipo !== '' ||
          curso === null || disponible === null ||
          pagina === null || limite === null) {
        return parametrosInvalidos(res);
      }

      const busqueda = normalizarBusqueda(texto);
      const desplazamiento = (pagina - 1) * limite;
      const titulo = sinAcentos('r.titulo');
      const descripcion = sinAcentos('r.descripcion');
      const cursoNombre = sinAcentos("COALESCE(c.nombre, '')");
      const asignatura = sinAcentos('r.asignatura');
      const isbn = sinAcentos("COALESCE(r.isbn, '')");
      const codigoEjemplar = sinAcentos('e.codigo');

      const resultado = await pool.query(
        `WITH coincidencias AS (
           SELECT r.id,
                  'biblioteca' AS seccion,
                  r.titulo,
                  r.tipo,
                  COALESCE(NULLIF(r.descripcion, ''), 'Recurso del centro.') AS detalle,
                  r.asignatura,
                  r.edicion,
                  r.isbn,
                  c.nombre AS curso,
                  'Centro educativo' AS procedencia,
                  CASE r.tipo
                    WHEN 'fisico' THEN 'prestamo'
                    WHEN 'enlace' THEN 'enlace'
                    ELSE 'digital'
                  END AS modalidad,
                  CASE
                    WHEN r.tipo IN ('digital', 'enlace') THEN 'disponible'
                    WHEN EXISTS (
                      SELECT 1 FROM ejemplar e
                      WHERE e.recurso_id = r.id AND e.estado_servicio = 'habilitado'
                    ) THEN 'disponible'
                    ELSE 'no disponible'
                  END AS estado,
                  COALESCE((
                    SELECT array_agg(e.codigo ORDER BY e.codigo)
                    FROM ejemplar e
                    WHERE e.recurso_id = r.id AND e.estado_servicio = 'habilitado'
                  ), ARRAY[]::text[]) AS codigos,
                  (
                    SELECT count(*)::integer FROM ejemplar e
                    WHERE e.recurso_id = r.id AND e.estado_servicio = 'habilitado'
                  ) AS ejemplares
           FROM recurso r
           LEFT JOIN curso c ON c.id = r.curso_id
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
                 WHERE e.recurso_id = r.id AND ${codigoEjemplar} LIKE '%' || $1 || '%'
               )
             )
             AND ($2 = '' OR r.tipo = $2)
             AND ($3::integer IS NULL OR r.curso_id = $3)
             AND (NOT $4::boolean OR r.curso_id IS NULL)
             AND (
               NOT $5::boolean OR
               r.tipo IN ('digital', 'enlace') OR
               EXISTS (
                 SELECT 1 FROM ejemplar e
                 WHERE e.recurso_id = r.id AND e.estado_servicio = 'habilitado'
               )
             )
         ),
         recuento AS (
           SELECT count(*)::integer AS total FROM coincidencias
         )
         SELECT recuento.total, pagina.*
         FROM recuento
         LEFT JOIN LATERAL (
           SELECT * FROM coincidencias
           ORDER BY titulo ASC, id ASC
           LIMIT $6 OFFSET $7
         ) pagina ON true
         ORDER BY pagina.titulo ASC NULLS LAST, pagina.id ASC NULLS LAST`,
        [busqueda, tipo, curso.id, curso.general, disponible, limite, desplazamiento]
      );

      const total = resultado.rows[0]?.total ?? 0;
      const datos = resultado.rows
        .filter((fila) => fila.id !== null)
        .map(({ total: _total, ...fila }) => ({
          ...fila,
          codigo: Array.isArray(fila.codigos) && fila.codigos.length
            ? fila.codigos[0]
            : null
        }));

      res.json({ datos, pagina, limite, total });
    }
  );

  rutas.get(
    '/documentacion',
    sesionNecesaria,
    activaNecesaria,
    puedeConsultar,
    async (req, res) => {
      const texto = leerTexto(req.query.q);
      if (texto === null) return parametrosInvalidos(res);
      const busqueda = normalizarBusqueda(texto);
      const titulo = sinAcentos('d.titulo');
      const codigo = sinAcentos('d.codigo');
      const resultado = await pool.query(
        `SELECT d.id,
                'documentacion' AS seccion,
                d.codigo,
                d.titulo,
                CONCAT_WS(' · ', NULLIF(d.propietario, ''), NULLIF(d.procedencia, '')) AS detalle,
                d.propietario AS procedencia,
                c.nombre AS curso,
                'documento' AS tipo,
                CASE WHEN v.id IS NOT NULL THEN 'descarga' END AS modalidad,
                CASE WHEN v.id IS NOT NULL THEN 'publicado' ELSE 'no disponible' END AS estado,
                v.numero_version AS version
         FROM documento d
         LEFT JOIN curso c ON c.id = d.curso_id
         LEFT JOIN documento_version v
           ON v.documento_id = d.id AND v.actual
         WHERE $1 = '' OR ${titulo} LIKE '%' || $1 || '%' OR ${codigo} LIKE '%' || $1 || '%'
         ORDER BY d.id
         LIMIT 100`,
        [busqueda]
      );
      res.json({ datos: resultado.rows });
    }
  );

  return rutas;
}
