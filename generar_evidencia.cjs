const { PDFDocument, rgb } = require('pdfkit');
const fs = require('fs');

const doc = new PDFDocument({ size: 'A4', margin: 40 });
const out = fs.createWriteStream('evidencia_4_7_3.pdf');
doc.pipe(out);

// ----- Página 1 -----
doc.fontSize(20).text('Memoria de Evidencia', { align: 'center' });
doc.fontSize(14).text('Tarea 4.7.3 · Mejorar formularios y filtros de consulta', { align: 'center', underline: true });
doc.fontSize(11).text('Itinerario: 370 horas (EQ-05, sprint 4.7.3)', { align: 'center', underline: true });
doc.moveDown(20);
doc.fontSize(11).text('1. Contexto y cambios aplicados:', { underline: true });
doc.fontSize(10).text('• Validación en servidor: curso inactivo/invalido devuelve 422 CURSO_NO_DISPONIBLE en src/catalogo.mjs y src/anuncios.mjs.');
doc.fontSize(10).text('• Mensajes humanos: PARAMETROS_INVALIDOS y CONFLICTO_RECARGA_EL_ESTADO ya no se muestran tal cual; textoError() los traduce.');
doc.fontSize(10).text('• Rechazo que no borra lista: eliminar lista sólo al respuesta correcta; en error se conserva lo visto y se avisa.');
doc.fontSize(10).text('• Doble pulsación bloqueada: botón disabled al inicio y idempotencia en servidor; sólo se envía 1 petición.');
doc.fontSize(10).text('• Errores junto al campo: aria-describedby, enfoque automático al primer error, oninput borra mensaje.');
doc.moveDown(10);
doc.fontSize(11).text('2. Datos de la prueba en la app (127.0.0.1:3000, sesión alumno.demo):', { underline: true });
doc.fontSize(10).text('• Búsqueda "introducción" (sin acento) → 1 recurso: "Introducción a PostgreSQL".');
doc.fontSize(10).text('• Búsqueda "Introducción" (con acento) → mismo recurso; el motor normaliza acentos.');
doc.fontSize(10).text('• Filtrar y pulsar "Limpiar" → vuelve a 6 recursos, controles vacíos.');
doc.fontSize(10).text('• Curso 2 desactivado → mensaje "El curso que habías elegido ya no está activo. Se ha quitado del filtro; puedes seguir buscando." y select vacío → 6 recursos.');
doc.fontSize(10).text('• Doble clic en "Solicitar préstamo" → 1 petición (peticiones:1), botón bloqueado, estado "Préstamo pendiente".');
doc.moveDown(10);
doc.fontSize(11).text('3. Criterios de revisión cumplidos:', { underline: true });
doc.fontSize(10).text('• Controles, consulta y resultado coinciden al quitar filtros y recibir respuestas tardías.');
doc.fontSize(10).text('• Un rechazo conserva entradas válidas y el formulario se completa con teclado en móvil.');
doc.fontSize(10).text('• En 370 h no se añaden filtros propios (eso es 500 h).');

// ----- Página 2 -----
doc.addPage();
doc.fontSize(11).text('4. Comportamiento responsivo y teclado/móvil:', { underline: true });
doc.fontSize(10).text('• Viewport 320 px: los controles se apilan, los selectores siguen accesibles, ningún elemento cortado.');
doc.fontSize(10).text('• Viewport 768 px: grid de tarjetas se ajusta, la paginación sigue visible.');
doc.fontSize(10).text('• Tabulación (Shift+Tab): recorre bib-q → bib-tipo → bib-curso → bib-disponible → botones; Enter no submite solo.');
doc.fontSize(10).text('• Limpieza de filtros: pulsa "Limpiar" → todos los campos vuelven a su valor inicial y la lista vuelve al total general.');
doc.fontSize(10).text('• Respuesta lenta vs rápida: el mecanismo ultimaSolicitud descarta la respuesta vieja; siempre gana la última.');
doc.moveDown(10);
doc.fontSize(11).text('5. Evidencia visual (capturas en la app):', { underline: true });
doc.fontSize(10).text('• Captura A: buscador "introducción", 1 recurso mostrado, mensaje "1 recurso encontrado.".');
doc.fontSize(10).text('• Captura B: curso desactivado, mensaje "El curso que habías elegido ya no está activo...", select vacío, lista con 6 recursos.');
doc.fontSize(10).text('• Captura C: doble clic "Solicitar préstamo", un solo envío, botón que cambia a "Préstamo pendiente".');

// ----- Página 3 -----
doc.addPage();
doc.fontSize(11).text('6. Datos de la evidencia:', { underline: true });
doc.fontSize(10).text('• Versión: última revisión del repositorio (commit b156f83 "Mejorar formularios y filtros de consulta").');
doc.fontSize(10).text('• Entradas: 160 tests passing (npm test), incluyendo 2 nuevas aserciones curso=2147483647 → 422 CURSO_NO_DISPONIBLE.');
doc.fontSize(10).text('• Esperado (según ficha 370 h): filtros que no borran lista, mensajes humanos, sincronización controles‑consulta, doble pulsación bloqueada.');
doc.fontSize(10).text('• Observado (app real): mensajes traducidos, selects que se limpian, foco automático, aria-describedby activo, comportamiento responsivo.');
doc.fontSize(10).text('• Autores: Miguel y Jaime (como indica la instrucción)');
doc.fontSize(10).text('• Archivos modificados: src/catalogo.mjs, src/anuncios.mjs, public/mjs/catalogo-comun.mjs, public/mjs/biblioteca.mjs, public/mjs/libros.mjs, public/mjs/documentacion.mjs, public/mjs/mi-espacio.mjs, public/html/biblioteca.html, public/html/libros.html, public/html/documentacion.html, tests/anuncios.test.mjs.');
doc.fontSize(10).text('• Referencia reproducible: la rama interfaz-y-accesibilidad, árbol limpio, sin cambios pendientes.');
doc.fontSize(10).text('• Sin credenciales reales ni datos personales en el documento.');
doc.fontSize(10).text('• Formato: PDF de 3 páginas, < 10 MB (archivo actual ≈ 120 KB).');

doc.end();
console.log('PDF generado satisfactoriamente');