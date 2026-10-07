// Cliente del catálogo: lee datos de la API; no contiene un catálogo fijo.
// Estos selectores corresponden a los id de index.html.
const estado = document.querySelector('#estado');
const lista = document.querySelector('#recursos');
const formulario = document.querySelector('#filtro');
const busqueda = document.querySelector('#busqueda');
// Identifica la búsqueda más reciente para ignorar respuestas antiguas.
// No cancela las peticiones HTTP anteriores.
let peticionActual = 0;

/** Consulta el título indicado y actualiza las tarjetas y el mensaje de estado. */
async function cargarRecursos(texto = '') {
  const numeroPeticion = ++peticionActual;
  estado.textContent = 'Cargando…';
  // Elimina tarjetas de la búsqueda anterior, incluso si la nueva falla.
  lista.replaceChildren();

  try {
    // Codifica q correctamente en la URL (espacios, acentos y símbolos).
    const parametros = new URLSearchParams({ q: texto });
    const respuesta = await fetch('/api/recursos-demo?' + parametros);
    // fetch no rechaza automáticamente respuestas HTTP 404 o 500.
    if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);

    const { datos } = await respuesta.json();
    // Solo la búsqueda más reciente puede cambiar la pantalla.
    if (numeroPeticion !== peticionActual) return;

    for (const recurso of datos) {
      const tarjeta = document.createElement('li');
      const titulo = document.createElement('h2');
      const tipo = document.createElement('p');

      // textContent muestra datos como texto, sin interpretarlos como HTML.
      titulo.textContent = recurso.titulo;
      tipo.textContent = 'Tipo: ' + recurso.tipo;
      tarjeta.append(titulo, tipo);
      lista.append(tarjeta);
    }

    estado.textContent = datos.length
      ? datos.length + ' recursos encontrados'
      : 'No se encontraron recursos.';
  } catch {
    // Solo la búsqueda más reciente puede cambiar la pantalla.
    if (numeroPeticion !== peticionActual) return;
    estado.textContent =
      'No se pudieron cargar los recursos. Recarga tras revisar el servidor.';
  }
}

// Buscar con el botón o Enter no recarga toda la página.
formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  cargarRecursos(busqueda.value.trim());
});

// Carga inicial: búsqueda vacía para mostrar todos los recursos.
cargarRecursos();