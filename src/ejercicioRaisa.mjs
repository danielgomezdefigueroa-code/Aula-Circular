// Aula Circular - Biblioteca y Documentos
// Ejercicio de sesiones, estados y permisos - v1
// Simulación didáctica: NO realiza peticiones HTTP reales.

// 1. Identidades ficticias
const alumno = { estado: 'activo', rol: 'alumno' };
const docente = { estado: 'activo', rol: 'docente' };

// 2. Simulación del control de acceso
function consultar(cuenta, rolEnviado = '') {

  // Sin sesión
  if (cuenta === null) {
    return { codigo: 401, mensaje: 'Sin sesion' };
  }

  // Cuenta no activa
  if (cuenta.estado !== 'activo') {
    return { codigo: 403, mensaje: 'Cuenta no activa' };
  }

  // Permiso docente insuficiente
  if (cuenta.rol !== 'docente') {
    return { codigo: 403, mensaje: 'Sin permiso docente' };
  }

  // Acceso autorizado
  return { codigo: 200, mensaje: 'Acceso permitido' };
}

// 3. Función para mostrar los resultados
function mostrar(nombre, cuenta, esperado, rolEnviado = '') {
  const resultado = consultar(cuenta, rolEnviado);

  console.log('\n' + nombre + ' | Simulación GET /zona-docente');
  console.log('Cuenta:', cuenta);
  console.log('Rol enviado:', rolEnviado || 'ninguno');
  console.log('Esperado:', esperado);
  console.log('Observado:', resultado);

  if (resultado.codigo !== esperado) {
    process.exitCode = 1;
  }
}

// 4. Casos iniciales
console.log('ENSAYO DIDACTICO DE PERMISOS - AULA CIRCULAR');

mostrar('Caso 1: Sin sesion', null, 401);
mostrar('Caso 2: Alumno activo', alumno, 403);
mostrar('Caso 3: Docente activo', docente, 200);

// 5. Intento de modificar permisos desde el navegador
mostrar('Caso 4: Alumno envia rol docente', alumno, 403, 'docente');

// 6. Variante individual: activo por pendiente
docente.estado = 'pendiente';

mostrar('Caso 5: Docente pendiente', docente, 403);

// Dos identidades de sesiones ficticias independientes
const sesionAlumno = {
    identificador: 'SESION_A',
    cuenta: { estado: 'activo', rol: 'alumno' }
  };

  const sesionDocente = {
    identificador: 'SESION_B',
    cuenta: { estado: 'activo', rol: 'docente' }
  };

  function probarSesion(sesion) {
    const resultado = consultar(sesion.cuenta);

    console.log('\nSesion ficticia:', sesion.identificador);
    console.log('Metodo: GET');
    console.log('Ruta: /zona-docente');
    console.log('Estado de cuenta:', sesion.cuenta.estado);
    console.log('Rol:', sesion.cuenta.rol);
    console.log('Codigo simulado:', resultado.codigo);
    console.log('Cuerpo simulado:', JSON.stringify({
      mensaje: resultado.mensaje
    }));
  }

  probarSesion(sesionAlumno);
  probarSesion(sesionDocente);