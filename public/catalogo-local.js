/* Catálogo de muestra con datos locales (datos.js) y filtro (motor.js). */
(function () {
  "use strict";
  const secciones = { biblioteca: "Biblioteca", libros: "Libros", documentacion: "Documentación" };
  const estados = { disponible: "Disponible", reservado: "Reservado", prestado: "Prestado", publicado: "Publicado" };
  const modalidades = { prestamo: "Préstamo", cesion: "Cesión", intercambio: "Intercambio", consulta: "Consulta", descarga: "Documento descargable" };
  const porId = (id) => document.getElementById(id);

  function tipoTexto(r) {
    if (r.tipo === "fisico" && r.seccion === "biblioteca") return ["Préstamo físico", "t-prestamo"];
    if (r.tipo === "fisico") return ["Anuncio estudiantil", "t-anuncio"];
    return ["Descarga digital", "t-digital"];
  }
  function p(texto, clase) {
    const e = document.createElement("p");
    e.textContent = texto;
    if (clase) e.className = clase;
    return e;
  }
  function dibujar() {
    const lista = motorAula.filtrar(recursosAula, {
      seccion: porId("lab-seccion").value,
      texto: porId("lab-busqueda").value,
      soloDisponibles: porId("lab-disponibles").checked
    });
    const cont = porId("lab-catalogo");
    cont.replaceChildren();
    lista.forEach(function (r) {
      const [etiqueta, clase] = tipoTexto(r);
      const li = document.createElement("li");
      li.className = "tarjeta";
      const h3 = document.createElement("h3");
      h3.textContent = r.titulo;
      li.append(
        p(secciones[r.seccion] + " · " + r.curso, "etiqueta"),
        p(etiqueta, "insignia " + clase),
        h3,
        p(modalidades[r.modalidad]),
        p(estados[r.estado] + (r.version ? " · Versión " + r.version : ""), "estado"),
        p(r.detalle)
      );
      cont.append(li);
    });
    porId("lab-cuenta").textContent = lista.length
      ? lista.length + (lista.length === 1 ? " recurso encontrado" : " recursos encontrados")
      : "No hay coincidencias. Prueba otra búsqueda o quita un filtro.";
  }
  document.addEventListener("DOMContentLoaded", function () {
    ["lab-seccion", "lab-disponibles"].forEach((id) => porId(id).addEventListener("change", dibujar));
    porId("lab-busqueda").addEventListener("input", dibujar);
    dibujar();
  });
})();
