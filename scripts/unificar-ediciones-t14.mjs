/**
 * T14: presenta un único material por título/tipo/curso/categoría, con las
 * ediciones físicas desplegables dentro de SU MISMA tarjeta del catálogo.
 * No altera la API, migraciones ni los registros en PostgreSQL.
 *
 * Ejecutar en la raíz de AulaCircular:
 *   node scripts/unificar-ediciones-t14.mjs
 *
 * Repetible. Valida todas las modificaciones antes de escribir archivos.
 */
// Uso puntual: no es necesario ejecutarlo en instalaciones
// que ya incorporan los cambios definitivos de T14.
// No forma parte del arranque habitual de la aplicación.
import { readFile, writeFile } from 'node:fs/promises';

const rutaArea = 'public/mjs/area-catalogo.mjs';
const rutaCss = 'public/css/t14-inventario.css';
const marca = 'T14: UNA tarjeta por material, con ediciones dentro';

const helper = `  // ${marca}.
  // Cada edición sigue siendo una ficha distinta en PostgreSQL, con su ID.
  function crearTarjetasAgrupadas(items) {
    if (contexto !== 'Biblioteca') return items.map(crearTarjeta);

    const normalizarTitulo = titulo => String(titulo ?? '')
      .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
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

`;

function actualizarArea(original) {
  if (original.includes(marca)) return original;
  const inicio = original.indexOf('  // T14: las ediciones del mismo título son tarjetas NORMALES');
  const fin = original.indexOf('  function pintar() {', inicio);
  if (inicio < 0 || fin < inicio ||
      !original.slice(inicio, fin).includes('function crearTarjetasAgrupadas(items)') ||
      !original.includes('lista.replaceChildren(...crearTarjetasAgrupadas(resultado));')) {
    throw new Error('No encuentro la versión esperada de area-catalogo.mjs. No se ha modificado ningún archivo.');
  }
  return original.slice(0, inicio) + helper + original.slice(fin);
}

const cssExtra = `
/* T14: distintas ediciones como filas dentro de UNA tarjeta del catálogo. */
.t14-tarjeta-varias-ediciones .t14-contador-ediciones {
  margin: .55rem 0 .35rem;
  font-weight: 700;
}
.t14-tarjeta-varias-ediciones .t14-ediciones-lista {
  display: block;
  margin: .6rem 0 0;
  padding: 0;
  list-style: none;
}
.t14-tarjeta-varias-ediciones .t14-edicion {
  padding: .6rem .65rem;
  background: #f3f6f4;
  border: 1px solid #d0dcd4;
  border-radius: 6px;
  margin-top: .4rem;
}
.t14-tarjeta-varias-ediciones .t14-edicion-codigo {
  padding: .45rem .55rem;
  margin-top: .3rem;
  background: white;
  border: 1px solid #d0dcd4;
  border-radius: 6px;
  overflow-wrap: anywhere;
}
`;

function actualizarCss(original) {
  return original.includes('T14: distintas ediciones como filas dentro de UNA tarjeta')
    ? original : original.trimEnd() + '\n' + cssExtra;
}

const cambios = [];
for (const [ruta, transformar] of [[rutaArea, actualizarArea], [rutaCss, actualizarCss]]) {
  const anterior = await readFile(ruta, 'utf8');
  const eol = anterior.includes('\r\n') ? '\r\n' : '\n';
  const normalizado = anterior.replace(/\r\n/g, '\n');
  const corregido = transformar(normalizado);
  cambios.push({ ruta, anterior, corregido: eol === '\r\n' ? corregido.replace(/\n/g, '\r\n') : corregido });
}
for (const {ruta, anterior, corregido} of cambios) {
  if (anterior !== corregido) {
    await writeFile(ruta, corregido, 'utf8');
    console.log('Actualizado:', ruta);
  } else console.log('Sin cambios:', ruta);
}
console.log('T14: las ediciones aparecen en una sola tarjeta normal de Biblioteca.');
