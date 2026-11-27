/* Biblioteca integrada: filtros/paginación de Interfaz y funciones T14.
 * La API aplica filtros y devuelve una página de fichas individuales.
 */
import { listo, pedir, leerJson, irALogin } from './shell.mjs';
import {
  crearLineaEjemplar,
  crearTarjeta,
  puedeConsultar,
  textoError
} from './catalogo-comun.mjs';
import { cargarCursos } from './filtros-catalogo.mjs';
import { iniciarGestionInventario } from './gestion-inventario.mjs';

const formulario = document.querySelector('#filtros-biblioteca');
const busqueda = document.querySelector('#bib-q');
const tipo = document.querySelector('#bib-tipo');
const curso = document.querySelector('#bib-curso');
const disponibles = document.querySelector('#bib-disponible');
const lista = document.querySelector('#bib-lista');
const cuenta = document.querySelector('#bib-cuenta');
const paginacion = document.querySelector('#bib-paginacion');
const anterior = document.querySelector('#bib-anterior');
const siguiente = document.querySelector('#bib-siguiente');
const paginaTexto = document.querySelector('#bib-pagina');

const limite = 20;
let identidad = null;
let pagina = 1;
let total = 0;
let ultimaSolicitud = 0;
let cursosCargados = false;

function mostrar(texto, enfocar = false) {
  cuenta.textContent = texto ?? '';
  if (enfocar) cuenta.focus();
}

function hayFiltros() {
  return Boolean(busqueda.value.trim() || tipo.value || curso.value || disponibles.checked);
}

function parametros() {
  const parametros = new URLSearchParams();
  const texto = busqueda.value.trim();
  if (texto) parametros.set('q', texto);
  if (tipo.value) parametros.set('tipo', tipo.value);
  if (curso.value) parametros.set('curso', curso.value);
  if (disponibles.checked) parametros.set('disponible', '1');
  parametros.set('pagina', String(pagina));
  parametros.set('limite', String(limite));
  return parametros;
}

function actualizarPaginacion() {
  const paginas = Math.max(1, Math.ceil(total / limite));
  paginaTexto.textContent = 'Página ' + pagina + ' de ' + paginas;
  anterior.disabled = pagina <= 1 || total === 0;
  siguiente.disabled = pagina >= paginas || total === 0;
  paginacion.hidden = total === 0;
}

async function prepararCursos() {
  if (cursosCargados) return;
  try {
    await cargarCursos(curso, { general: true });
    cursosCargados = true;
  } catch {
    // Si falla /api/cursos, el filtro mantiene "Todos los cursos".
  }
}

// T14: una tarjeta por material si las fichas de la página son ediciones
// diferentes de un mismo recurso físico; cada edición sigue teniendo su ID.
function crearTarjetasAgrupadas(items) {
  const normalizarTitulo = titulo => String(titulo ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es').trim();

  // No unir títulos iguales si pertenecen a cursos, categorías o tipos diferentes.
  const clave = recurso => JSON.stringify([
    normalizarTitulo(recurso.titulo),
    recurso.tipo,
    recurso.curso ?? null,
    recurso.categoriaId ?? recurso.categoria ?? null
  ]);
  const materiales = new Map();
  for (const recurso of items) {
    const k = clave(recurso);
    if (!materiales.has(k)) materiales.set(k, []);
    materiales.get(k).push(recurso);
  }

  return [...materiales.values()].flatMap(fichas => {
    const ediciones = fichas.map(recurso => String(recurso.edicion ?? '').trim());
    const distintas = ediciones.every(Boolean) &&
      new Set(ediciones.map(edicion => edicion.toLocaleLowerCase('es'))).size === fichas.length;
    if (fichas.length < 2 || !distintas || fichas[0].tipo !== 'fisico') {
      return fichas.map(crearTarjeta);
    }
    return [crearTarjetaConEdiciones(fichas)];
  });
}

function crearTarjetaConEdiciones(fichas) {
  const totalEjemplares = fichas.reduce((n, r) => n + (Number(r.total_ejemplares) || 0), 0);
  const ejemplaresDisponibles = fichas.reduce((n, r) => n + (Number(r.ejemplares_disponibles) || 0), 0);
  const base = fichas[0];

  const tarjeta = crearTarjeta({
    ...base,
    edicion: null,
    isbn: null,
    codigo: null,
    codigos: [],
    detalle: 'Material de estudio con distintas ediciones.',
    total_ejemplares: totalEjemplares,
    ejemplares_disponibles: ejemplaresDisponibles,
    estado: ejemplaresDisponibles > 0 ? 'disponible' : 'no disponible'
  });
  tarjeta.classList.add('t14-tarjeta-varias-ediciones');

  // La consulta de una ficha no representaría todas las ediciones del grupo.
  tarjeta.querySelector('button[data-ver-ejemplares]')?.remove();
  tarjeta.querySelector('[data-lista-ejemplares]')?.remove();

  const contador = document.createElement('p');
  contador.className = 't14-contador-ediciones';
  contador.textContent = fichas.length + ' ediciones del mismo material';

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton-sec';
  boton.textContent = 'Ver ediciones';
  boton.setAttribute('aria-expanded', 'false');
  boton.dataset.verEdiciones = 'true';

  const zona = document.createElement('div');
  zona.id = 't14-ediciones-' + base.id;
  zona.className = 't14-detalle-ejemplares t14-ediciones-detalle';
  zona.hidden = true;
  boton.setAttribute('aria-controls', zona.id);

  boton.addEventListener('click', async () => {
    if (!zona.hidden) {
      zona.hidden = true;
      boton.setAttribute('aria-expanded', 'false');
      boton.textContent = 'Ver ediciones';
      return;
    }

    boton.disabled = true;
    try {
      const ediciones = await Promise.all(fichas.map(async ficha => {
        const respuesta = await pedir('/biblioteca/' + ficha.id);
        const cuerpo = await leerJson(respuesta);
        if (!respuesta.ok) {
          throw new Error(cuerpo?.mensaje ?? 'No se pudieron consultar los ejemplares.');
        }
        return { ficha, copias: cuerpo?.datos?.ejemplares ?? [] };
      }));

      const elementos = document.createElement('ul');
      elementos.className = 't14-ediciones-lista';
      ediciones.sort((a, b) => a.ficha.edicion.localeCompare(b.ficha.edicion, 'es', { numeric: true }));

      for (const { ficha, copias } of ediciones) {
        const fila = document.createElement('li');
        fila.className = 't14-edicion';
        const titulo = document.createElement('strong');
        titulo.textContent = 'Edición ' + ficha.edicion;
        fila.append(titulo);

        const cantidad = document.createElement('p');
        const libres = copias.filter(copia => copia.disponible).length;
        cantidad.textContent = libres + ' de ' + copias.length + ' ' +
          (copias.length === 1 ? 'ejemplar disponible' : 'ejemplares disponibles');
        fila.append(cantidad);

        for (const copia of copias) {
          fila.append(crearLineaEjemplar(copia, identidad, mostrar, () => cargar()));
        }
        if (copias.length === 0) {
          const vacio = document.createElement('p');
          vacio.textContent = 'Sin ejemplares físicos.';
          fila.append(vacio);
        }
        elementos.append(fila);
      }
      zona.replaceChildren(elementos);
    } catch (error) {
      zona.textContent = error.message;
    } finally {
      zona.hidden = false;
      boton.disabled = false;
      boton.setAttribute('aria-expanded', 'true');
      boton.textContent = 'Ocultar ediciones';
    }
  });

  tarjeta.append(contador, boton, zona);
  return tarjeta;
}

async function cargar(aviso = null) {
  if (!puedeConsultar(identidad)) {
    ++ultimaSolicitud; // Invalidar respuestas de una sesión anterior.
    total = 0;
    lista.replaceChildren();
    lista.setAttribute('aria-busy', 'false');
    paginacion.hidden = true;
    mostrar(identidad
      ? 'Necesitas una cuenta activa de alumnado o docencia para consultar Biblioteca.'
      : '');
    return;
  }

  const solicitud = ++ultimaSolicitud;
  lista.setAttribute('aria-busy', 'true');
  anterior.disabled = true;
  siguiente.disabled = true;
  mostrar('Cargando…');

  try {
    const respuesta = await pedir('/biblioteca?' + parametros().toString());
    const cuerpo = await leerJson(respuesta);
    if (solicitud !== ultimaSolicitud) return;

    if (respuesta.status === 401) {
      irALogin();
      return;
    }
    if (!respuesta.ok) {
      // Un rechazo no debe borrar lo que ya se estaba viendo. Si el curso ya
      // no vale, se quita del filtro y se repite la consulta para que los
      // controles y los resultados sigan diciendo lo mismo.
      if (cuerpo?.error === 'CURSO_NO_DISPONIBLE') {
        curso.value = '';
        await cargar(textoError(respuesta, cuerpo, 'Biblioteca'));
        return;
      }
      actualizarPaginacion();
      // Un 422 de filtros apunta al buscador: se marca el campo y se lleva allí.
      const filtroInvalido = respuesta.status === 422 && cuerpo?.error === 'PARAMETROS_INVALIDOS';
      if (filtroInvalido) {
        busqueda.setAttribute('aria-invalid', 'true');
        busqueda.focus();
      }
      mostrar(textoError(respuesta, cuerpo, 'Biblioteca'), !filtroInvalido);
      return;
    }

    busqueda.removeAttribute('aria-invalid');

    const datos = Array.isArray(cuerpo?.datos) ? cuerpo.datos : [];
    total = Number.isSafeInteger(cuerpo?.total) ? cuerpo.total : datos.length;
    const paginas = Math.max(1, Math.ceil(total / limite));
    if (pagina > paginas) {
      pagina = paginas;
      await cargar(aviso);
      return;
    }
    lista.replaceChildren(...crearTarjetasAgrupadas(datos));

    if (total === 0) {
      mostrar(aviso ?? (hayFiltros()
        ? 'No hay recursos que coincidan con los filtros. Cambia o limpia los filtros para ver más recursos.'
        : 'No hay recursos de biblioteca disponibles. Vuelve más tarde o consulta Libros.'));
    } else {
      mostrar(aviso ?? (total === 1 ? '1 recurso encontrado.' : total + ' recursos encontrados.'));
    }
    actualizarPaginacion();
  } catch {
    if (solicitud !== ultimaSolicitud) return;
    actualizarPaginacion();
    mostrar('No se pudo contactar con el servidor. Inténtalo de nuevo.');
  } finally {
    if (solicitud === ultimaSolicitud) lista.setAttribute('aria-busy', 'false');
  }
}

formulario.addEventListener('submit', evento => {
  evento.preventDefault();
  pagina = 1;
  void cargar();
});

formulario.addEventListener('reset', () => {
  setTimeout(() => {
    pagina = 1;
    void cargar();
  }, 0);
});

anterior.addEventListener('click', () => {
  if (pagina > 1) {
    pagina -= 1;
    void cargar();
  }
});

siguiente.addEventListener('click', () => {
  const paginas = Math.max(1, Math.ceil(total / limite));
  if (pagina < paginas) {
    pagina += 1;
    void cargar();
  }
});

// Gestion-inventario.mjs emite este evento al crear, editar o añadir ejemplares.
document.addEventListener('aula:inventario-actualizado', () => {
  if (identidad) void cargar();
});

document.addEventListener('aula:sesion', async evento => {
  identidad = evento.detail;
  if (!identidad) {
    await cargar();
    return;
  }
  pagina = 1;
  await prepararCursos();
  await cargar();
});

// También registra el delegado de clicks para "Ver ejemplares" de T14.
await iniciarGestionInventario();
identidad = await listo;
if (identidad) {
  await prepararCursos();
  await cargar();
}
