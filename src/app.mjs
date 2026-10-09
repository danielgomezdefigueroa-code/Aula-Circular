import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import session from 'express-session';
import conectarPg from 'connect-pg-simple';
import { randomBytes } from 'node:crypto';

const { Pool } = pg;


// ============================================================
// CONEXIÓN CON POSTGRESQL
// ============================================================

const pool = new Pool({
  max: 5,
  connectionTimeoutMillis: 3000
});


const app = express();

// Almacenamiento de sesiones en PostgreSQL
const AlmacenPg = conectarPg(session);

// Comprobar que existe una clave de sesión segura
if (!process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32) {
  throw new Error('Falta una clave de sesión local válida');
}

app.disable('x-powered-by');

app.use(express.json({ limit: '32kb' }));

// Configuración de sesiones
app.use(session({
  name: 'aula.sid',
  secret: process.env.SESSION_SECRET,
  store: new AlmacenPg({
    pool,
    createTableIfMissing: true
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

// ============================================================
// LABORATORIO: comprobación de sesión, estado y rol docente.
// ============================================================

function requiereDocente(req, res, next) {
  const cuenta = req.session.cuentaLab;

  if (!cuenta) {
    return res.status(401).json({
      error: 'SESION_REQUERIDA'
    });
  }

  if (cuenta.estado !== 'activo') {
    return res.status(403).json({
      error: 'CUENTA_NO_ACTIVA'
    });
  }

  if (cuenta.rol !== 'docente') {
    return res.status(403).json({
      error: 'PERMISO_INSUFICIENTE'
    });
  }

  next();
}

// Ruta protegida de prueba. No modifica datos.
app.get('/api/lab/zona-docente', requiereDocente, (req, res) => {
  res.status(200).json({
    mensaje: 'Acceso permitido',
    zona: 'docente'
  });
});

// ============================================================
// LABORATORIO: generar token CSRF para la sesión.
// ============================================================

app.get('/api/lab/csrf', (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('hex');
  }

  res.set('Cache-Control', 'no-store');

  res.json({
    csrfToken: req.session.csrfToken
  });
});

// ============================================================
// LABORATORIO: identidades ficticias predefinidas.
// ============================================================

// No utilizar como autenticación de la aplicación definitiva.
// const cuentasLab = {
//   A01: { estado: 'activo', rol: 'alumno' },
//   D01: { estado: 'activo', rol: 'docente' }
// };

const cuentasLab = {
  A01: { estado: 'activo', rol: 'alumno' },
  D01: { estado: 'activo', rol: 'docente' },
  D02: { estado: 'pendiente', rol: 'docente' }
};

// Inicio de sesión exclusivo para pruebas locales.
app.post('/api/lab/acceso', (req, res, next) => {

  // Evitar que esta ruta de laboratorio se utilice en producción.
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({
      error: 'NO_ENCONTRADO'
    });
  }

  // Comprobar el token CSRF asociado a la sesión.
  const token = req.get('X-CSRF-Token');

  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({
      error: 'CSRF_INVALIDO'
    });
  }

  // Solo se acepta un identificador de prueba.
  const datos = req.body ?? {};

  if (Object.keys(datos).length !== 1 ||
      typeof datos.identidad !== 'string' ||
      !Object.hasOwn(cuentasLab, datos.identidad)) {
    return res.status(422).json({
      error: 'IDENTIDAD_INVALIDA'
    });
  }

  // Los permisos proceden del servidor, nunca del navegador.
  const cuenta = cuentasLab[datos.identidad];

  // Regenerar la sesión al iniciar el acceso.
  req.session.regenerate((error) => {
    if (error) return next(error);

    req.session.cuentaLab = { ...cuenta };
    req.session.csrfToken = randomBytes(32).toString('hex');

    req.session.save((errorGuardado) => {
      if (errorGuardado) return next(errorGuardado);

      res.set('Cache-Control', 'no-store');

      res.json({
        mensaje: 'Sesion de laboratorio iniciada',
        identidad: datos.identidad,
        estado: cuenta.estado,
        rol: cuenta.rol
      });
    });
  });
});

// ============================================================
// COMPROBACIÓN DEL ESTADO DEL SERVICIO
// ============================================================

app.get('/api/salud', async (_req, res) => {
  try {

    // Comprobamos que PostgreSQL responde correctamente.
    await pool.query('SELECT 1');

    res.json({
      estado: 'listo',
      baseDatos: true
    });

  } catch {

    // Si la base de datos no responde,
    // devolvemos un error de servicio no disponible.
    res.status(503).json({
      error: 'SERVICIO_NO_DISPONIBLE'
    });
  }
});


// ============================================================
// API DE RECURSOS DE DEMOSTRACIÓN
// ============================================================

// Ruta pública exclusiva de este laboratorio con datos sintéticos.
// En la aplicación se protege con sesión y cuenta activa.
app.get('/api/recursos-demo', async (req, res, next) => {

  try {

    // Recogemos el texto de búsqueda enviado mediante ?q=
    // y eliminamos espacios innecesarios.
    const texto = String(
      req.query.q ?? ''
    ).trim().slice(0, 80);

    // Buscamos recursos cuyo título contenga
    // el texto introducido.
    //
    // También recuperamos el campo "tipo",
    // que contiene la categoría del recurso.
    const resultado = await pool.query(
      'SELECT id, titulo, tipo FROM recurso_demo WHERE titulo ILIKE $1 ORDER BY id',
      ['%' + texto + '%']
    );

    // Devolvemos los resultados en formato JSON.
    res.json({
      datos: resultado.rows
    });

  } catch (error) {

    // En caso de error, dejamos que Express
    // lo gestione mediante el middleware de errores.
    next(error);
  }
});


// ============================================================
// ARCHIVOS PÚBLICOS
// ============================================================

// Servimos los archivos HTML, CSS y JavaScript
// que se encuentran dentro de la carpeta public.
app.use(
  express.static(
    fileURLToPath(new URL('../public/', import.meta.url))
  )
);


// ============================================================
// RUTA 404
// ============================================================

// Si ninguna ruta anterior coincide,
// devolvemos un error de recurso no encontrado.
app.use((_req, res) =>
  res.status(404).json({
    error: 'NO_ENCONTRADO'
  })
);


// ============================================================
// GESTOR DE ERRORES
// ============================================================

app.use((error, _req, res, _next) => {

  // Mostramos en la terminal el código del error.
  console.error(
    'Fallo del laboratorio:',
    error.code ?? 'SIN_CODIGO'
  );

  // Devolvemos un error interno al cliente.
  res.status(500).json({
    error: 'ERROR_INTERNO'
  });
});


// ============================================================
// ARRANQUE DEL SERVIDOR
// ============================================================

const puerto = Number(process.env.PORT ?? 3100);

const servidor = app.listen(
  puerto,
  '127.0.0.1',
  () => {

    console.log(
      `Laboratorio listo en http://127.0.0.1:${puerto}`
    );
  }
);


// ============================================================
// CIERRE DEL SERVIDOR
// ============================================================

process.on('SIGINT', () => {

  // Cerramos el servidor y posteriormente
  // cerramos el pool de conexiones de PostgreSQL.
  servidor.close(async () => {

    await pool.end();

    process.exit(0);
  });
});