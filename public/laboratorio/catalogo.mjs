// ============================================================
// CATÁLOGO DE RECURSOS - LABORATORIO
// ============================================================
// Cliente del catálogo: lee datos de la API; no contiene un catálogo fijo.
// Los tipos técnicos se convierten en nombres legibles para el usuario.
// Esta versión incluye: título, tipo, y botón "Ver ejemplares"
// con panel desplegable (igual que Biblioteca/T14), SIN contador de ejemplares.
// Importa pedir y leerJson desde shell.mjs (mismo origen que el resto de la app).
import { pedir, leerJson } from './shell.mjs';

const estado = document.querySelector('#estado');
const lista = document.querySelector('#recursos');
const formulario = document.querySelector('#filtro');
const busqueda = document.querySelector('#busqueda');
// Identifica la búsqueda más reciente para ignorar respuestas antiguas.
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

    // Convenciones de tipo y utilidades
    const nombresTipo = {
      fisico: 'Físico',
      digital: 'Digital',
      enlace: 'Enlace',
      estudiantil: 'Estudiantil'
    };

    function tipoTexto(tipo) {
      return nombresTipo[tipo] ?? tipo;
    }

    function parrafo(clase, texto) {
      const elemento = document.createElement('p');
      elemento.className = clase;
      elemento.textContent = texto;
      return elemento;
    }

    function crearTarjetaLaboratorio(recurso) {
      const tarjeta = document.createElement('li');
      tarjeta.className = 'tarjeta';

      const titulo = document.createElement('h2');
      titulo.textContent = recurso.titulo;

      const tipo = parrafo('etiqueta', 'Tipo: ' + tipoTexto(recurso.tipo));

      // Botón y panel de Ver ejemplares (patrón Biblioteca/T14, sin contador de ejemplares)
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'boton-sec';
      boton.textContent = 'Ver ejemplares';
      boton.setAttribute('aria-expanded', 'false');
      boton.dataset.verEjemplares = 'true';

      const zona = document.createElement('div');
      zona.className = 't14-detalle-ejemplares';
      zona.hidden = true;
      boton.setAttribute('aria-controls', 'zona-ejemplares-' + recurso.id);

      boton.addEventListener('click', async () => {
        if (!zona.hidden) {
          zona.hidden = true;
          boton.setAttribute('aria-expanded', 'false');
          boton.textContent = 'Ver ejemplares';
          return;
        }
        boton.disabled = true;
        try {
          const respuesta = await pedir('/api/recursos-demo/' + recurso.id);
          const cuerpo = await leerJson(respuesta);
          if (!respuesta.ok) throw new Error(cuerpo?.mensaje ?? 'No se pudieron consultar los ejemplares.');
          const lista = document.createElement('ul');
          lista.className = 't14-ediciones-lista';
          for (const e of (cuerpo?.datos?.ejemplares ?? [])) {
            const li = document.createElement('li');
            li.className = 't14-edicion';
            const codigo = document.createElement('p');
            codigo.className = 't14-edicion-codigo';
            codigo.textContent = e.codigo + ' · ' + (e.disponible ? 'Disponible' : e.estado_servicio === 'retirado' ? 'Retirado' : 'No disponible');
            li.append(codigo);
            if (!e.disponible) {
              const estadoP = document.createElement('p');
              estadoP.textContent = e.estado_servicio === 'retirado' ? 'Retirado' : 'No disponible';
              li.append(estadoP);
            }
            lista.append(li);
          }
          if (cuerpo?.datos?.ejemplares?.length === 0) {
            const vacio = document.createElement('p');
            vacio.textContent = 'Sin ejemplares físicos.';
            lista.append(vacio);
          }
          zona.replaceChildren(lista);
        } catch (error) {
          zona.textContent = error.message;
        } finally {
          zona.hidden = false;
          boton.disabled = false;
          boton.setAttribute('aria-expanded', 'true');
          boton.textContent = 'Ocultar ejemplares';
        }
      });

      tarjeta.append(titulo, tipo, boton, zona);
      return tarjeta;
    }

    for (const recurso of datos) {
      const tarjeta = crearTarjetaLaboratorio(recurso);
      lista.append(tarjeta);
    }

    estado.textContent = datos.length
      ? datos.length + ' recursos encontrados'
      : 'No se encontraron recursos. Cambia el área o el texto de búsqueda.';
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