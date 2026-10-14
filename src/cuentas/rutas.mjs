import { Router } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { randomBytes, createHash } from 'node:crypto';
import { registrarCuenta } from './registro.mjs';
import { crearHash, comprobarClave, claveValida } from './contraseñas.mjs';
import {
  nuevoTokenCsrf,
  requiereCsrf,
  requiereSesion
} from './sesiones.mjs';

// Limita cálculos costosos simultáneos para no agotar memoria.
let calculosActivos = 0;

async function conLimiteCalculo(operacion) {
  if (calculosActivos >= 2) {
    const error = new Error('Capacidad temporal agotada');
    error.status = 503;
    throw error;
  }

  calculosActivos++;
  try {
    return await operacion();
  } finally {
    calculosActivos--;
  }
}

function correoNormalizado(valor) {
  return typeof valor === 'string' ? valor.trim().toLowerCase() : '';
}

// Función asíncrona: prepara una derivación ficticia una sola vez.
// Permite comprobar una clave aunque el correo no exista.
export async function crearRutasCuentas(pool) {
  const router = Router();
  const hashFicticio = await crearHash(randomBytes(32).toString('hex'));

  const limiteGeneral = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'DEMASIADOS_INTENTOS' }
  });

  const limiteAcceso = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: req => {
      const correo = correoNormalizado(req.body?.correo).slice(0, 254);
      const huella = createHash('sha256').update(correo).digest('hex');
      return ipKeyGenerator(req.ip) + ':' + huella;
    },
    message: { error: 'DEMASIADOS_INTENTOS' }
  });

  // Estos límites viven en memoria: se reinician al reiniciar Node.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  router.get('/csrf', (req, res, next) => {
    req.session.csrf ??= nuevoTokenCsrf();

    req.session.save(error => {
      if (error) return next(error);
      res.json({ token: req.session.csrf });
    });
  });

  router.post('/registro', limiteGeneral, requiereCsrf,
    async (req, res, next) => {
      try {
        const resultado = await conLimiteCalculo(
          () => registrarCuenta(pool, req.body)
        );
        res.status(resultado.codigo).json(resultado.cuerpo);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post('/acceso',
    limiteGeneral, requiereCsrf, limiteAcceso,
    async (req, res, next) => {
      try {
        const correo = correoNormalizado(req.body?.correo);
        const clave = req.body?.clave;
        const campos = Object.keys(req.body ?? {});

        if (!correo || correo.length > 254 || !claveValida(clave) ||
            campos.some(campo => !['correo', 'clave'].includes(campo))) {
          return res.status(401).json({ error: 'CREDENCIALES_INVALIDAS' });
        }

        const { rows } = await pool.query(`
          SELECT id, alias, estado, hash, auth_version
          FROM usuario
          WHERE correo = $1
        `, [correo]);

        const usuario = rows[0];
        const correcta = await conLimiteCalculo(
          () => comprobarClave(clave, usuario?.hash ?? hashFicticio)
        );

        if (!usuario || !correcta) {
          return res.status(401).json({ error: 'CREDENCIALES_INVALIDAS' });
        }

        if (usuario.estado === 'suspendido') {
          return res.status(403).json({ error: 'CUENTA_SUSPENDIDA' });
        }

        // Cambia el identificador de sesión al acceder.
        await new Promise((resolve, reject) => {
          req.session.regenerate(error => error ? reject(error) : resolve());
        });

        req.session.usuarioId = usuario.id;
        req.session.authVersion = usuario.auth_version;
        req.session.creadaEn = Date.now();
        req.session.csrf = nuevoTokenCsrf();

        await new Promise((resolve, reject) => {
          req.session.save(error => error ? reject(error) : resolve());
        });

        // Una cuenta pendiente puede acceder para conocer su estado.
        res.json({
          datos: {
            id: usuario.id,
            alias: usuario.alias,
            estado: usuario.estado
          },
          token: req.session.csrf
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get('/yo', requiereSesion(pool), (req, res) => {
    const { id, alias, estado, roles, curso_confirmado_id } = req.usuario;
    res.json({
      datos: { id, alias, estado, roles, cursoConfirmadoId: curso_confirmado_id }
    });
  });

  router.post('/salida', requiereCsrf, (req, res, next) => {
    req.session.destroy(error => {
      if (error) return next(error);
      res.clearCookie('aula.sid', { path: '/' });
      res.status(204).end();
    });
  });

  return router;
}