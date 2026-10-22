import { iniciarArea } from './area-catalogo.mjs';

await iniciarArea({
  ruta: '/biblioteca',
  vacio: 'No hay recursos de biblioteca disponibles.',
  contexto: 'Biblioteca'
});
