// ============================================================
// CONVERSIÓN DEL TIPO TÉCNICO A UN TEXTO MÁS LEGIBLE
// ============================================================


const estado = document.querySelector('#estado');
const lista = document.querySelector('#recursos');
const formulario = document.querySelector('#filtro');
const busqueda = document.querySelector('#busqueda');
let peticionActual = 0;

async function cargarRecursos(texto = '') {
  const numeroPeticion = ++peticionActual;
  estado.textContent = 'Cargando…';
  lista.replaceChildren();

  try {
    const parametros = new URLSearchParams({ q: texto });
    const respuesta = await fetch('/api/recursos-demo?' + parametros);
    if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);

    const { datos } = await respuesta.json();
    if (numeroPeticion !== peticionActual) return;

    for (const recurso of datos) {
      const tarjeta = document.createElement('li');
      const titulo = document.createElement('h2');
      const tipo = document.createElement('p');

      titulo.textContent = recurso.titulo;

      /** Cambio debido a la tarea 2 del equipo Biblioteca y Documentos */
      /** tipo.textContent = 'Tipo: ' + recurso.tipo; */
     
      // El servidor devuelve los tipos en formato interno:
      // 'fisico', 'digital', 'enlace' o 'estudiantil'.
      //
      // Creamos un objeto para mostrar esos valores
      // de una forma más clara para el usuario.
      const nombresTipo = {
        fisico: 'Físico',
        digital: 'Digital',
        enlace: 'Enlace',
        estudiantil: 'Estudiantil'
      };

      // Mostramos el nombre correspondiente al tipo del recurso.
      // Si por algún motivo aparece un tipo no definido,
      // mostramos directamente el valor recibido.
      tipo.textContent =
      'Tipo: ' + (nombresTipo[recurso.tipo] ?? recurso.tipo);

      tarjeta.append(titulo, tipo);
      lista.append(tarjeta);
    }

    estado.textContent = datos.length
      ? datos.length + ' recursos encontrados'
      : 'No se encontraron recursos.';
  } catch {
    if (numeroPeticion !== peticionActual) return;
    estado.textContent =
      'No se pudieron cargar los recursos. Recarga tras revisar el servidor.';
  }
}

formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  cargarRecursos(busqueda.value.trim());
});

cargarRecursos();