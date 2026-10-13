import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import {
  configurarSesiones,
  requiereSesion,
  requiereCuentaActiva,
  requiereRol
} from './cuentas/sesiones.mjs';
import { crearRutasCuentas } from './cuentas/rutas.mjs';
import { crearRutasGestion } from './cuentas/gestion.mjs';

const puerto = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
  throw new Error('PORT debe ser un puerto válido');
}

if (process.env.APP_ORIGIN !== `http://127.0.0.1:${puerto}` ||
    process.env.NODE_ENV !== 'development') {
  throw new Error('Configura el origen y el modo development para este ensayo local');
}

const pool = new pg.Pool({
  max: 5,
  connectionTimeoutMillis: 3000
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// Incluye también errores de lectura de JSON y respuestas de salud.
app.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

configurarSesiones(app, pool);

// Espera la preparación del hash ficticio antes de aceptar peticiones.
app.use('/api', await crearRutasCuentas(pool));
app.use('/api/gestion', crearRutasGestion(pool));

app.get('/api/salud', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ estado: 'listo', baseDatos: true });
  } catch {
    res.status(503).json({ error: 'SERVICIO_NO_DISPONIBLE' });
  }
});

// Catálogo protegido: exige identidad, cuenta activa y rol participante.
// Un administrador sin rol alumno/docente no obtiene acceso por ser admin.
app.get('/api/biblioteca',
  requiereSesion(pool),
  requiereCuentaActiva,
  requiereRol('alumno', 'docente'),
  async (req, res, next) => {
    try {
      const texto = String(req.query.q ?? '').trim().slice(0, 80);
      const resultado = await pool.query(
        'SELECT id, titulo, tipo FROM recurso_demo WHERE titulo ILIKE $1 ORDER BY id',
        ['%' + texto + '%']
      );
      res.json({ datos: resultado.rows });
    } catch (error) {
      next(error);
    }
  }
);

app.use(express.static(
  fileURLToPath(new URL('../public/', import.meta.url))
));

app.use((_req, res) => {
  res.status(404).json({ error: 'NO_ENCONTRADO' });
});

app.use((error, _req, res, _next) => {
  // Nunca registra cuerpos, claves, cookies ni consultas SQL.
  console.error('Error del servidor:', error.code ?? 'SIN_CODIGO');

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON_INVALIDO' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'CUERPO_DEMASIADO_GRANDE' });
  }
  if (error.status === 503) {
    return res.status(503).json({ error: 'SERVICIO_OCUPADO' });
  }

  res.status(500).json({ error: 'ERROR_INTERNO' });
});

const servidor = app.listen(puerto, '127.0.0.1', () => {
  console.log(`Sprint2 listo en http://127.0.0.1:${puerto}`);
});

process.on('SIGINT', () => {
  servidor.close(async () => {
    await pool.end();
    process.exit(0);
  });
});