import test from 'node:test';
import assert from 'node:assert/strict';
import { crearHash, comprobarClave } from '../src/cuentas/contraseñas.mjs';
import { validarRegistro } from '../src/cuentas/registro.mjs';

test('Contraseña correcta, incorrecta y sal distinta para la misma clave', async () => {
  // Frase de prueba generada al ejecutar: no se entrega una credencial fija.
  const { randomUUID } = await import('node:crypto');
  const clave = randomUUID();
  const primera = await crearHash(clave);
  const segunda = await crearHash(clave);
  assert.notEqual(primera, segunda);
  assert.equal(await comprobarClave(clave, primera), true);
  assert.equal(await comprobarClave(randomUUID(), primera), false);
  assert.equal(await comprobarClave(clave, 'formato incorrecto'), false);
  assert.equal(primera.includes(clave), false);
});

test('Validación no recoge rol ni estado enviados por el cliente', () => {
  const datos = validarRegistro({ alias: ' Alumno ficticio ', correo: ' EJEMPLO@CENTRO.INVALID ',
    clave: 'Frase solo de prueba local', cursoSolicitadoId: 1, rol: 'admin', estado: 'activo' });
  assert.equal(datos.correo, 'ejemplo@centro.invalid');
  assert.equal(datos.alias, 'Alumno ficticio');
  assert.equal('rol' in datos, false);
  assert.equal('estado' in datos, false);
  assert.equal(validarRegistro({ ...datos, cursoSolicitadoId: '1' }), null);
  assert.equal(validarRegistro({ alias: 'Alumno', correo: 'sin correo', clave: 'corta', cursoSolicitadoId: 1 }), null);
});
