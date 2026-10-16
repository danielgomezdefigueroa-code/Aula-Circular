/* --- Muestra de las páginas de área con datos locales (andamio) ---
    Pinta en .area-lista los recursos de ejemplo de la sección de esta
    página, con el mismo formato de tarjeta que el catálogo de muestra
    del index. Es un script clásico, como el resto de la carpeta local/:
    así se ve también al abrir la página como archivo, sin servidor.

    Es temporal. Cómo funciona:
    - la página indica su área en data-muestra del <ul class="area-lista">;
    - los recursos vienen de datos.js (global recursosAula), datos ficticios;
    - se pinta al cargar el DOM y se repinta cuando el shell avisa tras
      recomprobar la sesión ('aula:sesion'), porque antes vacía las listas.
    Los datos son de laboratorio: no autorizan nada, la API decidirá el
    acceso real en el paso siguiente.

    Cómo se retira: borrar este archivo y, en las tres páginas, las
    etiquetas <script> de ../local/datos.js y de este archivo. */
(function (raiz) {
  "use strict";

  // Mismos textos y clases que catalogo-local.js, para que las tarjetas
  // se vean igual que el catálogo de muestra del index.
  const SECCIONES = { biblioteca: "Biblioteca", libros: "Libros", documentacion: "Documentación" };
  const ESTADOS = { disponible: "Disponible", reservado: "Reservado", prestado: "Prestado", publicado: "Publicado" };
  const MODALIDADES = { prestamo: "Préstamo", cesion: "Cesión", intercambio: "Intercambio", consulta: "Consulta", descarga: "Documento descargable" };

  function tipoTexto(recurso) {
    if (recurso.tipo === "fisico" && recurso.seccion === "biblioteca") return ["Préstamo físico", "t-prestamo"];
    if (recurso.tipo === "fisico") return ["Anuncio estudiantil", "t-anuncio"];
    return ["Descarga digital", "t-digital"];
  }

  function parrafo(texto, clase) {
    const p = document.createElement("p");
    p.textContent = texto;
    if (clase) p.className = clase;
    return p;
  }

  function pintar() {
    const lista = document.querySelector(".area-lista[data-muestra]");
    if (!lista) return;
    const aviso = document.querySelector(".area-estado");
    const recursos = (raiz.recursosAula ?? []).filter((r) => r.seccion === lista.dataset.muestra);
    lista.replaceChildren();
    for (const recurso of recursos) {
      const [texto, clase] = tipoTexto(recurso);
      const titulo = document.createElement("h3");
      titulo.textContent = recurso.titulo;
      const tarjeta = document.createElement("li");
      tarjeta.className = "tarjeta";
      tarjeta.append(
        parrafo(SECCIONES[recurso.seccion] + " · " + recurso.curso, "etiqueta"),
        parrafo(texto, "insignia " + clase),
        titulo,
        parrafo(MODALIDADES[recurso.modalidad]),
        parrafo(ESTADOS[recurso.estado] + (recurso.version ? " · Versión " + recurso.version : ""), "estado"),
        parrafo(recurso.detalle)
      );
      lista.append(tarjeta);
    }
    if (aviso) {
      aviso.textContent = recursos.length
        ? recursos.length + (recursos.length === 1 ? " recurso de muestra" : " recursos de muestra")
        : "No hay recursos de muestra en esta área.";
    }
  }

  document.addEventListener("DOMContentLoaded", pintar);
  // El shell vacía las listas antes de recomprobar la sesión (por ejemplo,
  // al volver atrás); se repinta cuando termina la comprobación.
  document.addEventListener("aula:sesion", pintar);
})(typeof globalThis !== "undefined" ? globalThis : this);
