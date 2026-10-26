
/**
 * AULA CIRCULAR - T6
 * Alta y publicación de documentos protegidos.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  requiereSesion,
  requiereCuentaActiva,
  requiereRol,
  requiereCsrf
} from '../cuentas/sesiones.mjs';

import {
  recibirArchivo,
  guardarArchivoPrivado,
  eliminarArchivoPrivado,
  ErrorArchivo
} from './archivos.mjs';

const CARPETA_PRIVADA = fileURLToPath(
  new URL('../../almacen_privado/documentos/', import.meta.url)
);

function enteroPositivo(valor) {
  if (typeof valor !== 'string' || !/^[1-9]\d*$/.test(valor)) {
    return null;
  }

  const numero = Number(valor);

  return Number.isSafeInteger(numero) && numero <= 2147483647
    ? numero
    : null;
}

function textoValido(valor, maximo) {
  return typeof valor === 'string' &&
    valor.trim().length >= 1 &&
    valor.trim().length <= maximo;
}

function errorHttp(res, codigo, estado = 400) {
  return res.status(estado).json({ error: codigo });
}

export function crearRutasDocumentos(pool) {
  const router = Router();

  // Todas las rutas requieren sesión y cuenta activa.
// Los permisos específicos se aplican por operación.
router.use(
    requiereSesion(pool),
    requiereCuentaActiva
  );

  /**
   * POST /api/documentos
   *
   * multipart/form-data:
   * titulo, categoriaId, cursoId, version, archivo
   *
   * cursoId vacío = documento general.
   */
  router.post('/',
    requiereRol('docente'),
    requiereCsrf,

    // Convertimos los errores de Multer en respuestas HTTP.
    (req, res, next) => {
      recibirArchivo(req, res, error => {
        if (!error) return next();

        if (error.code === 'LIMIT_FILE_SIZE') {
          return errorHttp(res, 'ARCHIVO_DEMASIADO_GRANDE', 413);
        }

        if (error.code?.startsWith('LIMIT_')) {
          return errorHttp(res, 'CARGA_INVALIDA', 400);
        }

        next(error);
      });
    },

    async (req, res, next) => {
      let nombreInterno = null;
      let cliente = null;
      let transaccionIniciada = false;
      let confirmado = false;

      try {
        const {
          titulo,
          categoriaId,
          cursoId,
          version
        } = req.body ?? {};

        const categoria = enteroPositivo(categoriaId);
        const curso = cursoId === '' || cursoId === undefined
          ? null
          : enteroPositivo(cursoId);

        if (!textoValido(titulo, 120) ||
            !textoValido(version, 30) ||
            categoria === null ||
            (cursoId !== '' && cursoId !== undefined &&
             curso === null)) {
          return errorHttp(res, 'DATOS_INVALIDOS');
        }

        if (!req.file) {
          return errorHttp(res, 'ARCHIVO_REQUERIDO');
        }

        // Comprobamos la categoría real en PostgreSQL.
        const categorias = await pool.query(`
          SELECT id, ambito
          FROM categoria
          WHERE id = $1
            AND activo = true
            AND ambito IN ('biblioteca', 'documentacion')
        `, [categoria]);

        const categoriaActual = categorias.rows[0];

        // Rechazamos categorías inexistentes o no permitidas.
        if (!categoriaActual ||
            (categoriaActual.ambito === 'biblioteca' && categoria !== 1) ||
            (categoriaActual.ambito === 'documentacion' && categoria !== 2)) {
          return errorHttp(res, 'CATEGORIA_NO_PERMITIDA');
        }

        if (curso !== null) {
          const cursos = await pool.query(`
            SELECT id FROM curso
            WHERE id = $1 AND activo = true
          `, [curso]);

          if (cursos.rowCount === 0) {
            return errorHttp(res, 'CURSO_NO_VALIDO');
          }
        }

        // Validación y guardado privado.
        const archivo = await guardarArchivoPrivado(req.file);
        nombreInterno = archivo.nombreInterno;

        // Toda la información relacional se confirma junta.
        cliente = await pool.connect();
        await cliente.query('BEGIN');
        transaccionIniciada = true;

        const recurso = await cliente.query(`
          INSERT INTO recurso (
            titulo, descripcion, tipo, origen,
            categoria_id, estado_editorial, url
          )
          VALUES (
            $1, NULL, 'digital', 'centro',
            $2, 'borrador', NULL
          )
          RETURNING id, titulo, estado_editorial
        `, [titulo.trim(), categoria]);

        const recursoId = recurso.rows[0].id;

        if (curso !== null) {
          await cliente.query(`
            INSERT INTO recurso_curso (recurso_id, curso_id)
            VALUES ($1, $2)
          `, [recursoId, curso]);
        }

        await cliente.query(`
          INSERT INTO metadato_digital (
            recurso_id, formato,
            version_documento, descarga_disponible
          )
          VALUES ($1, $2, $3, false)
        `, [recursoId, archivo.formato, version.trim()]);

        const archivoId = randomUUID();

        await cliente.query(`
          INSERT INTO archivo_digital (
            id, recurso_id, nombre_interno,
            version_documento, formato,
            tamano_bytes, paginas, ancho, alto
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9
          )
        `, [
          archivoId,
          recursoId,
          nombreInterno,
          version.trim(),
          archivo.formato,
          archivo.tamano,
          archivo.paginas,
          archivo.ancho,
          archivo.alto
        ]);

        await cliente.query('COMMIT');
        transaccionIniciada = false;
        confirmado = true;

        return res.status(201).json({
          datos: {
            recursoId,
            archivoId,
            titulo: titulo.trim(),
            version: version.trim(),
            formato: archivo.formato,
            estado: 'borrador'
          }
        });

      } catch (error) {
        if (transaccionIniciada) {
          try {
            await cliente.query('ROLLBACK');
          } catch {
            console.error('Fallo al revertir transacción documental');
          }
        }

        // Compensación: si no se confirmó la BD,
        // intentamos eliminar el archivo físico.
        if (!confirmado && nombreInterno) {
          try {
            await eliminarArchivoPrivado(nombreInterno);
          } catch {
            console.error('Limpieza pendiente de archivo privado');
          }
        }

        if (error instanceof ErrorArchivo) {
          return errorHttp(res, error.codigo, error.estado);
        }

        next(error);
      } finally {
        cliente?.release();
      }
    }
  );

  /**
   * PATCH /api/documentos/:id/publicar
   *
   * :id es el identificador del recurso.
   * La publicación requiere un archivo existente.
   */
  router.patch(
    '/:id/publicar',
    requiereRol('docente'),
    requiereCsrf,
    async (req, res, next) => {
      const recursoId = enteroPositivo(req.params.id);

      if (recursoId === null) {
        return errorHttp(res, 'ID_INVALIDO');
      }

      let cliente;
      let transaccionIniciada = false;

      try {
        cliente = await pool.connect();
        await cliente.query('BEGIN');
        transaccionIniciada = true;

        const resultado = await cliente.query(`
          SELECT
            r.id,
            r.estado_editorial,
            a.id AS archivo_id,
            a.nombre_interno
          FROM recurso r
          JOIN archivo_digital a ON a.recurso_id = r.id
          JOIN metadato_digital md ON md.recurso_id = r.id
          WHERE r.id = $1
            AND r.tipo = 'digital'
            AND r.estado_editorial = 'borrador'
          FOR UPDATE OF r
        `, [recursoId]);

        // Se exige exactamente un archivo para esta
        // primera implementación de publicación.
        if (resultado.rowCount !== 1) {
          await cliente.query('ROLLBACK');
          transaccionIniciada = false;
          return errorHttp(res, 'DOCUMENTO_NO_PUBLICABLE', 409);
        }

        const documento = resultado.rows[0];

        // El nombre proviene de la BD y cumple su CHECK.
        const ruta = path.join(
          CARPETA_PRIVADA,
          documento.nombre_interno
        );

        try {
          await access(ruta, constants.R_OK);
        } catch {
          await cliente.query('ROLLBACK');
          transaccionIniciada = false;
          return errorHttp(res, 'ARCHIVO_NO_DISPONIBLE', 409);
        }

        await cliente.query(`
          UPDATE recurso
          SET estado_editorial = 'publicado'
          WHERE id = $1
        `, [recursoId]);

        await cliente.query(`
          UPDATE metadato_digital
          SET descarga_disponible = true
          WHERE recurso_id = $1
        `, [recursoId]);

        await cliente.query('COMMIT');
        transaccionIniciada = false;

        res.json({
          datos: {
            recursoId,
            archivoId: documento.archivo_id,
            estado: 'publicado'
          }
        });
      } catch (error) {
        if (transaccionIniciada) {
          try {
            await cliente.query('ROLLBACK');
          } catch {
            console.error('Fallo al revertir publicación');
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
