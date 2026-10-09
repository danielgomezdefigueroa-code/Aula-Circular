// Lógica de registro compartida: Fede la llamará desde POST /api/registro.
// Antes de llamarla, la ruta deberá validar CSRF y limitar intentos.
import { crearHash, claveValida } from './contraseñas.mjs';

export function validarRegistro(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return null;
  const alias = typeof datos.alias === 'string' ? datos.alias.trim() : '';
  const correo = typeof datos.correo === 'string' ? datos.correo.trim().toLowerCase() : '';
  const cursoId = datos.cursoSolicitadoId;
  if (alias.length < 2 || alias.length > 80 || correo.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ||
      !Number.isSafeInteger(cursoId) || cursoId < 1 || !claveValida(datos.clave)) return null;
  // Solo recogemos campos permitidos. rol y estado del navegador se ignoran.
  return { alias, correo, clave: datos.clave, cursoId };
}

export async function registrarCuenta(pool, entrada) {
  const datos = validarRegistro(entrada);
  if (!datos) return { codigo: 422, cuerpo: { error: 'DATOS_INVALIDOS' } };
  const hash = await crearHash(datos.clave);
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const curso = await cliente.query('SELECT id FROM curso WHERE id = $1 AND activo = true', [datos.cursoId]);
    if (!curso.rowCount) {
      await cliente.query('ROLLBACK');
      return { codigo: 422, cuerpo: { error: 'CURSO_INVALIDO' } };
    }
    const alta = await cliente.query(
      `INSERT INTO usuario (alias, correo, hash, curso_solicitado_id, estado)
       VALUES ($1, $2, $3, $4, 'pendiente')
       ON CONFLICT (correo) DO NOTHING RETURNING id`,
      [datos.alias, datos.correo, hash, datos.cursoId]
    );
    if (alta.rowCount) {
      await cliente.query("INSERT INTO usuario_rol (usuario_id, rol) VALUES ($1, 'alumno')", [alta.rows[0].id]);
    }
    await cliente.query('COMMIT');
    // Mismo mensaje y estado si el correo ya existía: no revelamos cuentas.
    return { codigo: 202, cuerpo: { mensaje: 'Solicitud recibida. Si procede, la cuenta quedará pendiente de validación.' } };
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error; // El servidor de Fede devolverá un error genérico, sin SQL/secretos.
  } finally {
    cliente.release();
  }
}
