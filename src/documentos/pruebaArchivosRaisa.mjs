import { readFile } from 'node:fs/promises';
import {
  validarArchivo,
  ErrorArchivo
} from './archivos.mjs';

// Construye un archivo de prueba compatible
// con la estructura recibida por Multer.
function crearArchivo(nombre, buffer) {
  return {
    originalname: nombre,
    buffer,
    size: buffer.length
  };
}

async function ejecutarPrueba(nombre, archivo, esperado) {
  try {
    const resultado = await validarArchivo(archivo);

    const observado = 'ACEPTADO';

    console.log({
      caso: nombre,
      esperado,
      observado,
      formato: resultado.formato,
      coincide: observado === esperado
    });

  } catch (error) {
    if (!(error instanceof ErrorArchivo)) throw error;

    const observado = error.codigo;

    console.log({
      caso: nombre,
      esperado,
      observado,
      coincide: observado === esperado
    });
  }
}

// CASO 1: PDF real
const rutaPDF = new URL(
  '../../documentos/DOC-001_Guia_inicio_curso_v1.pdf',
  import.meta.url
);

const pdf = await readFile(rutaPDF);

await ejecutarPrueba(
  'PDF válido',
  crearArchivo('guia.pdf', pdf),
  'ACEPTADO'
);

// CASO 2: Ejecutable ficticio renombrado
const ejecutableFalso = Buffer.from(
  'MZ - contenido de prueba que no es un PDF'
);

await ejecutarPrueba(
  'Ejecutable renombrado como PDF',
  crearArchivo('programa.pdf', ejecutableFalso),
  'TIPO_NO_PERMITIDO'
);

// CASO 3: Archivo mayor de 10 MiB
const archivoGrande = Buffer.alloc(
  10 * 1024 * 1024 + 1
);

archivoGrande.write('%PDF-', 0);

await ejecutarPrueba(
  'PDF sobredimensionado',
  crearArchivo('grande.pdf', archivoGrande),
  'ARCHIVO_DEMASIADO_GRANDE'
);
