/* Carga los cursos activos en un select de filtros.
   La API pública /api/cursos devuelve { id, codigo, nombre }. */
import { pedir, leerJson } from './shell.mjs';

export async function cargarCursos(select, { general = false, todos = 'Todos los cursos' } = {}) {
  if (!select) return;
  const valorAnterior = select.value;
  const respuesta = await pedir('/cursos');
  const cuerpo = await leerJson(respuesta);
  if (!respuesta.ok || !Array.isArray(cuerpo?.datos)) {
    throw new Error('No se pudieron cargar los cursos.');
  }

  const opciones = [new Option(todos, '')];
  if (general) opciones.push(new Option('General (sin curso)', 'general'));
  for (const curso of cuerpo.datos) {
    if (!Number.isSafeInteger(curso.id) || typeof curso.nombre !== 'string') continue;
    opciones.push(new Option(curso.nombre, String(curso.id)));
  }

  select.replaceChildren(...opciones);
  if ([...select.options].some((opcion) => opcion.value === valorAnterior)) {
    select.value = valorAnterior;
  }
}
