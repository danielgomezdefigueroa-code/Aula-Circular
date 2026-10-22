/* --- Libros publicados ---
    Lista los anuncios aprobados por docencia. La API decide el acceso:
    hace falta una sesión activa con rol alumno o docente. */
import { listo, pedir, enviar, leerJson } from './shell.mjs';
import { crearTarjeta, normalizarLibro } from './catalogo-comun.mjs';

const mensaje = document.querySelector('#mensaje');
const lista = document.querySelector('#libros');
const anterior = document.querySelector('#anterior');
const siguiente = document.querySelector('#siguiente');
const paginaTexto = document.querySelector('#pagina');

let pagina = 1;
let identidad = null;

function mostrar(texto, enfocar = false) {
  mensaje.textContent = texto ?? '';
  if (enfocar) mensaje.focus();
}

function puedeConsultar(datos) {
  if (!datos || datos.estado !== 'activo' || !Array.isArray(datos.roles)) return false;
  return datos.roles.some((rol) => rol === 'alumno' || rol === 'docente');
}

function textoError(respuesta, cuerpo) {
  if (respuesta.status === 401) return 'Inicia sesión en Mi espacio para consultar Libros.';
  if (respuesta.status === 403) return 'Necesitas una cuenta activa de alumnado o docencia para consultar Libros.';
  return cuerpo?.mensaje ?? cuerpo?.error ?? 'No se pudo completar la consulta.';
}

async function cargar() {
  anterior.disabled = true;
  siguiente.disabled = true;
  lista.replaceChildren();
  const respuesta = await pedir('/libros?' + new URLSearchParams({ pagina, limite: 20 }));
  const cuerpo = await leerJson(respuesta);
  if (!respuesta.ok) throw new Error(textoError(respuesta, cuerpo));

  const datos = Array.isArray(cuerpo?.datos) ? cuerpo.datos : [];
  paginaTexto.textContent = 'Página ' + pagina;
  anterior.disabled = pagina === 1;
  siguiente.disabled = datos.length < 20;
  mostrar(datos.length
    ? 'Anuncios publicados:'
    : 'Todavía no hay anuncios publicados en esta página.');

  lista.replaceChildren(...datos.map((anuncio) =>
    (() => {
      const tarjeta=crearTarjeta(normalizarLibro(anuncio));
      const estado=document.createElement('p');estado.textContent=anuncio.disponible?'Disponible':'Reservado';tarjeta.append(estado);
      if(anuncio.modalidad==='cesion'&&anuncio.disponible&&identidad?.roles.includes('alumno')){
        const boton=document.createElement('button');boton.textContent='Solicitar cesión';
        boton.addEventListener('click',async()=>{boton.disabled=true;try{
          const respuesta=await enviar('/solicitudes',{ejemplarId:anuncio.ejemplar_id});
          const b=await leerJson(respuesta);if(!respuesta.ok)throw new Error(b?.error??'No se pudo solicitar');
          mostrar('Solicitud enviada. Consulta Cesiones para seguir su estado.');
        }catch(e){mostrar(e.message,true);boton.disabled=false;}});tarjeta.append(boton);
      }
      return tarjeta;
    })()
  ));
}

anterior.addEventListener('click', async () => {
  if (pagina === 1) return;
  pagina -= 1;
  try {
    await cargar();
  } catch (error) {
    mostrar(error.message, true);
  }
});

siguiente.addEventListener('click', async () => {
  pagina += 1;
  try {
    await cargar();
  } catch (error) {
    mostrar(error.message, true);
  }
});

document.addEventListener('aula:sesion', async (evento) => {
  identidad = evento.detail;
  if (!puedeConsultar(identidad)) {
    lista.replaceChildren();
    pagina = 1;
    paginaTexto.textContent = '';
    anterior.disabled = true;
    siguiente.disabled = true;
    mostrar(identidad
      ? 'Necesitas una cuenta activa de alumnado o docencia para consultar Libros.'
      : '');
    return;
  }
  try {
    await cargar();
  } catch (error) {
    mostrar(error.message, true);
  }
});

try {
  identidad = await listo;
  if (!identidad) {
    // El shell ya ha enviado a login.html.
  } else if (!puedeConsultar(identidad)) {
    mostrar('Necesitas una cuenta activa de alumnado o docencia para consultar Libros.');
  } else {
    await cargar();
  }
} catch (error) {
  mostrar(error.message, true);
}
