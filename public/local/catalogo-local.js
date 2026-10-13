/* --- Catálogo de muestra con datos locales ---
    Módulo responsable de dibujar la lista de recursos en el DOM
    utilizando los datos de `datos.js` y las funciones de filtrado
    de `motor.js`.

    Flujo:
    1. Al cargar la página o cambiar un filtro, se llama a `dibujar()`.
    2. `dibujar()` obtiene los valores actuales de los filtros
       (selector de área, input de búsqueda, checkbox "solo disponibles").
    3. Llama a `motorAula.filtrar(recursosAula, opciones)` para obtener
       la lista reducida.
    4. Limpia la lista actual (`cont.replaceChildren()`) y vuelve a
       insertar cada recurso como una `<li class="tarjeta">`.
    5. Actualiza el contador `lab-cuenta` con la cantidad de recursos
       mostrados o un mensaje de "no hay coincidencias".

    Dependencias:
    - `datos.js` -> `recursosAula` (array de 13 recursos ficticios).
    - `motor.js` -> `motorAula.filtrar()`, `motorAula.normalizar()`.

    Selectores HTML esperados (debes tener estos elementos en index.html):
    - #lab-seccion   (select para filtrar por área)
    - #lab-busqueda  (input type="search" para texto)
    - #lab-disponibles (checkbox para filtrar disponibilidad)
    - #lab-catalogo  (ul donde se insertan las tarjetas)
    - #lab-cuenta    (p que muestra el mensaje de conteo). */
(function () {
  "use strict";

  /* --- Mapeos de texto ---
    Diccionarios que transforman los valores crudos de los recursos
    a textos de etiqueta, íconos y estados que se muestran en pantalla.
    Se usan para generar las insignias y la información de cada tarjeta. */
  const secciones = { biblioteca: "Biblioteca", libros: "Libros", documentacion: "Documentación" };
  const estados = { disponible: "Disponible", reservado: "Reservado", prestado: "Prestado", publicado: "Publicado" };
  const modalidades = { prestamo: "Préstamo", cesion: "Cesión", intercambio: "Intercambio", consulta: "Consulta", descarga: "Documento descargable" };

  /* --- porId(id) ---
    Atajo rápido para obtener un elemento del DOM por su ID.
    Usado ampliamente en la función dibujar() para referenciar
    los campos de los filtros. */
  const porId = (id) => document.getElementById(id);

  /* --- tipoTexto(r) ---
    Determina la etiqueta visual y la clase de la insigña
    en función del tipo y la sección del recurso.
    Devuelve un array [etiqueta, clase] que se usa en la tarjeta.
    Lógica:
    - físico + biblioteca -> "Préstamo físico" + clase "t-prestamo".
    - físico (otras secciones) -> "Anuncio estudiantil" + clase "t-anuncio".
    - cualquier otro tipo -> "Descarga digital" + clase "t-digital". */
  function tipoTexto(r) {
    if (r.tipo === "fisico" && r.seccion === "biblioteca") return ["Préstamo físico", "t-prestamo"];
    if (r.tipo === "fisico") return ["Anuncio estudiantil", "t-anuncio"];
    return ["Descarga digital", "t-digital"];
  }

  /* --- p(texto, clase) ---
    Crea un elemento <p> con el texto y clase indicados.
    Si se proporciona una clase, se le asigna; de lo contrário,
    el párrafo se crea sin clase adicional. */
  function p(texto, clase) {
    const e = document.createElement("p");
    e.textContent = texto;
    if (clase) e.className = clase;
    return e;
  }

  /* --- dibujar() ---
    Función principal: filtra los recursos según los filtros activos
    y vuelve a pintar la lista en el DOM.

    Pasos:
    1. Obtiene las opciones actuales del formulario:
       - seccion: valor del select #lab-seccion.
       - texto: valor del input #lab-busqueda.
       - soloDisponibles: estado del checkbox #lab-disponibles.
    2. Llama a `motorAula.filtrar(recursosAula, opciones)` para obtener
       la lista reducida.
    3. Vacía el contenedor actual (`cont.replaceChildren()`).
    4. Itera sobre la lista filtrada y, para cada recurso, crea:
       - Una <li class="tarjeta">
         - Etiqueta de área y curso (ej. "Biblioteca · DAW1").
         - Insigña de tipo (ej. "Préstamo físico", con clase correspondiente).
         - Título (h3).
         - Modalidad (ej. "Préstamo").
         - Estado (ej. "Disponible · Versión 2").
         - Detalle (texto descriptivo).
       - Lo añade al contenedor.
    5. Actualiza `#lab-cuenta` con un mensaje de éxito o de
       "no hay coincidencias", en función de si la lista está vacía. */
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

  /* --- Inicialización ---
    Al cargar el DOM, se añaden listeners a los elementos de filtro
    para que, al cambiar o teclear, se vuelva a llamar a `dibujar()`.
    También se llama a `dibujar()` una vez al inicio para pintar
    el catálogo con los filtros por defecto.
    Los eventos añadidos:
    - Cambio en #lab-seccion y #lab-disponibles: evento 'change'.
    - Input en #lab-busqueda: evento 'input' (se dispara mientras se escribe). */
  document.addEventListener("DOMContentLoaded", function () {
    ["lab-seccion", "lab-disponibles"].forEach((id) => porId(id).addEventListener("change", dibujar));
    porId("lab-busqueda").addEventListener("input", dibujar);
    dibujar();
  });
})();