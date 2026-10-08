// Ejemplo 2.2.1 v2: NO es un servidor ni una prueba HTTP real.
const alumno = { estado: 'activo', rol: 'alumno' };
const docente = { estado: 'activo', rol: 'docente' };

// Representa las comprobaciones que haría el servidor.
// null = sin sesión. La cuenta = identidad de una sesión ficticia.
function consultar(cuenta, rolEnviado = '') {
  if (cuenta === null) return { codigo: 401, mensaje: 'Sin sesion' };
  if (cuenta.estado !== 'activo') return { codigo: 403, mensaje: 'Cuenta pendiente' };
  // El rol enviado por el cliente NO concede permisos.
  if (cuenta.rol !== 'docente') return { codigo: 403, mensaje: 'Sin permiso docente' };
  return { codigo: 200, mensaje: 'Acceso permitido' };
}

// Todos los casos representan GET /zona-docente.
function mostrar(nombre, cuenta, esperado, rolEnviado = '') {
  const resultado = consultar(cuenta, rolEnviado);
  console.log('\n' + nombre + ' | Ejemplo de GET /zona-docente');
  console.log('Cuenta:', cuenta, '| Rol enviado:', rolEnviado || 'ninguno');
  console.log('Esperado:', esperado, '| Observado en el ejemplo:', resultado);
  if (resultado.codigo !== esperado) process.exitCode = 1;
}

console.log('EJEMPLO DIDACTICO: no se hacen peticiones HTTP reales.');
mostrar('1. Sin sesion', null, 401);
mostrar('2. Alumno activo', alumno, 403);
mostrar('3. Docente activo', docente, 200);
mostrar('4. Alumno envia rol docente', alumno, 403, 'docente');

// Variante: la misma identidad docente cambia de estado.
// Predice el resultado antes de ejecutar.
docente.estado = 'activo';
mostrar('5. Docente tras cambiar el estado', docente, 200);
