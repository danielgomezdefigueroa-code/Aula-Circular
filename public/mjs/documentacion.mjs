import { iniciarArea } from './area-catalogo.mjs';

await iniciarArea({
  ruta: '/documentacion',
  vacio: 'No hay documentos publicados.',
  contexto: 'Documentación'
});
