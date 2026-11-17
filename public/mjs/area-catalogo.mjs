
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

  // T14: UNA tarjeta por material, con ediciones dentro.
  // Cada edición sigue siendo una ficha distinta en PostgreSQL, con su ID.
  function crearTarjetasAgrupadas(items) {
    if (contexto !== 'Biblioteca') return items.map(crearTarjeta);

    const normalizarTitulo = titulo => String(titulo ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es').trim();

    // No fusionar materiales de cursos, categorías o tipos distintos.
    const clave = r => JSON.stringify([
      normalizarTitulo(r.titulo), r.tipo, r.curso ?? null,
      r.categoriaId ?? r.categoria ?? null
    ]);
    const porMaterial = new Map();
    for (const recurso of items) {
      const k = clave(recurso);
      if (!porMaterial.has(k)) porMaterial.set(k, []);
      porMaterial.get(k).push(recurso);
    }

    return [...porMaterial.values()].flatMap(fichas => {
      const ediciones = fichas.map(r => String(r.edicion ?? '').trim());
      const distintas = ediciones.every(Boolean) &&
        new Set(ediciones.map(e => e.toLocaleLowerCase('es'))).size === fichas.length;
      if (fichas.length < 2 || !distintas || fichas[0].tipo !== 'fisico') {
        return fichas.map(crearTarjeta);
      }
      return [crearTarjetaConEdiciones(fichas)];
    });
  }

  function crearTarjetaConEdiciones(fichas) {
    const total = fichas.reduce((n, r) => n + (Number(r.total_ejemplares) || 0), 0);
    const disponibles = fichas.reduce((n, r) => n + (Number(r.ejemplares_disponibles) || 0), 0);
    const base = fichas[0];

    // Reutilizar la misma tarjeta que los demás materiales.
    // El total es la suma de copias de todas las ediciones.
    const tarjeta = crearTarjeta({
      ...base,
      edicion: null,
      detalle: 'Material de estudio con distintas ediciones.',
      total_ejemplares: total,
      ejemplares_disponibles: disponibles,
      estado: disponibles > 0 ? 'disponible' : 'no disponible'
    });
    tarjeta.classList.add('t14-tarjeta-varias-ediciones');

    // El botón de una sola ficha consultaría solo una edición: sustituirlo.
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
        // Consultar el detalle por ID para obtener todos los códigos reales,
        // no solo el primero que aparece en el resumen del catálogo.
        const ediciones = await Promise.all(fichas.map(async ficha => {
          const respuesta = await pedir('/biblioteca/' + ficha.id);
          const cuerpo = await leerJson(respuesta);
          if (!respuesta.ok) throw new Error(cuerpo?.mensaje ?? 'No se pudieron consultar los ejemplares.');
          return { ficha, copias: cuerpo?.datos?.ejemplares ?? [] };
        }));

        const lista = document.createElement('ul');
        lista.className = 't14-ediciones-lista';
        ediciones.sort((a, b) => a.ficha.edicion.localeCompare(b.ficha.edicion, 'es', { numeric: true }));

        for (const { ficha, copias } of ediciones) {
          const fila = document.createElement('li');
          fila.className = 't14-edicion';

          const titulo = document.createElement('strong');
          titulo.textContent = 'Edición ' + ficha.edicion;
          fila.append(titulo);

          const cantidad = document.createElement('p');
          const libres = copias.filter(e => e.disponible).length;
          cantidad.textContent = libres + ' de ' + copias.length + ' ' +
            (copias.length === 1 ? 'ejemplar disponible' : 'ejemplares disponibles');
          fila.append(cantidad);

          for (const copia of copias) {
            const codigo = document.createElement('p');
            codigo.className = 't14-edicion-codigo';
            codigo.textContent = copia.codigo + ' · ' +
              (copia.disponible ? 'Disponible' : copia.estado_servicio === 'retirado' ? 'Retirado' : 'No disponible');
            fila.append(codigo);
          }
          if (copias.length === 0) {
            const vacio = document.createElement('p');
            vacio.textContent = 'Sin ejemplares físicos.';
            fila.append(vacio);
          }
          lista.append(fila);
        }
        zona.replaceChildren(lista);
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

  function pintar() {
    const texto = buscador?.value ?? '';
    const curso = selectorCurso?.value ?? 'todos';

    const resultado = filtrar(recursos, { texto }).filter(recurso => {
      if (curso === 'todos') return true;
      if (curso === 'general') return !recurso.curso;
      return recurso.curso === curso;
    });

    lista.replaceChildren(...crearTarjetasAgrupadas(resultado));

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

  document.addEventListener('aula:inventario-actualizado', () => {
    if (identidad) cargar().catch(error => mostrar(error.message));
  });

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
