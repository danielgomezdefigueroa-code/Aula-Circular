/* Funciones pequeñas: reciben datos y devuelven resultados, sin tocar la página. */
(function (raiz) {
  "use strict";
  function normalizar(texto) {
    return String(texto == null ? "" : texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }
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
  function validarSolicitud(datos, recursos) {
    const errores = {};
    const alumno = String(datos.alumno || "").trim().toUpperCase();
    if (!/^A(0[1-9]|10)$/.test(alumno)) errores.alumno = "Escribe un código ficticio entre A01 y A10.";
    const recurso = recursos.find(function (item) { return item.id === datos.recurso; });
    if (!recurso) errores.recurso = "Selecciona un material del catálogo.";
    else if (recurso.tipo !== "fisico" || recurso.estado !== "disponible") errores.recurso = "Elige un material físico disponible. Los documentos se consultan en su área.";
    if (String(datos.nota || "").trim().length > 160) errores.nota = "Resume la nota en 160 caracteres o menos.";
    if (datos.acuerdo !== true) errores.acuerdo = "Confirma que estás utilizando datos ficticios.";
    return { valido: Object.keys(errores).length === 0, errores:errores };
  }
  const api = { normalizar:normalizar, filtrar:filtrar, validarSolicitud:validarSolicitud };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.motorAula = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
