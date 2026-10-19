import { Router } from 'express';
import { requiereSesion, requiereCuentaActiva, requiereRol, requiereCsrf } from '../cuentas/sesiones.mjs';
import { crearSolicitud, entradaSolicitudValida } from './solicitudes.mjs';

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
  return router;
}
