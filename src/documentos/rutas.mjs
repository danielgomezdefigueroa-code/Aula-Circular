
/**
 * AULA CIRCULAR - BIBLIOTECA Y DOCUMENTOS
 * Integración T6 con el modelo PostgreSQL del equipo.
 *
 * Tablas:
 * - documento
 * - documento_version
 * - archivo
 *
 * Rutas:
 * POST  /api/documentos
 * PATCH /api/documentos/:id/publicar
 * GET   /api/documentos/:id/descargar
 *
 * La sesión y el CSRF se configuran en src/app.mjs.
 */

import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  recibirArchivo,
  guardarArchivoPrivado,
  eliminarArchivoPrivado,
  ErrorArchivo
} from './archivos.mjs';

const CARPETA_PRIVADA = fileURLToPath(
  new URL('../../almacen_privado/documentos/', import.meta.url)
);

const NOMBRE_PRIVADO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg)$/;

const TIPOS = {
  PDF: 'application/pdf',
  PNG: 'image/png',
  JPG: 'image/jpeg'
};

/**
 * Calcula la huella SHA-256 de un archivo.
 * Devuelve 64 caracteres hexadecimales.
 */
function calcularSha256(contenido) {
  return createHash('sha256')
    .update(contenido)
    .digest('hex');
}

/**
 * Validar identificadores enteros positivos.
 */
function idPositivo(valor) {
  if (
    typeof valor !== 'string' ||
    !/^[1-9]\d*$/.test(valor)
  ) {
    return null;
  }

  const numero = Number(valor);

  return Number.isSafeInteger(numero) &&
    numero <= 2147483647
    ? numero
    : null;
}

/**
 * Convertir versiones T6:
 * v1 -> 1
 * v2 -> 2
 */
function versionNumerica(valor) {
  if (typeof valor !== 'string') {
    return null;
  }

  const coincide = /^v([1-9]\d*)$/.exec(valor.trim());

  return coincide
    ? idPositivo(coincide[1])
    : null;
}

function validarTexto(valor, limite) {
  return typeof valor === 'string' &&
    valor.trim().length >= 1 &&
    valor.trim().length <= limite;
}

function errorHttp(res, error, estado = 400) {
  return res.status(estado).json({ error });
}

/**
 * Autorización mediante el usuario autenticado
 * por el servidor principal.
 */
function requiereRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) {
      return errorHttp(res, 'SESION_REQUERIDA', 401);
    }

    if (
      !Array.isArray(req.usuario.roles) ||
      !roles.some(rol => req.usuario.roles.includes(rol))
    ) {
      return errorHttp(res, 'PERMISO_INSUFICIENTE', 403);
    }

    next();
  };
}

/**
 * Comprobar que un archivo privado existe
 * y mantiene el tamaño registrado en PostgreSQL.
 *
 * Utilizamos un descriptor de archivo para
 * comprobar y leer el mismo fichero.
 */
async function leerArchivoIntegro(registro) {
  const nombre = registro.ruta;

  if (
    registro.almacenamiento_privado !== true ||
    typeof nombre !== 'string' ||
    !NOMBRE_PRIVADO.test(nombre) ||
    !TIPOS[registro.formato]
  ) {
    return null;
  }

  const tamano = Number(registro.tamano_bytes);

  if (
    !Number.isSafeInteger(tamano) ||
    tamano < 1 ||
    tamano > 10485760
  ) {
    return null;
  }

  const ruta = path.join(CARPETA_PRIVADA, nombre);

  let descriptor;

  try {
    descriptor = await open(
      ruta,
      constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0)
    );

    const info = await descriptor.stat();

    if (
      !info.isFile() ||
      info.size !== tamano
    ) {
      return null;
    }

    const contenido = await descriptor.readFile();

    if (contenido.length !== tamano) {
      return null;
    }

    if (
      typeof registro.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(registro.sha256) ||
      calcularSha256(contenido) !== registro.sha256
    ) {
      return null;
    }

    return contenido;
  } catch (error) {
    if (
      ['ENOENT', 'EACCES', 'EPERM', 'ELOOP']
        .includes(error.code)
    ) {
      return null;
    }

    throw error;

  } finally {
    await descriptor?.close();
  }
}

/**
 * ==========================================================
 * RUTAS DOCUMENTALES
 * ==========================================================
 *
 * La aplicación principal proporciona:
 * - sesionNecesaria
 * - activaNecesaria
 *
 * La comprobación CSRF se realiza globalmente
 * antes de registrar estas rutas.
 */
export function crearRutasDocumentos(
  pool,
  sesionNecesaria,
  activaNecesaria
) {
  const router = Router();

  router.use(
    sesionNecesaria,
    activaNecesaria
  );

  /**
   * ========================================================
   * POST /api/documentos
   *
   * Crear un documento en borrador.
   * Solo permitido a docentes.
   * ========================================================
   */
  router.post(
    '/',
    requiereRol('docente'),

    (req, res, next) => {
      recibirArchivo(req, res, error => {
        if (!error) {
          return next();
        }

        if (error.code === 'LIMIT_FILE_SIZE') {
          return errorHttp(
            res,
            'ARCHIVO_DEMASIADO_GRANDE',
            413
          );
        }

        if (error.code?.startsWith('LIMIT_')) {
          return errorHttp(res, 'CARGA_INVALIDA');
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
          cursoId,
          version
        } = req.body ?? {};

        const curso =
          cursoId === '' || cursoId === undefined
            ? null
            : idPositivo(cursoId);

        const numero = versionNumerica(version);

        if (
          !validarTexto(titulo, 120) ||
          numero === null ||
          (
            cursoId !== '' &&
            cursoId !== undefined &&
            curso === null
          )
        ) {
          return errorHttp(res, 'DATOS_INVALIDOS');
        }

        if (!req.file) {
          return errorHttp(res, 'ARCHIVO_REQUERIDO');
        }

        // Validación del curso.
        if (curso !== null) {
          const existe = await pool.query(
            `SELECT id
             FROM curso
             WHERE id = $1
               AND activo = true`,
            [curso]
          );

          if (!existe.rowCount) {
            return errorHttp(res, 'CURSO_NO_VALIDO');
          }
        }

        // Validación y almacenamiento privado T6.
        const archivo = await guardarArchivoPrivado(
          req.file
        );

        nombreInterno = archivo.nombreInterno;

        // El archivo ya ha sido validado por T6.
        const sha256 = calcularSha256(req.file.buffer);

        // Inicio de transacción PostgreSQL.
        cliente = await pool.connect();

        await cliente.query('BEGIN');
        transaccionIniciada = true;

        // Código único para el documento.
        const codigo =
          'DOC-' +
          randomBytes(8).toString('hex').toUpperCase();

        // 1. Registrar documento.
        const documento = await cliente.query(`
          INSERT INTO documento (
            codigo,
            titulo,
            curso_id,
            estado_editorial
          )
          VALUES ($1, $2, $3, 'borrador')
          RETURNING id
        `, [
          codigo,
          titulo.trim(),
          curso
        ]);

        const documentoId = documento.rows[0].id;

        // 2. Registrar archivo protegido.
        const resultadoArchivo = await cliente.query(`
  INSERT INTO archivo (
    nombre,
    tipo_mime,
    ruta,
    almacenamiento_privado,
    tamano_bytes,
    formato,
    paginas,
    ancho,
    alto,
    sha256
  )
  VALUES (
    $1, $2, $3, true,
    $4, $5, $6, $7, $8, $9
  )
  RETURNING id
`, [
  nombreInterno,
  TIPOS[archivo.formato],
  nombreInterno,
  archivo.tamano,
  archivo.formato,
  archivo.paginas,
  archivo.ancho,
  archivo.alto,
  sha256
]);

        const archivoId = resultadoArchivo.rows[0].id;

        // 3. Registrar versión documental.
        await cliente.query(`
          INSERT INTO documento_version (
            documento_id,
            numero_version,
            fecha,
            archivo_id,
            actual
          )
          VALUES (
            $1, $2, CURRENT_DATE, $3, true
          )
        `, [
          documentoId,
          numero,
          archivoId
        ]);

        await cliente.query('COMMIT');

        transaccionIniciada = false;
        confirmado = true;

        return res.status(201).json({
          datos: {
            documentoId,
            recursoId: documentoId,
            archivoId,
            titulo: titulo.trim(),
            version: 'v' + numero,
            formato: archivo.formato,
            estado: 'borrador'
          }
        });

      } catch (error) {
        if (transaccionIniciada) {
          try {
            await cliente.query('ROLLBACK');
          } catch {
            console.error(
              'No se pudo revertir el alta documental'
            );
          }
        }

        // Evitar archivos huérfanos.
        if (!confirmado && nombreInterno) {
          try {
            await eliminarArchivoPrivado(nombreInterno);
          } catch {
            console.error(
              'Limpieza pendiente de archivo privado'
            );
          }
        }

        if (error instanceof ErrorArchivo) {
          return errorHttp(
            res,
            error.codigo,
            error.estado
          );
        }

        if (error.code === '23505') {
          return errorHttp(
            res,
            'DOCUMENTO_DUPLICADO',
            409
          );
        }

        next(error);

      } finally {
        cliente?.release();
      }
    }
  );

  /**
   * ========================================================
   * PATCH /api/documentos/:id/publicar
   *
   * Publicar un documento que esté en borrador.
   * Solo permitido a docentes.
   * ========================================================
   */
  router.patch(
    '/:id/publicar',
    requiereRol('docente'),

    async (req, res, next) => {
      const documentoId = idPositivo(req.params.id);

      if (!documentoId) {
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
            d.id,
            d.estado_editorial,
            a.id AS archivo_id,
            a.ruta,
            a.almacenamiento_privado,
            a.formato,
            a.tamano_bytes,
            a.sha256
          FROM documento d
          JOIN documento_version v
            ON v.documento_id = d.id
           AND v.actual = true
          JOIN archivo a
            ON a.id = v.archivo_id
          WHERE d.id = $1
          FOR UPDATE OF d
        `, [documentoId]);

        if (
          resultado.rowCount !== 1 ||
          resultado.rows[0].estado_editorial !== 'borrador'
        ) {
          return errorHttp(
            res,
            'DOCUMENTO_NO_PUBLICABLE',
            409
          );
        }

        const registro = resultado.rows[0];

        // Comprobar integridad del archivo.
        const contenido = await leerArchivoIntegro(
          registro
        );

        if (!contenido) {
          return errorHttp(
            res,
            'ARCHIVO_NO_DISPONIBLE',
            409
          );
        }

        // Publicar documento.
        await cliente.query(`
          UPDATE documento
          SET estado_editorial = 'publicado'
          WHERE id = $1
        `, [documentoId]);

        await cliente.query('COMMIT');

        transaccionIniciada = false;

        return res.json({
          datos: {
            documentoId,
            recursoId: documentoId,
            archivoId: registro.archivo_id,
            estado: 'publicado'
          }
        });

      } catch (error) {
        next(error);

      } finally {
        if (transaccionIniciada) {
          try {
            await cliente.query('ROLLBACK');
          } catch {
            console.error(
              'No se pudo revertir la publicación'
            );
          }
        }

        cliente?.release();
      }
    }
  );

  /**
   * ========================================================
   * GET /api/documentos/:id/descargar
   *
   * :id corresponde ahora al identificador entero
   * de archivo.id.
   *
   * Comprueba:
   * - Sesión.
   * - Cuenta activa.
   * - Rol alumno/docente.
   * - Documento publicado.
   * - Autorización por curso.
   * - Archivo privado e integridad.
   * ========================================================
   */
  router.get(
    '/:id/descargar',
    requiereRol('alumno', 'docente'),

    async (req, res, next) => {
      const archivoId = idPositivo(req.params.id);

      if (!archivoId) {
        return errorHttp(
          res,
          'ID_ARCHIVO_INVALIDO'
        );
      }

      try {
        const resultado = await pool.query(`
          SELECT
            a.id,
            a.ruta,
            a.formato,
            a.tamano_bytes,
            a.sha256,
            a.almacenamiento_privado,
            d.estado_editorial,
            d.curso_id
          FROM archivo a
          JOIN documento_version v
            ON v.archivo_id = a.id
           AND v.actual = true
          JOIN documento d
            ON d.id = v.documento_id
          WHERE a.id = $1
        `, [archivoId]);

        if (
          resultado.rowCount !== 1 ||
          resultado.rows[0].estado_editorial !== 'publicado'
        ) {
          return errorHttp(
            res,
            'DOCUMENTO_NO_DISPONIBLE',
            404
          );
        }

        const registro = resultado.rows[0];

        const esDocente =
          req.usuario.roles.includes('docente');

        // Permisos del alumnado.
        if (!esDocente) {
          if (
            req.usuario.curso_confirmado_id == null
          ) {
            return errorHttp(
              res,
              'CURSO_NO_CONFIRMADO',
              403
            );
          }

          if (
            registro.curso_id !== null &&
            Number(registro.curso_id) !==
              Number(req.usuario.curso_confirmado_id)
          ) {
            return errorHttp(
              res,
              'CURSO_NO_AUTORIZADO',
              403
            );
          }
        }

        // Lectura segura del archivo.
        const contenido = await leerArchivoIntegro(
          registro
        );

        if (!contenido) {
          return errorHttp(
            res,
            'ARCHIVO_NO_DISPONIBLE',
            404
          );
        }

        const extension =
          registro.formato.toLowerCase();

        return res.status(200).set({
          'Content-Type': TIPOS[registro.formato],
          'Content-Disposition':
            `attachment; filename="documento-${archivoId}.${extension}"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store'
        }).send(contenido);

      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
