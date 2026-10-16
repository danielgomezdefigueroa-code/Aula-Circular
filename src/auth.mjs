// Rutas de cuenta (tarea 2.2.2): csrf, registro, acceso, salida y yo.
// No importa Express: cada pieza es una función (req, res, next) que se puede probar con objetos simulados.
import {
  comprobarClave, crearHash, generarToken, normalizarCorreo,
  obtenerHashFicticio, tokenCsrfValido, validarRegistro
} from './seguridad.mjs';

const OCHO_HORAS = 8 * 60 * 60 * 1000;
export const NOMBRE_COOKIE = 'aula.sid';

// express-session usa callbacks; aquí se convierten en promesas.
const promesa = (objeto, metodo) => new Promise((resolver, rechazar) =>
  objeto[metodo]((error) => (error ? rechazar(error) : resolver())));

export function crearAuth({ pool, origenPermitido, produccion = false }) {
  const opcionesCookie = { path: '/', httpOnly: true, sameSite: 'lax', secure: produccion };

  async function destruirSesion(req, res) {
    await promesa(req.session, 'destroy');
    res.clearCookie(NOMBRE_COOKIE, opcionesCookie);   // mismo nombre y path que al crearla
  }

  async function cargarRoles(usuarioId) {
    const { rows } = await pool.query('SELECT rol FROM usuario_rol WHERE usuario_id = $1 ORDER BY rol', [usuarioId]);
    return rows.map((fila) => fila.rol);
  }

  // GET /api/csrf — token aleatorio ligado a la sesión. No modifica datos del producto.
  function csrf(req, res) {
    req.session.csrf ??= generarToken();
    res.json({ datos: { csrf: req.session.csrf } });
  }

  // Toda mutación (registro, acceso y salida incluidos) exige token y origen válidos.
  function exigirCsrf(req, res, next) {
    const origen = req.get('Origin');
    if (origen && ![].concat(origenPermitido).includes(origen)) return res.status(403).json({ error: 'ORIGEN_NO_PERMITIDO' });
    if (!tokenCsrfValido(req.session?.csrf, req.get('X-CSRF-Token'))) {
      return res.status(403).json({ error: 'CSRF_INVALIDO' });
    }
    next();
  }

  // POST /api/registro — 202 genérico: no revela si el correo ya existía.
  async function registro(req, res) {
    const campos = validarRegistro(req.body);
    if (campos) return res.status(422).json({ error: 'DATOS_INVALIDOS', campos });

    const curso = await pool.query('SELECT id FROM curso WHERE codigo = $1 AND activo', [req.body.curso.trim()]);
    if (!curso.rows.length) {
      return res.status(422).json({ error: 'DATOS_INVALIDOS', campos: { curso: 'Ese curso no está disponible.' } });
    }
    const hash = await crearHash(req.body.contrasena);   // se calcula siempre: el tiempo no delata correos existentes
    // Una sola sentencia atómica: crea la cuenta pendiente y su rol alumno, o no hace nada si el correo existe.
    await pool.query(
      `WITH nuevo AS (
         INSERT INTO usuario (alias, correo, hash, curso_solicitado_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (correo) DO NOTHING
         RETURNING id)
       INSERT INTO usuario_rol (usuario_id, rol) SELECT id, 'alumno' FROM nuevo`,
      [req.body.alias.trim(), normalizarCorreo(req.body.correo), hash, curso.rows[0].id]
    );
    res.status(202).json({ mensaje: 'Solicitud recibida. Un docente validará tu cuenta.' });
  }

  // POST /api/acceso — mismo mensaje y código para cuenta inexistente y contraseña incorrecta.
  async function acceso(req, res) {
    const correo = typeof req.body?.correo === 'string' ? normalizarCorreo(req.body.correo) : '';
    const clave = typeof req.body?.contrasena === 'string' ? req.body.contrasena : '';
    if (!correo || !clave) {
      return res.status(422).json({ error: 'DATOS_INVALIDOS', campos: { correo: 'Escribe tu correo.', contrasena: 'Escribe tu contraseña.' } });
    }
    const { rows } = await pool.query(
      'SELECT id, alias, hash, estado, auth_version FROM usuario WHERE correo = $1', [correo]);
    const usuario = rows[0];
    const correcta = await comprobarClave(clave, usuario ? usuario.hash : await obtenerHashFicticio());
    if (!usuario || !correcta) return res.status(401).json({ error: 'CREDENCIALES_INVALIDAS' });

    await promesa(req.session, 'regenerate');          // sesión nueva al autenticar
    req.session.usuarioId = usuario.id;
    req.session.authVersion = usuario.auth_version;
    req.session.creadaEn = Date.now();
    req.session.csrf = generarToken();
    await promesa(req.session, 'save');                // se guarda antes de responder
    res.json({ datos: { alias: usuario.alias, estado: usuario.estado, roles: await cargarRoles(usuario.id) } });
  }

  // POST /api/salida
  async function salida(req, res) {
    await destruirSesion(req, res);
    res.status(204).end();
  }

  // Identidad actual consultada en la base en cada petición, no copiada del navegador.
  async function requiereSesion(req, res, next) {
    const s = req.session;
    if (!s?.usuarioId) return res.status(401).json({ error: 'SIN_SESION' });
    if (Date.now() - s.creadaEn > OCHO_HORAS) {
      await destruirSesion(req, res);
      return res.status(401).json({ error: 'SESION_CADUCADA' });
    }
    const { rows } = await pool.query(
      'SELECT id, alias, estado, auth_version FROM usuario WHERE id = $1', [s.usuarioId]);
    const usuario = rows[0];
    if (!usuario || usuario.auth_version !== s.authVersion) {
      await destruirSesion(req, res);
      return res.status(401).json({ error: 'SESION_INVALIDA' });
    }
    req.usuario = { ...usuario, roles: await cargarRoles(usuario.id) };
    next();
  }

  function requiereCuentaActiva(req, res, next) {
    if (req.usuario.estado !== 'activo') return res.status(403).json({ error: 'CUENTA_NO_ACTIVA' });
    next();
  }

  // Un admin sin rol alumno/docente no entra a las áreas por ser admin.
  const requiereRol = (...roles) => (req, res, next) =>
    roles.some((rol) => req.usuario.roles.includes(rol))
      ? next()
      : res.status(403).json({ error: 'PERMISO_INSUFICIENTE' });

  // GET /api/yo — también para cuentas pendientes: explica su estado.
  function yo(req, res) {
    const { alias, estado, roles } = req.usuario;
    res.json({ datos: { alias, estado, roles } });
  }

  return { csrf, exigirCsrf, registro, acceso, salida, requiereSesion, requiereCuentaActiva, requiereRol, yo };
}
