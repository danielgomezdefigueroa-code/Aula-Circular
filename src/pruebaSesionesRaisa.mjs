// Aula Circular - Biblioteca y Documentos
// Prueba HTTP real con dos sesiones ficticias independientes.
// Exclusivamente para laboratorio local.

const BASE = 'http://127.0.0.1:3100';

function extraerCookie(respuesta) {
  const cabecera = respuesta.headers.get('set-cookie');

  if (!cabecera) {
    throw new Error('El servidor no ha enviado una cookie de sesión');
  }

  return cabecera.split(';')[0];
}

async function probarIdentidad(identidad) {

  // 1. Obtener sesión inicial y token CSRF.
  const respuestaCsrf = await fetch(`${BASE}/api/lab/csrf`);

  if (!respuestaCsrf.ok) {
    throw new Error(`Error al obtener CSRF: ${respuestaCsrf.status}`);
  }

  const cookieInicial = extraerCookie(respuestaCsrf);
  const { csrfToken } = await respuestaCsrf.json();

  // 2. Iniciar sesión con la identidad ficticia.
  const respuestaAcceso = await fetch(`${BASE}/api/lab/acceso`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      Cookie: cookieInicial
    },
    body: JSON.stringify({ identidad })
  });

  if (!respuestaAcceso.ok) {
    throw new Error(`Error de acceso ${identidad}: HTTP ${respuestaAcceso.status}`);
  }

  // El servidor regenera la sesión durante el acceso.
  const cookieAutenticada = extraerCookie(respuestaAcceso);
  const cuenta = await respuestaAcceso.json();

  // 3. Consultar la misma ruta protegida.
  const respuesta = await fetch(`${BASE}/api/lab/zona-docente`, {
    method: 'GET',
    headers: {
      Cookie: cookieAutenticada
    }
  });

  const cuerpo = await respuesta.json();

  // 4. Mostrar solo información no sensible.
  console.log('\n------------------------------');
  console.log('Identidad:', identidad);
  console.log('Estado de cuenta:', cuenta.estado);
  console.log('Rol:', cuenta.rol);
  console.log('Metodo: GET');
  console.log('Ruta: /api/lab/zona-docente');
  console.log('Estado HTTP:', respuesta.status);
  console.log('Cuerpo:', JSON.stringify(cuerpo));
}
// Prueba negativa: intentar enviar un rol desde el cliente.
async function probarRolEnviado() {
    const respuestaCsrf = await fetch(`${BASE}/api/lab/csrf`);
    const cookie = extraerCookie(respuestaCsrf);
    const { csrfToken } = await respuestaCsrf.json();

    const respuesta = await fetch(`${BASE}/api/lab/acceso`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Cookie: cookie
      },
      body: JSON.stringify({
        identidad: 'A01',
        rol: 'docente'
      })
    });

    console.log('\n--- Intento de enviar rol docente ---');
    console.log('Metodo: POST');
    console.log('Ruta: /api/lab/acceso');
    console.log('Identidad: A01');
    console.log('Rol enviado: docente');
    console.log('HTTP:', respuesta.status);
    console.log('Cuerpo:', JSON.stringify(await respuesta.json()));

    if (respuesta.status !== 422) {
      process.exitCode = 1;
    }
  }


// Las cookies se mantienen separadas dentro de cada ejecución.
// try {
//   await probarIdentidad('A01');
//   await probarIdentidad('D01');
// } catch (error) {
//   console.error('Prueba interrumpida:', error.message);
//   process.exitCode = 1;
// }

try {
    await probarIdentidad('A01');
    await probarIdentidad('D01');
    await probarIdentidad('D02');
    await probarRolEnviado();
  } catch (error) {
    console.error('Prueba interrumpida:', error.message);
    process.exitCode = 1;
  }