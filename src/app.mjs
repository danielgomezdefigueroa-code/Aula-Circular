import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const pool = new Pool({ max: 5, connectionTimeoutMillis: 3000 });
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/salud', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ estado: 'listo', baseDatos: true });
  } catch {
    res.status(503).json({ error: 'SERVICIO_NO_DISPONIBLE' });
  }
});

// Ruta pública exclusiva de este laboratorio con datos sintéticos.
// En la aplicación se protege con sesión y cuenta activa.
app.get('/api/recursos-demo', async (req, res, next) => {
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
});

app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
app.use((_req, res) => res.status(404).json({ error: 'NO_ENCONTRADO' }));

app.use((error, _req, res, _next) => {
  console.error('Fallo del laboratorio:', error.code ?? 'SIN_CODIGO');
  res.status(500).json({ error: 'ERROR_INTERNO' });
});

const servidor = app.listen(
  Number(process.env.PORT ?? 3000),
  '127.0.0.1',
  () => {
    console.log(
      'Laboratorio listo en http://127.0.0.1:' + (process.env.PORT ?? 3000)
    );
  }
);

process.on('SIGINT', () => {
  servidor.close(async () => {
    await pool.end();
    process.exit(0);
  });
});