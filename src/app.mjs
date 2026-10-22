import pg from 'pg';
import { crearAplicacion } from './aplicacion.mjs';

const pool = new pg.Pool({ max: 5, connectionTimeoutMillis: 3000 });
const { app, almacen } = await crearAplicacion(pool, {
  origen: process.env.APP_ORIGIN,
  secreto: process.env.SESSION_SECRET
});
const servidor = app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  console.log('Aula Circular en http://127.0.0.1:' + (process.env.PORT ?? 3000));
});
let cerrando = false;
async function cerrar() {
  if (cerrando) return;
  cerrando = true;
  servidor.close(async () => {
    await almacen.close();
    await pool.end();
  });
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
