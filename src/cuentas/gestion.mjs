import { Router } from 'express';
import {
  requiereCsrf,
  requiereSesion,
  requiereCuentaActiva,
  requiereRol
} from './sesiones.mjs';

export function crearRutasGestion(pool) {
  const router = Router();

  router.use(
    requiereSesion(pool),
    requiereCuentaActiva,
    requiereRol('docente')
  );

  router.post('/usuarios/:id/validar', requiereCsrf,
    async (req, res, next) => {
      const id = Number(req.params.id);
      const cuerpo = req.body ?? {};
      const cursoId = cuerpo.cursoConfirmadoId;

      // No permite conceder roles desde esta operación.
      if (!/^[1-9]\d*$/.test(req.params.id) ||
          !Number.isSafeInteger(id) ||
          !Number.isSafeInteger(cursoId) || cursoId < 1 ||
          Object.keys(cuerpo).some(campo => campo !== 'cursoConfirmadoId')) {
        return res.status(422).json({ error: 'DATOS_INVALIDOS' });
      }

      let cliente;
      let transaccionAbierta = false;

      try {
        cliente = await pool.connect();
        await cliente.query('BEGIN');
        transaccionAbierta = true;

        // Bloquea ambas cuentas en orden estable. Revalida al docente
        // dentro de la transacción, antes de efectuar la escritura.
        const cuentas = await cliente.query(`
          SELECT id, estado, auth_version
          FROM usuario
          WHERE id = ANY($1::integer[])
          ORDER BY id
          FOR UPDATE
        `, [[req.usuario.id, id]]);

        const docente = cuentas.rows.find(
          cuenta => cuenta.id === req.usuario.id
        );
        const destinatario = cuentas.rows.find(cuenta => cuenta.id === id);

        const permiso = await cliente.query(`
          SELECT 1 FROM usuario_rol
          WHERE usuario_id = $1 AND rol = 'docente'
        `, [req.usuario.id]);

        if (!docente || docente.estado !== 'activo' ||
            docente.auth_version !== req.session.authVersion ||
            !permiso.rowCount) {
          await cliente.query('ROLLBACK');
          transaccionAbierta = false;
          return res.status(403).json({ error: 'PERMISO_INSUFICIENTE' });
        }

        if (!destinatario) {
          await cliente.query('ROLLBACK');
          transaccionAbierta = false;
          return res.status(404).json({ error: 'CUENTA_NO_ENCONTRADA' });
        }

        if (destinatario.estado !== 'pendiente') {
          await cliente.query('ROLLBACK');
          transaccionAbierta = false;
          return res.status(409).json({ error: 'CUENTA_NO_PENDIENTE' });
        }

        // Evita que el curso se desactive durante esta validación.
        const curso = await cliente.query(`
          SELECT id FROM curso
          WHERE id = $1 AND activo = true
          FOR SHARE
        `, [cursoId]);

        if (!curso.rowCount) {
          await cliente.query('ROLLBACK');
          transaccionAbierta = false;
          return res.status(422).json({ error: 'CURSO_INVALIDO' });
        }

        const resultado = await cliente.query(`
          UPDATE usuario
          SET estado = 'activo',
              curso_confirmado_id = $1,
              validado_por = $2,
              validado_en = now(),
              auth_version = auth_version + 1
          WHERE id = $3
          RETURNING id, alias, estado, curso_confirmado_id
        `, [cursoId, req.usuario.id, id]);

        await cliente.query('COMMIT');
        transaccionAbierta = false;

        res.json({ datos: resultado.rows[0] });
      } catch (error) {
        if (cliente && transaccionAbierta) {
          try {
            await cliente.query('ROLLBACK');
          } catch {
            // Conserva el error original.
          }
        }
        next(error);
      } finally {
        cliente?.release();
      }
    }
  );

  return router;
}