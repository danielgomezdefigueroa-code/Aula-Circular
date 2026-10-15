
/**
 * ============================================================
 * AULA CIRCULAR - BIBLIOTECA Y DOCUMENTOS
 * 
 * Preparar la información que necesita la interfaz
 * para mostrar la acción adecuada a cada recurso.
 *
 * IMPORTANTE:
 * Este módulo no realiza préstamos, descargas ni
 * modificaciones en la base de datos.
 *
 * Únicamente construye información descriptiva.
 * ============================================================
 */

/**
 * Construye la acción disponible para un recurso.
 *
 * @param {object} recurso
 * Ficha del recurso obtenida desde PostgreSQL.
 *
 * @param {object} opciones
 * Información complementaria del recurso.
 *
 * @returns {object}
 * Metadatos de la acción que podrá representar la interfaz.
 */
export function obtenerAccionRecurso(recurso, opciones = {}) {

    // ----------------------------------------------------------
    // RECURSOS FÍSICOS
    //
    // Solo se habilita la solicitud cuando existe al menos
    // un ejemplar con estado de servicio "disponible".
    //
    // No se crea ninguna reserva ni préstamo desde aquí.
    // ----------------------------------------------------------
    if (recurso.tipo === 'fisico') {
  
      const disponibles = opciones.ejemplaresDisponibles ?? 0;
  
      return {
        tipo: 'solicitar_prestamo',
        habilitada: disponibles > 0,
        ejemplaresDisponibles: disponibles
      };
    }
  
    // ----------------------------------------------------------
    // RECURSOS DIGITALES
    //
    // Se presentan los metadatos del documento.
    //
    // La descarga protegida se implementará en una tarea
    // posterior. Por tanto, no inventamos una URL.
    // ----------------------------------------------------------
    if (recurso.tipo === 'digital') {
  
      const metadatos = opciones.metadatos ?? null;
  
      return {
        tipo: 'descargar',
        habilitada: false,
        descargaDisponible: false,
        formato: metadatos?.formato ?? null,
        version: metadatos?.version_documento ?? null,
        url: null
      };
    }
  
    // ----------------------------------------------------------
    // RECURSOS DE TIPO ENLACE
    //
    // Solo se permite mostrar la acción si la dirección
    // utiliza HTTPS.
    //
    // El esquema SQL ya restringe las URL de tipo enlace.
    // ----------------------------------------------------------
    if (recurso.tipo === 'enlace') {
  
      const urlValida =
        typeof recurso.url === 'string' &&
        /^https:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/i.test(recurso.url);
  
      return {
        tipo: 'abrir_enlace',
        habilitada: urlValida,
        url: urlValida ? recurso.url : null
      };
    }
  
    // ----------------------------------------------------------
    // TIPO DESCONOCIDO
    //
    // Por seguridad, no se habilita ninguna acción.
    // ----------------------------------------------------------
    return {
      tipo: 'ninguna',
      habilitada: false
    };
  }
  