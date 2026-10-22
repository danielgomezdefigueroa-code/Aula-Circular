import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const pool = new pg.Pool({ max: 1, connectionTimeoutMillis: 3000 });
const cliente = await pool.connect();
try {
  await cliente.query('BEGIN');
  await cliente.query('SELECT pg_advisory_xact_lock(71002)');
  await cliente.query(`CREATE TABLE IF NOT EXISTS migracion (
    nombre text PRIMARY KEY, hash text NOT NULL, aplicada_en timestamptz NOT NULL DEFAULT now())`);
  const carpeta = new URL('../sql/migraciones/', import.meta.url);
  // La primera entrega local usaba 005_cesiones, antes de integrar 005_documentos.
  const cesionesAnterior = await cliente.query("SELECT hash FROM migracion WHERE nombre='005_cesiones.sql'");
  if (cesionesAnterior.rowCount) {
    const contenido = await readFile(new URL('006_cesiones.sql', carpeta),'utf8');
    if (cesionesAnterior.rows[0].hash !== createHash('sha256').update(contenido).digest('hex')) {
      throw new Error('La migración antigua de cesiones no coincide con 006_cesiones.sql');
    }
    await cliente.query("UPDATE migracion SET nombre='006_cesiones.sql' WHERE nombre='005_cesiones.sql'");
  }
  for (const nombre of (await readdir(carpeta)).filter(n => n.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(nombre, carpeta),'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    const anterior = await cliente.query('SELECT hash FROM migracion WHERE nombre=$1',[nombre]);
    if (anterior.rowCount) {
      if (anterior.rows[0].hash !== hash) throw new Error(`Migración aplicada modificada: ${nombre}`);
      continue;
    }
    await cliente.query(sql);
    await cliente.query('INSERT INTO migracion(nombre,hash) VALUES($1,$2)',[nombre,hash]);
    console.log('Aplicada:',nombre);
  }
  // Corrige únicamente los textos de demostración con la codificación dañada conocida.
  const tabla = await cliente.query("SELECT to_regclass('recurso_demo') AS tabla");
  if (tabla.rows[0].tabla) {
    const cambios = [
      ['Calculadora cient\u00c3\u00adfica de ejemplo','Calculadora científica de ejemplo'],
      ['Gu\u00c3\u00ada de pr\u00c3\u00a1cticas de ejemplo','Guía de prácticas de ejemplo']
    ];
    for (const [antes,despues] of cambios) {
      const r = await cliente.query('UPDATE recurso_demo SET titulo=$2 WHERE titulo=$1',[antes,despues]);
      if (r.rowCount) console.log('Corregido un título de demostración.');
    }
  }
  await cliente.query('COMMIT');
  console.log('Base de datos preparada.');
} catch (error) {
  await cliente.query('ROLLBACK');
  console.error('No se pudo preparar la base:',error.code ?? error.message);
  process.exitCode=1;
} finally { cliente.release(); await pool.end(); }
