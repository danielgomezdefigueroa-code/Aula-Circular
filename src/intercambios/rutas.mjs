import { Router } from 'express';
import { proponerIntercambio, aceptarIntercambio, consultarIntercambio } from './acuerdos.mjs';
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

// CSRF ya se comprueba globalmente en crearAplicacion, antes de montar este router.
export function rutasIntercambios(pool, sesionNecesaria, activaNecesaria) {
  const rutas = Router();
  rutas.use('/intercambios', sesionNecesaria, activaNecesaria, (req, res, next) =>
    req.usuario.roles.includes('alumno') ? next() : res.status(403).json({ error: 'PERMISO_INSUFICIENTE' }));
  const identidad = req => ({ id: req.usuario.id, authVersion: req.session.authVersion });

  rutas.post('/intercambios', manejar(async (req, res) => {
    const b = req.body;
    if (!camposExactos(b, ['ejemplarOfrecidoId', 'ejemplarSolicitadoId', 'confirmoPropuesta']) ||
        !idValido(b.ejemplarOfrecidoId) || !idValido(b.ejemplarSolicitadoId) ||
        b.ejemplarOfrecidoId === b.ejemplarSolicitadoId || b.confirmoPropuesta !== true) {
      return res.status(422).json({ error: 'DATOS_INVALIDOS' });
    }
    res.status(201).json({ datos: await proponerIntercambio(pool, identidad(req), b) });
  }));

  rutas.get('/intercambios/:id', manejar(async (req, res) => {
    const id = Number(req.params.id);
    if (!/^[1-9]\d*$/.test(req.params.id) || !idValido(id)) return res.status(422).json({ error: 'ID_INVALIDO' });
    res.json({ datos: await consultarIntercambio(pool, req.usuario.id, id) });
  }));

  rutas.post('/intercambios/:id/aceptar', manejar(async (req, res) => {
    const id = Number(req.params.id), b = req.body;
    if (!/^[1-9]\d*$/.test(req.params.id) || !idValido(id) ||
        !camposExactos(b, ['ejemplarOfrecidoId', 'ejemplarSolicitadoId', 'versionOfrecida', 'versionSolicitada', 'confirmoAceptacion']) ||
        !['ejemplarOfrecidoId', 'ejemplarSolicitadoId', 'versionOfrecida', 'versionSolicitada'].every(c => idValido(b[c])) ||
        b.confirmoAceptacion !== true) return res.status(422).json({ error: 'DATOS_INVALIDOS' });
    res.json({ datos: await aceptarIntercambio(pool, identidad(req), id, b) });
  }));

  // CSRF se valida globalmente antes de llegar a este router.
  rutas.post(
    '/gestion/intercambios/:id/reservar',
    sesionNecesaria,
    activaNecesaria,
    (req, res, next) => {
      if (!req.usuario.roles.includes('docente')) {
        return res.status(403).json({
          error: 'PERMISO_INSUFICIENTE'
        });
      }

      next();
    },
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
