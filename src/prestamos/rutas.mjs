
import { Router } from 'express';

import {
  solicitarPrestamo,
  adjudicarPrestamo,
  cancelarPrestamo,
  entregarPrestamo,
  devolverPrestamo,
  registrarIncidencia,
  cerrarPorIncidencia
} from './operaciones.mjs';

const idValido = valor =>
  Number.isSafeInteger(valor) &&
  valor > 0 &&
  valor <= 2147483647;

const fallo = (codigo, mensaje) =>
  Object.assign(new Error(mensaje), { codigo });

export function rutasPrestamos(pool, sesionNecesaria, activaNecesaria) {
  const rutas = Router();

  // Todas las operaciones requieren sesión y cuenta activa.
  rutas.use('/gestion/prestamos', sesionNecesaria, activaNecesaria);

  // Únicamente el personal docente puede cambiar estos estados.
  rutas.use('/gestion/prestamos', (req, res, next) => {
    if (!req.usuario.roles.includes('docente')) {
      return res.status(403).json({
        error: 'PERMISO_INSUFICIENTE'
      });
    }

    next();
  });

  const manejar = accion => async (req, res, next) => {
    try {
      await accion(req, res);
    } catch (error) {
      if (error.codigo) {
        return res.status(error.codigo).json({
          error: error.message
        });
      }

      next(error);
    }
  };

  function obtenerId(req) {
    const texto = req.params.id;

    if (!/^[1-9]\d*$/.test(texto)) {
      throw fallo(422, 'ID_INVALIDO');
    }

    const id = Number(texto);

    if (!idValido(id)) {
      throw fallo(422, 'ID_INVALIDO');
    }

    return id;
  }

  function comprobarCuerpo(req, campos) {
    const cuerpo = req.body;

    if (!cuerpo || typeof cuerpo !== 'object' ||
        Array.isArray(cuerpo) ||
        Object.keys(cuerpo).some(c => !campos.includes(c))) {
      throw fallo(422, 'DATOS_INVALIDOS');
    }

    return cuerpo;
  }

  const identidad = req => ({
    id: req.usuario.id,
    authVersion: req.session.authVersion
  });

  // Cancelar préstamo reservado antes de entregarlo.
  rutas.post('/gestion/prestamos/:id/cancelar', manejar(async (req, res) => {
    const id = obtenerId(req);
    const cuerpo = comprobarCuerpo(req, ['motivo']);

    if (typeof cuerpo.motivo !== 'string' ||
        !cuerpo.motivo.trim() ||
        cuerpo.motivo.length > 1000) {
      throw fallo(422, 'MOTIVO_NECESARIO');
    }

    const datos = await cancelarPrestamo(
      pool,
      identidad(req),
      id,
      cuerpo.motivo.trim()
    );

    res.json({ datos });
  }));

  // Confirmar la entrega física de un préstamo reservado.
  rutas.post('/gestion/prestamos/:id/entregar', manejar(async (req, res) => {
    const id = obtenerId(req);
    comprobarCuerpo(req, []);

    const datos = await entregarPrestamo(
      pool,
      identidad(req),
      id
    );

    res.json({ datos });
  }));

  // Registrar la devolución correcta de un préstamo entregado.
  rutas.post('/gestion/prestamos/:id/devolver', manejar(async (req, res) => {
    const id = obtenerId(req);
    const cuerpo = comprobarCuerpo(req, [
  'conservacion',
  'confirmoBuenEstado'
]);

if (cuerpo.confirmoBuenEstado !== true) {
  throw fallo(422, 'CONFIRMACION_BUEN_ESTADO_NECESARIA');
}

    const datos = await devolverPrestamo(
  pool,
  identidad(req),
  id,
  cuerpo.conservacion
);

    res.json({ datos });
  }));


  // Registrar daños o pérdida de un préstamo entregado.
  rutas.post('/gestion/prestamos/:id/incidencias', manejar(async (req, res) => {
    const id = obtenerId(req);
    const cuerpo = comprobarCuerpo(req, ['tipo', 'descripcion']);

    if (
      !['dano', 'perdida'].includes(cuerpo.tipo) ||
      typeof cuerpo.descripcion !== 'string' ||
      !cuerpo.descripcion.trim() ||
      cuerpo.descripcion.trim().length > 1000
    ) {
      throw fallo(422, 'INCIDENCIA_NO_VALIDA');
    }

    const datos = await registrarIncidencia(
      pool,
      identidad(req),
      id,
      cuerpo.tipo,
      cuerpo.descripcion.trim()
    );

    res.status(201).json({ datos });
  }));

  
  // Resolver una incidencia mediante baja definitiva.
  rutas.post('/gestion/prestamos/:id/cerrar-incidencia', manejar(async (req, res) => {
    const id = obtenerId(req);
    const cuerpo = comprobarCuerpo(req, ['resolucion']);

    if (
      typeof cuerpo.resolucion !== 'string' ||
      !cuerpo.resolucion.trim() ||
      cuerpo.resolucion.trim().length > 1000
    ) {
      throw fallo(422, 'RESOLUCION_NO_VALIDA');
    }

    const datos = await cerrarPorIncidencia(
      pool,
      identidad(req),
      id,
      cuerpo.resolucion.trim()
    );

    res.json({ datos });
  }));


  // Un alumno activo solicita un ejemplar físico del centro.
rutas.post('/prestamos/solicitudes',
  sesionNecesaria,
  activaNecesaria,
  manejar(async (req, res) => {

    if (!req.usuario.roles.includes('alumno')) {
      throw fallo(403, 'PERMISO_INSUFICIENTE');
    }

    const cuerpo = comprobarCuerpo(req, ['ejemplarId']);

    if (!idValido(cuerpo.ejemplarId)) {
      throw fallo(422, 'EJEMPLAR_NO_VALIDO');
    }

    const datos = await solicitarPrestamo(
      pool,
      identidad(req),
      cuerpo.ejemplarId
    );

    res.status(201).json({ datos });
  })
);


    // Un docente adjudica una solicitud pendiente.
rutas.post('/gestion/prestamos/solicitudes/:id/adjudicar',
  manejar(async (req, res) => {

    const id = obtenerId(req);

    const cuerpo = comprobarCuerpo(
      req,
      ['motivo', 'vencimiento']
    );

    if (
      typeof cuerpo.motivo !== 'string' ||
      !cuerpo.motivo.trim() ||
      cuerpo.motivo.length > 1000 ||
      typeof cuerpo.vencimiento !== 'string'
    ) {
      throw fallo(422, 'DATOS_INVALIDOS');
    }

    const datos = await adjudicarPrestamo(
      pool,
      identidad(req),
      id,
      cuerpo.motivo.trim(),
      cuerpo.vencimiento
    );

    res.status(201).json({ datos });
  })
);

  return rutas;
}
