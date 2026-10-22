/* Página de área que solo lista los recursos que devuelve su API. */
import { listo, pedir, leerJson, irALogin } from './shell.mjs';
import { crearTarjeta, puedeConsultar, textoError } from './catalogo-comun.mjs';

export async function iniciarArea({ ruta, vacio, contexto }) {
  const lista = document.querySelector('.area-lista');
  const mensaje = document.querySelector('.area-estado');
  let identidad = null;

  function mostrar(texto) {
    mensaje.textContent = texto ?? '';
  }

  async function cargar() {
    if (!puedeConsultar(identidad)) {
      lista.replaceChildren();
      mostrar(identidad
        ? 'Necesitas una cuenta activa de alumnado o docencia para consultar ' + contexto + '.'
        : '');
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

    const datos = Array.isArray(cuerpo?.datos) ? cuerpo.datos : [];
    lista.replaceChildren(...datos.map(crearTarjeta));
    mostrar(datos.length ? datos.length + (datos.length === 1 ? ' recurso' : ' recursos') : vacio);
  }

  document.addEventListener('aula:sesion', async (evento) => {
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
