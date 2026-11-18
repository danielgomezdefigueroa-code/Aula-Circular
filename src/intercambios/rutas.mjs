import { Router } from 'express';
import {
  proponerIntercambio, aceptarIntercambio, rechazarIntercambio,
  consultarIntercambio, opcionesIntercambio, listarIntercambios
} from './acuerdos.mjs';
import { reservarIntercambio } from './reservas.mjs';

const idValido = id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
function camposExactos(cuerpo, campos) {
  return cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) &&
    Object.keys(cuerpo).length === campos.length && campos.every(c => Object.hasOwn(cuerpo, c));
}
const manejar = accion => async (req, res, next) => {
  try { await accion(req, res); }
  catch (error) {
    if (error.codigo) return res.status(error.codigo).json({ error: error.message });
    next(error);
  }
};
function paginacion(req) {
  const pagina = Number(req.query.pagina ?? 1);
  const limite = Number(req.query.limite ?? 20);
  if (Object.keys(req.query).some(campo => campo !== 'pagina' && campo !== 'limite') ||
      !idValido(pagina) || pagina > 100000 || !idValido(limite) || limite > 20) {
    return null;
  }
  return { pagina, limite };
}

// CSRF ya se comprueba globalmente en crearAplicacion, antes de montar este router.
export function rutasIntercambios(pool, sesionNecesaria, activaNecesaria) {
  const rutas = Router();
  const identidad = req => ({ id: req.usuario.id, authVersion: req.session.authVersion });
  const alumno = (req, res, next) => req.usuario.roles.includes('alumno')
    ? next() : res.status(403).json({ error: 'PERMISO_INSUFICIENTE' });
  const docente = (req, res, next) => req.usuario.roles.includes('docente')
    ? next() : res.status(403).json({ error: 'PERMISO_INSUFICIENTE' });
  const participanteODocente = (req, res, next) => (
    req.usuario.roles.includes('alumno') || req.usuario.roles.includes('docente')
  ) ? next() : res.status(403).json({ error: 'PERMISO_INSUFICIENTE' });

  // Listado propio. El docente usa /gestion/intercambios, no este listado.
  rutas.get('/intercambios', sesionNecesaria, activaNecesaria, alumno,
    manejar(async (req, res) => {
      const p = paginacion(req);
      if (!p) return res.status(422).json({ error: 'PAGINACION_INVALIDA' });
      res.json({ datos: await listarIntercambios(pool, req.usuario.id, p) });
    }));

  // Opciones para preparar una propuesta. La identidad y la propiedad
  // de los ejemplares las decide el servidor.
  rutas.get('/intercambios/opciones/:ejemplarSolicitadoId',
    sesionNecesaria, activaNecesaria, alumno,
    manejar(async (req, res) => {
      const id = Number(req.params.ejemplarSolicitadoId);
      if (!/^[1-9]\d*$/.test(req.params.ejemplarSolicitadoId) || !idValido(id)) {
        return res.status(422).json({ error: 'ID_INVALIDO' });
      }
      res.json({ datos: await opcionesIntercambio(pool, req.usuario.id, id) });
    }));

  rutas.post('/intercambios', sesionNecesaria, activaNecesaria, alumno, manejar(async (req, res) => {
    const b = req.body;
    if (!camposExactos(b, ['ejemplarOfrecidoId', 'ejemplarSolicitadoId', 'confirmoPropuesta']) ||
        !idValido(b.ejemplarOfrecidoId) || !idValido(b.ejemplarSolicitadoId) ||
        b.ejemplarOfrecidoId === b.ejemplarSolicitadoId || b.confirmoPropuesta !== true) {
      return res.status(422).json({ error: 'DATOS_INVALIDOS' });
    }
    res.status(201).json({ datos: await proponerIntercambio(pool, identidad(req), b) });
  }));

  // El detalle puede consultarlo un participante o un docente que gestiona.
  rutas.get('/intercambios/:id', sesionNecesaria, activaNecesaria, participanteODocente,
    manejar(async (req, res) => {
      const id = Number(req.params.id);
      if (!/^[1-9]\d*$/.test(req.params.id) || !idValido(id)) {
        return res.status(422).json({ error: 'ID_INVALIDO' });
      }
      res.json({
        datos: await consultarIntercambio(
          pool, req.usuario.id, id, req.usuario.roles.includes('docente')
        )
      });
    }));

  rutas.post('/intercambios/:id/aceptar', sesionNecesaria, activaNecesaria, alumno,
    manejar(async (req, res) => {
      const id = Number(req.params.id), b = req.body;
      if (!/^[1-9]\d*$/.test(req.params.id) || !idValido(id) ||
          !camposExactos(b, ['ejemplarOfrecidoId', 'ejemplarSolicitadoId', 'versionOfrecida', 'versionSolicitada', 'confirmoAceptacion']) ||
          !['ejemplarOfrecidoId', 'ejemplarSolicitadoId', 'versionOfrecida', 'versionSolicitada'].every(c => idValido(b[c])) ||
          b.confirmoAceptacion !== true) return res.status(422).json({ error: 'DATOS_INVALIDOS' });
      res.json({ datos: await aceptarIntercambio(pool, identidad(req), id, b) });
    }));

  rutas.post('/intercambios/:id/rechazar', sesionNecesaria, activaNecesaria, alumno,
    manejar(async (req, res) => {
      const id = Number(req.params.id);
      if (!/^[1-9]\d*$/.test(req.params.id) || !idValido(id)) {
        return res.status(422).json({ error: 'ID_INVALIDO' });
      }
      if (!camposExactos(req.body, [])) {
        return res.status(422).json({ error: 'DATOS_INVALIDOS' });
      }
      res.json({ datos: await rechazarIntercambio(pool, identidad(req), id) });
    }));

  // Listado docente para reservar, entregar o cancelar. No acepta estados
  // ni identificadores de participantes desde el cliente.
  rutas.get('/gestion/intercambios', sesionNecesaria, activaNecesaria, docente,
    manejar(async (req, res) => {
      const p = paginacion(req);
      if (!p) return res.status(422).json({ error: 'PAGINACION_INVALIDA' });
      res.json({ datos: await listarIntercambios(pool, req.usuario.id, { ...p, docente: true }) });
    }));

  rutas.post(
    '/gestion/intercambios/:id/reservar',
    sesionNecesaria,
    activaNecesaria,
    docente,
    manejar(async (req, res) => {
      const id = Number(req.params.id);

      if (!/^[1-9]\d*$/.test(req.params.id) || !idValido(id)) {
        return res.status(422).json({ error: 'ID_INVALIDO' });
      }

      // La pareja y los participantes se recuperan de PostgreSQL.
      // El cliente solamente identifica la operación en la ruta.
      if (!camposExactos(req.body, [])) {
        return res.status(422).json({ error: 'DATOS_INVALIDOS' });
      }

      const datos = await reservarIntercambio(
        pool,
        identidad(req),
        id
      );

      res.status(200).json({ datos });
    })
  );

  return rutas;
}
