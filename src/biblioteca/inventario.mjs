import { Router } from 'express';

const enteroPositivo = valor => Number.isSafeInteger(valor) && valor > 0;
const objeto = valor => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
const texto = (valor, min, max) =>
  typeof valor === 'string' && valor.trim().length >= min && valor.trim().length <= max;
const codigoNormalizado = valor =>
  typeof valor === 'string' ? valor.trim().toUpperCase() : '';
const codigoValido = valor => /^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(valor);

function fallo(estado, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { estadoHttp: estado, codigoPublico: codigo });
}

function validarMetadatos(cuerpo, adicionales = []) {
  const permitidos = [
    'titulo', 'descripcion', 'tipo', 'cursoId', 'categoriaId',
    'asignatura', 'edicion', 'isbn', ...adicionales
  ];
  if (!objeto(cuerpo) || Object.keys(cuerpo).some(campo => !permitidos.includes(campo))) {
    throw fallo(422, 'DATOS_INVALIDOS', 'La ficha contiene campos no admitidos.');
  }
  if (!['fisico', 'digital', 'enlace'].includes(cuerpo.tipo)) {
    throw fallo(422, 'TIPO_INVALIDO', 'Selecciona un tipo de recurso válido.');
  }
  if (!texto(cuerpo.titulo, 1, 120) || !texto(cuerpo.asignatura, 1, 100) ||
      !texto(cuerpo.edicion, 1, 100) ||
      (cuerpo.descripcion !== undefined && !texto(cuerpo.descripcion, 0, 2000))) {
    throw fallo(422, 'DATOS_INVALIDOS', 'Revisa el título, la asignatura, la edición y la descripción.');
  }
  if (!enteroPositivo(cuerpo.cursoId) || !enteroPositivo(cuerpo.categoriaId)) {
    throw fallo(422, 'DATOS_INVALIDOS', 'Selecciona un curso y una categoría válidos.');
  }
  if (typeof (cuerpo.isbn ?? '') !== 'string') {
    throw fallo(422, 'ISBN_INVALIDO', 'Introduce un ISBN válido o deja el campo vacío.');
  }
  const isbn = (cuerpo.isbn ?? '').trim();
  if (isbn !== '' && !/^[0-9Xx -]{10,25}$/.test(isbn)) {
    throw fallo(422, 'ISBN_INVALIDO', 'Introduce un ISBN válido o deja el campo vacío.');
  }
  if (cuerpo.tipo === 'enlace') {
    try {
      if (new URL(cuerpo.descripcion ?? '').protocol !== 'https:') throw new Error();
    } catch {
      throw fallo(422, 'ENLACE_INVALIDO', 'El enlace debe ser una URL HTTPS válida.');
    }
  }
  return {
    titulo: cuerpo.titulo.trim(), descripcion: (cuerpo.descripcion ?? '').trim(),
    tipo: cuerpo.tipo, cursoId: cuerpo.cursoId, categoriaId: cuerpo.categoriaId,
    asignatura: cuerpo.asignatura.trim(), edicion: cuerpo.edicion.trim(),
    isbn: isbn || null
  };
}

function validarEjemplar(cuerpo) {
  if (!objeto(cuerpo) || Object.keys(cuerpo).some(c => !['codigo', 'conservacion'].includes(c))) {
    throw fallo(422, 'DATOS_INVALIDOS', 'El ejemplar solo admite código y conservación.');
  }
  const codigo = codigoNormalizado(cuerpo.codigo);
  if (!codigoValido(codigo) || !texto(cuerpo.conservacion, 1, 500)) {
    throw fallo(422, 'EJEMPLAR_INVALIDO', 'Revisa el código y el estado de conservación.');
  }
  return { codigo, conservacion: cuerpo.conservacion.trim() };
}

function validarFicha(cuerpo) {
  const d = validarMetadatos(cuerpo, ['codigo', 'conservacion']);
  if (d.tipo === 'fisico') {
    return {...d, ...validarEjemplar({codigo: cuerpo.codigo, conservacion: cuerpo.conservacion})};
  }
  if (cuerpo.codigo !== undefined || cuerpo.conservacion !== undefined) {
    throw fallo(422, 'EJEMPLAR_NO_PERMITIDO', 'Un recurso digital o un enlace no tiene ejemplares físicos.');
  }
  return d;
}

function leerId(valor) {
  if (typeof valor !== 'string' || !/^[1-9]\d*$/.test(valor) || Number(valor) > 2147483647) {
    throw fallo(400, 'ID_INVALIDO', 'El identificador no es válido.');
  }
  return Number(valor);
}

async function transaccion(pool, accion) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const datos = await accion(cliente);
    await cliente.query('COMMIT');
    return datos;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
}

async function comprobarDocente(cliente, req) {
  const resultado = await cliente.query(`
    SELECT u.id FROM usuario u
    WHERE u.id = $1 AND u.estado = 'activo' AND u.auth_version = $2
      AND EXISTS (SELECT 1 FROM usuario_rol ur
                  WHERE ur.usuario_id = u.id AND ur.rol = 'docente')
    FOR SHARE OF u`, [req.usuario.id, req.session.authVersion]);
  if (!resultado.rowCount) {
    throw fallo(403, 'PERMISO_INSUFICIENTE', 'Necesitas una cuenta docente activa.');
  }
}

async function comprobarReferencias(cliente, cursoId, categoriaId) {
  const curso = await cliente.query(
    'SELECT id FROM curso WHERE id = $1 AND activo = true FOR SHARE', [cursoId]);
  if (!curso.rowCount) throw fallo(422, 'CURSO_INACTIVO', 'Selecciona un curso activo.');
  const categoria = await cliente.query(
    "SELECT id FROM categoria WHERE id = $1 AND activo = true AND ambito = 'biblioteca' FOR SHARE",
    [categoriaId]);
  if (!categoria.rowCount) {
    throw fallo(422, 'CATEGORIA_INVALIDA', 'Selecciona una categoría activa de Biblioteca.');
  }
}

function manejar(accion) {
  return async (req, res, next) => {
    try {
      await accion(req, res);
    } catch (error) {
      if (error.estadoHttp) {
        return res.status(error.estadoHttp).json({error: error.codigoPublico, mensaje: error.message});
      }
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'CODIGO_DUPLICADO', mensaje: 'Ya existe un ejemplar con ese código.'
        });
      }
      if (error.code === '23514') {
        return res.status(422).json({error: 'DATOS_INVALIDOS', mensaje: 'La operación incumple las reglas del catálogo.'});
      }
      next(error);
    }
  };
}

export function rutasInventario(pool, sesionNecesaria, activaNecesaria) {
  const rutas = Router();
  const docente = (req, res, next) => req.usuario.roles.includes('docente')
    ? next() : res.status(403).json({error: 'PERMISO_DOCENTE_NECESARIO'});
  const proteger = [sesionNecesaria, activaNecesaria, docente];

  rutas.get('/gestion/biblioteca/categorias', ...proteger, manejar(async (_req, res) => {
    const resultado = await pool.query(
      "SELECT id, nombre, ambito, activo FROM categoria WHERE ambito='biblioteca' ORDER BY id");
    res.json({datos: resultado.rows});
  }));

  rutas.post('/gestion/biblioteca/recursos', ...proteger, manejar(async (req, res) => {
    const d = validarFicha(req.body);
    const datos = await transaccion(pool, async cliente => {
      await comprobarDocente(cliente, req);
      await comprobarReferencias(cliente, d.cursoId, d.categoriaId);
      const recurso = await cliente.query(`
        INSERT INTO recurso
          (origen, tipo, titulo, descripcion, curso_id, asignatura, edicion, isbn, categoria_id)
        VALUES ('centro', $1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [d.tipo, d.titulo, d.descripcion, d.cursoId, d.asignatura, d.edicion, d.isbn, d.categoriaId]);
      let ejemplarId = null;
      if (d.tipo === 'fisico') {
        const ejemplar = await cliente.query(`
          INSERT INTO ejemplar (recurso_id, codigo, propietario_usuario_id, conservacion, estado_servicio)
          VALUES ($1, $2, NULL, $3, 'habilitado') RETURNING id`,
          [recurso.rows[0].id, d.codigo, d.conservacion]);
        ejemplarId = ejemplar.rows[0].id;
      }
      return {id: recurso.rows[0].id, ejemplarId};
    });
    res.status(201).json({datos, mensaje: 'Recurso creado correctamente.'});
  }));

  rutas.post('/gestion/biblioteca/recursos/:id/ejemplares', ...proteger, manejar(async (req, res) => {
    const id = leerId(req.params.id);
    const d = validarEjemplar(req.body);
    const datos = await transaccion(pool, async cliente => {
      await comprobarDocente(cliente, req);
      const recurso = await cliente.query(
        'SELECT id, origen, tipo, curso_id, categoria_id FROM recurso WHERE id=$1 FOR SHARE',
        [id]);
      if (!recurso.rowCount) throw fallo(404, 'RECURSO_NO_ENCONTRADO', 'No existe el recurso.');
      const r = recurso.rows[0];
      if (r.origen !== 'centro' || r.tipo !== 'fisico') {
        throw fallo(422, 'RECURSO_NO_FISICO', 'Solo se pueden añadir ejemplares a recursos físicos del centro.');
      }
      await comprobarReferencias(cliente, r.curso_id, r.categoria_id);
      const ejemplar = await cliente.query(`
        INSERT INTO ejemplar (recurso_id, codigo, propietario_usuario_id, conservacion, estado_servicio)
        VALUES ($1, $2, NULL, $3, 'habilitado') RETURNING id, codigo`,
        [r.id, d.codigo, d.conservacion]);
      return ejemplar.rows[0];
    });
    res.status(201).json({datos, mensaje: 'Ejemplar añadido correctamente.'});
  }));

  // Edición completa de metadatos. La ficha existente nunca se sustituye
  // por una nueva: conserva su ID y sus referencias históricas.
  rutas.patch('/gestion/biblioteca/recursos/:id', ...proteger, manejar(async (req, res) => {
    const id = leerId(req.params.id);
    const d = validarMetadatos(req.body);
    const datos = await transaccion(pool, async cliente => {
      await comprobarDocente(cliente, req);
      const actual = await cliente.query(
        "SELECT id, tipo FROM recurso WHERE id=$1 AND origen='centro' FOR UPDATE", [id]);
      if (!actual.rowCount) throw fallo(404, 'RECURSO_NO_ENCONTRADO', 'No existe el recurso del centro.');
      await comprobarReferencias(cliente, d.cursoId, d.categoriaId);
      const actualizado = await cliente.query(`
        UPDATE recurso SET tipo=$1, titulo=$2, descripcion=$3, curso_id=$4,
          asignatura=$5, edicion=$6, isbn=$7, categoria_id=$8
        WHERE id=$9 RETURNING id, titulo, edicion, tipo, categoria_id`,
        [d.tipo, d.titulo, d.descripcion, d.cursoId, d.asignatura,
         d.edicion, d.isbn, d.categoriaId, id]);
      return actualizado.rows[0];
    });
    res.json({datos, mensaje: 'Ficha actualizada correctamente.'});
  }));

  rutas.patch('/gestion/biblioteca/ejemplares/:id', ...proteger, manejar(async (req, res) => {
    const id = leerId(req.params.id);
    const d = validarEjemplar(req.body);
    const datos = await transaccion(pool, async cliente => {
      await comprobarDocente(cliente, req);
      const actual = await cliente.query(`
        SELECT e.id FROM ejemplar e
        JOIN recurso r ON r.id=e.recurso_id
        WHERE e.id=$1 AND r.origen='centro' FOR UPDATE OF e`, [id]);
      if (!actual.rowCount) throw fallo(404, 'EJEMPLAR_NO_ENCONTRADO', 'No existe el ejemplar del centro.');
      const actualizado = await cliente.query(`
        UPDATE ejemplar SET codigo=$1, conservacion=$2
        WHERE id=$3 RETURNING id, codigo, conservacion`,
        [d.codigo, d.conservacion, id]);
      return actualizado.rows[0];
    });
    res.json({datos, mensaje: 'Ejemplar actualizado correctamente.'});
  }));

  rutas.patch('/gestion/biblioteca/categorias/:id', ...proteger, manejar(async (req, res) => {
    const id = leerId(req.params.id);
    if (!objeto(req.body) || Object.keys(req.body).length !== 1 ||
        typeof req.body.activo !== 'boolean') {
      throw fallo(422, 'DATOS_INVALIDOS', 'Indica activo: true o false.');
    }
    const datos = await transaccion(pool, async cliente => {
      await comprobarDocente(cliente, req);
      const resultado = await cliente.query(`
        UPDATE categoria SET activo=$1 WHERE id=$2 AND ambito='biblioteca'
        RETURNING id, nombre, activo`, [req.body.activo, id]);
      if (!resultado.rowCount) throw fallo(404, 'CATEGORIA_NO_ENCONTRADA', 'No existe la categoría.');
      return resultado.rows[0];
    });
    res.json({datos, mensaje: 'Estado de categoría actualizado; las referencias antiguas se conservan.'});
  }));

  return rutas;
}
