/* --- Motor de funciones auxiliares para Aula Circular ---
    Este módulo agrupa pequeñas funciones puras que reciben datos
    y devuelven resultados sin tocar la página DOM.
    Está organizado en tres funciones principales:
    1. normalizar()   -> limpia y compara textos.
    2. filtrar()     -> selecciona recursos según opciones.
    3. validarSolicitud() -> valida datos de una solicitud de cesión/préstamo.
    Todas las funciones se exponen mediante un objeto `api` al final
    del IIFE, accesible globalmente como `raiz.motorAula`. */
(function (raiz) {
  "use strict";

  /* --- normalizar(texto) ---
    Limpia un string para compararlo sin acentos y en minúsculas.
    Elimina signos diacríticos (NFD) y recorta espacios.
    Útil para búsquedas que deben ignorar diferencias de formato. */
  function normalizar(texto) {
    return String(texto == null ? "" : texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  /* --- filtrar(recursos, opciones) ---
    Recibe un array de recursos y un objeto de opciones.
    Devuelve un array filtrado según tres criterios:
    - seccion: filtro por área (biblioteca, libros, documentación o "todas").
    - texto: búsqueda por título o curso (coincidencia parcial).
    - soloDisponibles: si solo mostrar recursos con estado "disponible" o "publicado".
    Lógica: un recurso debe pasar los tres filtros para aparecer en la lista. */
  function filtrar(recursos, opciones) {
    const seccion = opciones.seccion || "todas";
    const texto = normalizar(opciones.texto);
    return recursos.filter(function (recurso) {
      const enSeccion = seccion === "todas" || recurso.seccion === seccion;
      const coincide = normalizar(recurso.titulo + " " + recurso.curso).includes(texto);
      const disponible = !opciones.soloDisponibles || ["disponible", "publicado"].includes(recurso.estado);
      return enSeccion && coincide && disponible;
    });
  }

  /* --- validarSolicitud(datos, recursos) ---
    Valida un formulario de solicitud (cesión, préstamo o intercambio).
    Recibe un objeto con los datos del formulario y el array de recursos
    disponibles. Devuelve un objeto con:
    - valido: true si no hay errores.
    - errores: objeto clave-valor con los mensajes de error.
    Reglas de validación:
    - alumno: debe ser un código ficticio entre A01 y A10.
    - recurso: debe existir en el catálogo y ser físico y disponible.
    - nota: máximo 160 caracteres.
    - acuerdo: debe confirmarse que se usan datos ficticios. */
  function validarSolicitud(datos, recursos) {
    const errores = {};
    const alumno = String(datos.alumno || "").trim().toUpperCase();
    if (!/^A(0[1-9]|10)$/.test(alumno)) errores.alumno = "Escribe un código ficticio entre A01 y A10.";
    const recurso = recursos.find(function (item) { return item.id === datos.recurso; });
    if (!recurso) errores.recurso = "Selecciona un material del catálogo.";
    else if (recurso.tipo !== "fisico" || recurso.estado !== "disponible") errores.recurso = "Elige un material físico disponible. Los documentos se consultan en su área.";
    if (String(datos.nota || "").trim().length > 160) errores.nota = "Resume la nota en 160 caracteres o menos.";
    if (datos.acuerdo !== true) errores.acuerdo = "Confirma que estás utilizando datos ficticios.";
    return { valido: Object.keys(errores).length === 0, errores: errores };
  }

  /* --- Exponer la API ---
    Agrupa las tres funciones anteriores en un objeto que se
    exporta al ámbito global. Permite su uso en otros módulos
    (ej. catalogo-local.js) mediante `motorAula.filtrar()` o
    `motorAula.validarSolicitud()`. */
  const api = { normalizar: normalizar, filtrar: filtrar, validarSolicitud: validarSolicitud };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.motorAula = api;
})(typeof globalThis !== "undefined" ? globalThis : this);