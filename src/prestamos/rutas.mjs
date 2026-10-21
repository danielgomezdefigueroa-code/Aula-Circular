import { Router } from 'express';
import { requiereSesion, requiereCuentaActiva, requiereRol, requiereCsrf } from '../cuentas/sesiones.mjs';
import { crearSolicitud, entradaSolicitudValida } from './solicitudes.mjs';
import { asignarSolicitud } from './asignacion.mjs';
import { entregarPrestamo } from './entrega.mjs';

export function crearRutasPrestamos(pool) {
  const router = Router();
  router.post('/solicitudes',
    requiereSesion(pool), requiereCuentaActiva, requiereRol('alumno'), requiereCsrf,
    async (req, res, next) => {
      // No aceptamos solicitanteId: la identidad procede exclusivamente de la sesion.
      if (!entradaSolicitudValida(req.body)) {
        return res.status(422).json({ error: 'DATOS_INVALIDOS' });
      }
      try {
        const resultado = await crearSolicitud(pool,
          { id: req.usuario.id, authVersion: req.session.authVersion }, req.body.ejemplarId);
        res.status(resultado.codigo).json(resultado.cuerpo);
      } catch (error) {
        next(error);
      }
    }
  );
  router.post('/gestion/solicitudes/:id/asignar',
    requiereSesion(pool),
    requiereCuentaActiva,
    requiereRol('docente'),
    requiereCsrf,
    async (req, res, next) => {
      const solicitudId = Number(req.params.id);
      const entrada = req.body;

      // Solo acepta motivo y un vencimiento opcional.
      if (!/^[1-9]\d*$/.test(req.params.id) ||
          !Number.isSafeInteger(solicitudId) ||
          !entrada || typeof entrada !== 'object' ||
          Array.isArray(entrada) ||
          Object.keys(entrada).some(
            campo => !['motivo', 'vencimiento'].includes(campo)
          ) ||
          typeof entrada.motivo !== 'string' ||
          entrada.motivo.trim().length < 1 ||
          entrada.motivo.trim().length > 200 ||
          (Object.hasOwn(entrada, 'vencimiento') &&
            typeof entrada.vencimiento !== 'string')) {
        return res.status(422).json({ error: 'DATOS_INVALIDOS' });
      }

      try {
        const resultado = await asignarSolicitud(
          pool,
          {
            id: req.usuario.id,
            authVersion: req.session.authVersion
          },
          solicitudId,
          {
            motivo: entrada.motivo.trim(),
            vencimiento: entrada.vencimiento
          }
        );

        res.status(resultado.codigo).json(resultado.cuerpo);
      } catch (error) {
        next(error);
      }
    }
  );
  router.post('/gestion/operaciones/:id/entregar',
    requiereSesion(pool),
    requiereCuentaActiva,
    requiereRol('docente'),
    requiereCsrf,
    async (req, res, next) => {
      const operacionId = Number(req.params.id);
      const entrada = req.body;

      if (!/^[1-9]\d*$/.test(req.params.id) ||
          !Number.isSafeInteger(operacionId) ||
          !entrada || typeof entrada !== 'object' ||
          Array.isArray(entrada) ||
          Object.keys(entrada).length !== 1 ||
          typeof entrada.vencimiento !== 'string') {
        return res.status(422).json({ error: 'DATOS_INVALIDOS' });
      }

      try {
        const resultado = await entregarPrestamo(
          pool,
          {
            id: req.usuario.id,
            authVersion: req.session.authVersion
          },
          operacionId,
          { vencimiento: entrada.vencimiento }
        );

        res.status(resultado.codigo).json(resultado.cuerpo);
      } catch (error) {
        next(error);
      }
    }
  );
  return router;
}
