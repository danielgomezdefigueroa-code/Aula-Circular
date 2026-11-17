import { iniciarArea } from './area-catalogo.mjs';
import { iniciarGestionInventario } from './gestion-inventario.mjs';

await iniciarArea({
  ruta: '/biblioteca',
  vacio: 'No hay recursos de biblioteca disponibles.',
  contexto: 'Biblioteca'
});

await iniciarGestionInventario();
