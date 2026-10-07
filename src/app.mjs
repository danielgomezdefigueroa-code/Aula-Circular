import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;


// ============================================================
// CONEXIÓN CON POSTGRESQL
// ============================================================

const pool = new Pool({
  max: 5,
  connectionTimeoutMillis: 3000
});


const app = express();

app.disable('x-powered-by');

app.use(express.json({ limit: '32kb' }));


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