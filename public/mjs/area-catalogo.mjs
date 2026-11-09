
/* Catálogo: consulta la API y permite filtrar los recursos autorizados. */
import { listo, pedir, leerJson, irALogin } from './shell.mjs';
import {
  crearTarjeta,
  puedeConsultar,
  textoError,
  filtrar
} from './catalogo-comun.mjs';

export async function iniciarArea({ ruta, vacio, contexto }) {
  const lista = document.querySelector('.area-lista');
  const mensaje = document.querySelector('.area-estado');
  const buscador = document.querySelector('#buscar-catalogo');
  const selectorCurso = document.querySelector('#curso-catalogo');

  let identidad = null;
  let recursos = [];

  function mostrar(texto) {
    mensaje.textContent = texto ?? '';
  }

  function actualizarCursos() {
    if (!selectorCurso) return;

    const anterior = selectorCurso.value;
    selectorCurso.replaceChildren();

    function opcion(valor, etiqueta) {
      const elemento = document.createElement('option');
      elemento.value = valor;
      elemento.textContent = etiqueta;
      selectorCurso.append(elemento);
    }

    const esDocumentacion = contexto === 'Documentación';
    opcion(
      'todos',
      esDocumentacion ? 'Todos los documentos' : 'Todos los recursos'
    );

    opcion(
      'general',
      esDocumentacion ? 'Documentación general' : 'Sin curso asignado'
    );

    const cursos = [...new Set(
      recursos.map(recurso => recurso.curso).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'es'));

    for (const curso of cursos) {
      opcion(curso, curso);
    }

    if ([...selectorCurso.options].some(o => o.value === anterior)) {
      selectorCurso.value = anterior;
    }
  }

  function pintar() {
    const texto = buscador?.value ?? '';
    const curso = selectorCurso?.value ?? 'todos';

    const resultado = filtrar(recursos, { texto }).filter(recurso => {
      if (curso === 'todos') return true;
      if (curso === 'general') return !recurso.curso;
      return recurso.curso === curso;
    });

    lista.replaceChildren(...resultado.map(crearTarjeta));

    mostrar(
      resultado.length
        ? `${resultado.length} ${resultado.length === 1 ? 'recurso' : 'recursos'}`
        : recursos.length
          ? 'No hay resultados para estos filtros.'
          : vacio
    );
  }

  async function cargar() {
    if (!puedeConsultar(identidad)) {
      recursos = [];
      lista.replaceChildren();
      mostrar(
        identidad
          ? `Necesitas una cuenta activa para consultar ${contexto}.`
          : ''
      );
      return;
    }

    lista.replaceChildren();
    mostrar('Cargando…');

    const respuesta = await pedir(ruta);
    const cuerpo = await leerJson(respuesta);

    if (respuesta.status === 401) {
      irALogin();
      return;
    }

    if (!respuesta.ok) {
      mostrar(textoError(respuesta, cuerpo, contexto));
      return;
    }

    recursos = Array.isArray(cuerpo?.datos) ? cuerpo.datos : [];

    actualizarCursos();
    pintar();
  }

  buscador?.addEventListener('input', pintar);
  selectorCurso?.addEventListener('change', pintar);

  document.addEventListener('aula:sesion', async evento => {
    identidad = evento.detail;
    try {
      await cargar();
    } catch (error) {
      mostrar(error.message);
    }
  });

  try {
    identidad = await listo;
    if (identidad) await cargar();
  } catch (error) {
    mostrar(error.message);
  }
}
