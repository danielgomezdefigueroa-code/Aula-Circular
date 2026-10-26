
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const MiB = 1024 * 1024;
const MAX_PDF = 10 * MiB;
const MAX_IMAGEN = 5 * MiB;
const MAX_PIXELES = 12_000_000;
const MAX_PAGINAS = 200;

const CARPETA_PRIVADA = fileURLToPath(
  new URL('../../almacen_privado/documentos/', import.meta.url)
);

export class ErrorArchivo extends Error {
  constructor(codigo, estado = 400) {
    super(codigo);
    this.name = 'ErrorArchivo';
    this.codigo = codigo;
    this.estado = estado;
  }
}

// Multer recibe los archivos en memoria.
// Todavía no los guarda en el disco.
export const recibirArchivo = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PDF,
    files: 1,
    fields: 10,
    fieldSize: 4096
  }
}).single('archivo');

function identificarFormato(buffer) {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'PDF';
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  ) {
    return 'PNG';
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'JPG';
  }

  throw new ErrorArchivo('TIPO_NO_PERMITIDO', 415);
}

export async function validarArchivo(archivo) {
  if (!archivo?.buffer?.length) {
    throw new ErrorArchivo('ARCHIVO_VACIO');
  }

  const extension = path.extname(archivo.originalname).toLowerCase();
  const formato = identificarFormato(archivo.buffer);

  const extensiones = {
    PDF: ['.pdf'],
    PNG: ['.png'],
    JPG: ['.jpg', '.jpeg']
  };

  if (!extensiones[formato].includes(extension)) {
    throw new ErrorArchivo('EXTENSION_NO_COINCIDE', 415);
  }

  const limite = formato === 'PDF' ? MAX_PDF : MAX_IMAGEN;

  if (archivo.size > limite) {
    throw new ErrorArchivo('ARCHIVO_DEMASIADO_GRANDE', 413);
  }

  let paginas = null;
  let ancho = null;
  let alto = null;

  if (formato === 'PDF') {
    try {
      const pdf = await PDFDocument.load(archivo.buffer, {
        updateMetadata: false
      });

      paginas = pdf.getPageCount();

      if (paginas < 1 || paginas > MAX_PAGINAS) {
        throw new ErrorArchivo('PAGINAS_NO_PERMITIDAS');
      }
    } catch (error) {
      if (error instanceof ErrorArchivo) throw error;
      throw new ErrorArchivo('PDF_INVALIDO');
    }
  } else {
    try {
      const imagen = sharp(archivo.buffer, {
        limitInputPixels: MAX_PIXELES,
        failOn: 'error'
      });

      const info = await imagen.metadata();

      if (
        (formato === 'PNG' && info.format !== 'png') ||
        (formato === 'JPG' && info.format !== 'jpeg')
      ) {
        throw new ErrorArchivo('IMAGEN_INVALIDA');
      }

      ancho = info.width;
      alto = info.height;

      if (!ancho || !alto || ancho * alto > MAX_PIXELES) {
        throw new ErrorArchivo('DIMENSIONES_NO_PERMITIDAS');
      }

      // Fuerza la lectura de la imagen, no solo de la cabecera.
      await imagen.raw().toBuffer();
    } catch (error) {
      if (error instanceof ErrorArchivo) throw error;
      throw new ErrorArchivo('IMAGEN_INVALIDA');
    }
  }

  return {
    formato,
    extension: formato === 'PDF' ? '.pdf'
      : formato === 'PNG' ? '.png' : '.jpg',
    tamano: archivo.size,
    paginas,
    ancho,
    alto
  };
}

export async function guardarArchivoPrivado(archivo) {
  const datos = await validarArchivo(archivo);

  await mkdir(CARPETA_PRIVADA, {
    recursive: true,
    mode: 0o700
  });

  // Nombre generado por el servidor.
  const nombreInterno = randomUUID() + datos.extension;
  const ruta = path.join(CARPETA_PRIVADA, nombreInterno);

  await writeFile(ruta, archivo.buffer, {
    flag: 'wx',
    mode: 0o600
  });

  // La ruta no se devuelve a los clientes de la API.
  return {
    nombreInterno,
    ...datos
  };
}

export async function eliminarArchivoPrivado(nombreInterno) {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(nombreInterno)) {
    throw new ErrorArchivo('IDENTIFICADOR_INVALIDO');
  }

  const ruta = path.join(CARPETA_PRIVADA, nombreInterno);
  await unlink(ruta);
}
