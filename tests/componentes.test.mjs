// Pruebas de componentes con nombres largos y revisión de contraste
// Itinerario 500 horas - Aula Circular
import test from 'node:test';
import assert from 'node:assert/strict';

// Importar funciones de utilidad del proyecto
import { validarRegistro } from '../src/seguridad.mjs';
import { manejarError, manejarEstadoSinDatos, manejarEstadoCarga } from '../src/anuncios.mjs';

// Test de nombres/longitudes extensas (simulación de componentes UI)
test('componentes: acepta alias y textos de hasta 60 caracteres', () => {
  // Alias largo pero dentro del límite
  const resultadoLargo = validarRegistro({
    alias: 'A'.repeat(60),
    correo: 'test@test.com',
    contrasena: 'una frase de prueba larga suficiente',
    curso: 'DAW-1'
  });
  assert.equal(Object.keys(resultadoLargo).length, 0, 'Alias de 60 caracteres debe ser válido');

  // Alias que excede el límite (el validador lo limita a 40 en seguridad.mjs)
  const resultadoLargoDemasiado = validarRegistro({
    alias: 'A'.repeat(61),
    correo: 'test@test.com',
    contrasena: 'una frase de prueba larga suficiente',
    curso: 'DAW-1'
  });
  assert.ok(resultadoLargoDemasiado.alias, 'Alias de 61 caracteres debe ser rechazado');

  // Texto largo en mensaje de error
  const errorLargo = manejarError(
    new Error('Error de validación: el campo no puede estar vacío y requiere una descripción adecuada'),
    'Revisa los campos del formulario'
  );
  assert.ok(errorLargo.mensaje.length > 20, 'Mensaje de error debe ser descriptivo');
  assert.ok(errorLargo.detalles, 'Debe haber detalles de texto disponibles');
});

// Test de estados sin datos
test('estados: maneja estado sin datos correctamente', () => {
  const estadoVacio = manejarEstadoSinDatos(
    'No hay publicaciones disponibles en este momento',
    'Intenta con diferentes filtros de búsqueda'
  );
  assert.ok(estadoVacio.sinDatos, 'Debe tener marca sinDatos');
  assert.equal(estadoVacio.mensaje, 'No hay publicaciones disponibles en este momento');
  assert.equal(estadoVacio.nextAction, 'Intenta con diferentes filtros de búsqueda');

  // Verificar que no retorna datos ficticios
  assert.equal(estadoVacio.datos, undefined, 'No debe tener datos');
});

// Test de estados de carga
test('estados: maneja estado de carga', () => {
  const estadoCarga = manejarEstadoCarga('Cargando recursos de la biblioteca');
  assert.ok(estadoCarga.carga, 'Debe tener marca carga');
  assert.equal(estadoCarga.mensaje, 'Cargando recursos de la biblioteca');

  // Verificar transición
  assert.ok(!estadoCarga.sinDatos, 'Estado de carga no debe tener sinDatos');
  assert.ok(!estadoCarga.error, 'Estado de carga no debe tener error');
});

// Test de estados de error con acción siguiente
test('estados: maneja errores con acción siguiente', () => {
  const errorConAccion = manejarError(
    { mensaje: 'Error de red', codigo: 503 },
    'Reintenta la operación en unos momentos'
  );
  assert.ok(errorConAccion.error, 'Debe tener marca error');
  assert.equal(errorConAccion.codigo, 503);
  assert.equal(errorConAccion.accionSiguiente, 'Reintenta la operación en unos momentos');
  assert.ok(errorConAccion.detalles, 'Debe haber detalles de texto');
});

// Test de contraste de mensajes (simulación - verifica que los mensajes tengan suficiente contraste textual)
test('contraste: los mensajes de error deben ser legibles sin depender solo del color', () => {
  const error = manejarError(
    new Error('Credenciales inválidas'),
    'Verifica tu correo y contraseña'
  );
  
  // El mensaje debe ser comprensible por sí mismo
  assert.ok(
    /^(Credenciales|Error|Validación)/i.test(error.mensaje),
    'El mensaje debe comenzar con un indicador claro'
  );
  
  // La acción siguiente debe ser textual
  assert.ok(
    typeof error.accionSiguiente === 'string' && error.accionSiguiente.length > 5,
    'La acción siguiente debe ser un texto descriptivo'
  );
  
  // Los detalles deben estar presentes
  assert.ok(error.detalles, 'Siempre debe haber detalles de texto disponibles');
});

console.log('Pruebas de componente y contraste cargadas para itinerario 500 horas');