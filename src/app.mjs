// Servidor del laboratorio: publica el cliente y dos rutas de consulta.
// Node carga .env mediante --env-file (ver scripts de package.json).
import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
// pg lee PGHOST, PGPORT, PGDATABASE, PGUSER y PGPASSWORD del entorno.
// Reutiliza hasta cinco conexiones; espera hasta tres segundos para conectar.
const pool = new Pool({ max: 5, connectionTimeoutMillis: 3000 });
const app = express();

// Reduce información del servidor y limita el tamaño de cuerpos JSON.
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// SELECT 1 comprueba una conexión real, sin consultar la tabla del catálogo.
// Responde 200 si funciona y 503 si la base no está disponible.
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
    // q es opcional: vacío lista todos los títulos; limita la búsqueda a 80 caracteres.
    const texto = String(req.query.q ?? '').trim().slice(0, 80);
    // $1 separa el dato del SQL. ILIKE busca sin distinguir mayúsculas.
    // % permite coincidencias parciales; % y _ del usuario siguen siendo comodines.
    const resultado = await pool.query(
      'SELECT id, titulo, tipo FROM recurso_demo WHERE titulo ILIKE $1 ORDER BY id',
      ['%' + texto + '%']
    );
    res.json({ datos: resultado.rows });
  } catch (error) {
    // Delega en el middleware de errores situado al final.
    next(error);
  }
});

// Resuelve public/ desde la ubicación de este módulo, no desde la terminal.
// Cliente y API comparten origen: este laboratorio no necesita CORS.
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
// Se ejecuta si ninguna ruta ni archivo público atendió la petición.
app.use((_req, res) => res.status(404).json({ error: 'NO_ENCONTRADO' }));

// Los cuatro argumentos identifican el middleware de errores de Express.
// Registra solo el código y evita enviar detalles internos al navegador.
app.use((error, _req, res, _next) => {
  console.error('Fallo del laboratorio:', error.code ?? 'SIN_CODIGO');
  res.status(500).json({ error: 'ERROR_INTERNO' });
});

// Escucha solo en este ordenador. PORT viene de .env o vale 3000.
// Un puerto ocupado impide arrancar y produce EADDRINUSE.
const servidor = app.listen(
  Number(process.env.PORT ?? 3000),
  '127.0.0.1',
  () => {
    console.log(
      'Laboratorio listo en http://127.0.0.1:' + (process.env.PORT ?? 3000)
    );
  }
);

// Ctrl+C deja terminar las peticiones y cierra el pool antes de salir.
process.on('SIGINT', () => {
  servidor.close(async () => {
    await pool.end();
    process.exit(0);
  });
});