// Sesiones persistentes y autorización del Sprint 2.
import session from 'express-session';
import conectarPg from 'connect-pg-simple';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const AlmacenPg = conectarPg(session);
const ochoHoras = 8 * 60 * 60 * 1000;

export function configurarSesiones(app, pool) {
  if ((process.env.SESSION_SECRET?.length ?? 0) < 32) {
    throw new Error('Falta una clave local válida de sesión');
  }

  app.use(session({
    name: 'aula.sid',
    secret: process.env.SESSION_SECRET,
    store: new AlmacenPg({
      pool,
      schemaName: 'public',
      tableName: 'sesion',
      createTableIfMissing: false
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 60 * 1000
    }
  }));
}

export function nuevoTokenCsrf() {
  return randomBytes(32).toString('hex');
}

// Se aplicará antes de las rutas POST/PATCH/DELETE,
// incluidos registro, acceso y salida.
export function requiereCsrf(req, res, next) {
  const enviado = req.get('X-CSRF-Token');
  const guardado = req.session?.csrf;

  if (req.get('Origin') !== process.env.APP_ORIGIN ||
      typeof enviado !== 'string' ||
      typeof guardado !== 'string' ||
      !/^[0-9a-f]{64}$/.test(enviado) ||
      !/^[0-9a-f]{64}$/.test(guardado) ||
      !timingSafeEqual(
        Buffer.from(enviado, 'hex'),
        Buffer.from(guardado, 'hex')
      )) {
    return res.status(403).json({ error: 'CSRF_INVALIDO' });
  }

  next();
}

// Consulta cuenta y roles actuales en cada petición.
// La sesión guarda identidad y versión, nunca privilegios del navegador.
export function requiereSesion(pool) {
  return async (req, res, next) => {
    try {
      const { usuarioId, authVersion, creadaEn } = req.session ?? {};

      if (!Number.isSafeInteger(usuarioId) ||
          !Number.isFinite(creadaEn)) {
        return res.status(401).json({ error: 'SESION_REQUERIDA' });
      }

      if (Date.now() - creadaEn >= ochoHoras) {
        return req.session.destroy(error => {
          if (error) return next(error);
          res.clearCookie('aula.sid', { path: '/' });
          res.status(401).json({ error: 'SESION_CADUCADA' });
        });
      }

      const { rows } = await pool.query(`
        SELECT u.id, u.alias, u.estado, u.auth_version,
               u.curso_confirmado_id,
               ARRAY(
                 SELECT r.rol
                 FROM usuario_rol r
                 WHERE r.usuario_id = u.id
                 ORDER BY r.rol
               ) AS roles
        FROM usuario u
        WHERE u.id = $1
      `, [usuarioId]);

      const usuario = rows[0];

      if (!usuario || usuario.auth_version !== authVersion) {
        return req.session.destroy(error => {
          if (error) return next(error);
          res.clearCookie('aula.sid', { path: '/' });
          res.status(401).json({ error: 'SESION_NO_VALIDA' });
        });
      }

      if (usuario.estado === 'suspendido') {
        return res.status(403).json({ error: 'CUENTA_SUSPENDIDA' });
      }

      req.usuario = usuario;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Una cuenta pendiente podrá consultar /api/yo,
// pero no las rutas que exigen cuenta activa.
export function requiereCuentaActiva(req, res, next) {
  if (!req.usuario) {
    return res.status(401).json({ error: 'SESION_REQUERIDA' });
  }

  if (req.usuario.estado !== 'activo') {
    return res.status(403).json({ error: 'CUENTA_NO_ACTIVA' });
  }

  next();
}

// Admin no implica docente: los roles se conceden explícitamente.
export function requiereRol(...permitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'SESION_REQUERIDA' });
    }

    if (!permitidos.some(rol => req.usuario.roles.includes(rol))) {
      return res.status(403).json({ error: 'PERMISO_INSUFICIENTE' });
    }

    next();
  };
}