/* Datos ficticios. Este archivo no es una base de datos ni una fuente privada. */
(function (raiz) {
  "use strict";
  const recursos = [
    { id:"BIB-001", seccion:"biblioteca", titulo:"Calculadora científica", curso:"DAW1", tipo:"fisico", modalidad:"prestamo", estado:"disponible", detalle:"Propiedad del centro. Un ejemplar de ensayo." },
    { id:"BIB-002", seccion:"biblioteca", titulo:"Kit de prácticas de redes", curso:"DAW2", tipo:"fisico", modalidad:"prestamo", estado:"reservado", detalle:"Propiedad del centro. Reserva ficticia ya asignada." },
    { id:"BIB-003", seccion:"biblioteca", titulo:"Manual de accesibilidad", curso:"General", tipo:"digital", modalidad:"consulta", estado:"publicado", detalle:"Recurso didáctico del centro. Sin archivo adjunto en este laboratorio." },
    { id:"LIB-001", seccion:"libros", titulo:"Programación paso a paso", curso:"DAW1", tipo:"fisico", modalidad:"cesion", estado:"disponible", detalle:"Aportado por A02. Edición de ensayo 2026. Buen estado." },
    { id:"LIB-002", seccion:"libros", titulo:"Bases de datos relacionales", curso:"DAW1", tipo:"fisico", modalidad:"intercambio", estado:"disponible", detalle:"Aportado por A03. Ambos propietarios deberán aceptar en la aplicación real." },
    { id:"LIB-003", seccion:"libros", titulo:"Diseño de interfaces", curso:"DAW2", tipo:"fisico", modalidad:"prestamo", estado:"prestado", detalle:"Aportado por A04. Debe devolverse antes de volver a estar disponible." },
    { id:"DOC-001", seccion:"documentacion", titulo:"Requisitos de inicio de DAW1", curso:"DAW1", tipo:"documento", modalidad:"descarga", estado:"publicado", version:2, detalle:"Documento formal del centro. Versión vigente de ensayo; sin archivo adjunto." },
    { id:"DOC-002", seccion:"documentacion", titulo:"Guía de prácticas de DAW2", curso:"DAW2", tipo:"documento", modalidad:"descarga", estado:"publicado", version:1, detalle:"Documentación del curso. No se tramitan solicitudes desde este laboratorio." },
    { id:"DOC-003", seccion:"documentacion", titulo:"Plantilla de solicitud de material", curso:"General", tipo:"documento", modalidad:"descarga", estado:"publicado", version:3, detalle:"Modelo formal del centro. La versión de ejemplo no contiene datos reales." }
  ];
  if (typeof module !== "undefined" && module.exports) module.exports = recursos;
  else raiz.recursosAula = recursos;
})(typeof globalThis !== "undefined" ? globalThis : this);
