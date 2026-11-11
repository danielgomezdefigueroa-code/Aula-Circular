import { iniciarArea } from './area-catalogo.mjs';

await iniciarArea({
  ruta: '/documentacion',
  vacio: 'No hay documentos publicados para tu curso. Vuelve más tarde o pregunta a tu docente.',
  contexto: 'Documentación'
});
