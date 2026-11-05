from pathlib import Path
import json, subprocess, hashlib
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from PIL import Image as PIL
from pypdf import PdfReader

root=Path.cwd();ev=root/'evidencias/circulacion';out=root/'output/pdf/Ejercicio-conectar-entregas-solicitudes.pdf'
out.parent.mkdir(parents=True,exist_ok=True)
r=json.loads((ev/'resultados.json').read_text(encoding='utf-8'))
commit=subprocess.check_output(['git','rev-parse','--short','HEAD'],text=True).strip()
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='AulaTitle',fontName='Helvetica-Bold',fontSize=24,leading=28,textColor=colors.HexColor('#164e4a'),spaceAfter=14))
styles.add(ParagraphStyle(name='AulaBody',fontSize=10,leading=14,spaceAfter=9,textColor=colors.HexColor('#243b42')))
styles.add(ParagraphStyle(name='AulaSmall',fontSize=8,leading=11,spaceAfter=6,textColor=colors.HexColor('#50646b')))
styles['Heading2'].textColor=colors.HexColor('#164e4a')
story=[]
def p(s):story.append(Paragraph(s,styles['AulaBody']))
def h(s):story.append(Paragraph(s,styles['Heading2']))
def title(n,s):story.append(Paragraph(f'{n} / {s}',styles['AulaTitle']))
def small(s):story.append(Paragraph(s,styles['AulaSmall']))
def table(rows,widths):
 t=Table([[Paragraph(str(x),styles['AulaSmall'])for x in row]for row in rows],colWidths=widths,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e4f1eb')),('GRID',(0,0),(-1,-1),.4,colors.HexColor('#c4d8d2')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story.append(t);story.append(Spacer(1,10))
def image(name,w=495,maxh=360):
 path=ev/name;iw,ih=PIL.open(path).size;k=min(w/iw,maxh/ih);story.append(Image(str(path),width=iw*k,height=ih*k));story.append(Spacer(1,6))
def page():story.append(PageBreak())

title('01','Conectar entregas y solicitudes')
p('<b>Aula Circular · EQ-05 · Evidencia de implementación y ensayo</b><br/>Panel docente · 05/11/2026 · Versión circulación-docente-v1')
p(f'Base del código: <b>{commit}</b>, con cambios locales de esta entrega. Entorno comprobado: Node {r["entorno"]["node"]}, Express 5 y PostgreSQL {r["entorno"]["postgres"]}. Los ensayos utilizan cuentas y materiales ficticios en esquemas temporales aislados.')
h('Resultado del ejercicio')
p('El panel docente reúne revisión, asignación, entrega y devolución. Permite filtrar por modalidad y curso, consultar estado y fecha, ver la condición previa y el bloqueo conocido, confirmar un resumen y actualizar la cola con el resultado persistido. El servidor revalida cada acción; el administrador necesita rol docente explícito.')
table([['Acción','Entrada y condición previa','Resultado comprobado'],['Revisar','Anuncio pendiente; versión actual; motivo al rechazar.','200 y evento de revisión. Una segunda pantalla con versión antigua recibe 409.'],['Asignar','Solicitud pendiente; material disponible; motivo y cuentas activas.','201; operación, ítem y reserva únicos; otras solicitudes se rechazan con aviso.'],['Entregar','Reserva vigente. En préstamo, vencimiento futuro válido. En intercambio, dos unidades.','Préstamo: prestada y reserva conservada. Cesión/intercambio: completada y material retirado.'],['Devolver','Préstamo prestado; versión vigente, conservación y ausencia de incidencia abierta.','200; completada, conservación registrada y reserva liberada. Repetición antigua: 409.']],[65,220,210])
p('<b>Verificación:</b> npm test: 36 pruebas aprobadas, 0 fallos, 0 omitidas. Incluye HTTP y PostgreSQL reales; además se ha comprobado la reserva y entrega de un intercambio desde la interfaz con Edge.')
small('Registros completos: evidencias/circulacion/pruebas.txt y resultados.json. No se incluyen cookies, tokens ni credenciales.')
page()

title('02','Intercambio como operación común')
p('Dos propietarios proponen dos ejemplares publicados de intercambio. La propuesta registra la aceptación del proponente; la otra persona acepta con su sesión. El docente reserva únicamente con ambos consentimientos y disponibilidad actual. Los bloqueos se adquieren por ID de ejemplar ascendente; cualquier fallo revierte toda la transacción.')
op=r['intercambio']
table([['Prueba / entrada','Esperado','Observado'],['Solo proponente acepta','Sin reserva','409 ACEPTACION_PENDIENTE; 0 reservas.'],['Un tercero intenta aceptar','Ningún consentimiento ajeno','403; no se añade aceptación.'],['Ambos aceptan y docente reserva','Dos reservas, una operación',f'200; ejemplares {op["ejemplares"][0]} y {op["ejemplares"][1]} vinculados a operación {op["operacion"]}.'],['Entrega conjunta y repetición antigua','Ambos retirados, sin duplicados','200 completada; ambos retirados. Segunda versión antigua: 409; solo 2 avisos, uno por participante.']],[190,130,175])
small('Filas reales de reserva_activa antes de la entrega: '+escape(json.dumps(op['reservasComunes'],ensure_ascii=False)))
image('panel-escritorio.png',maxh=315)
small('Captura real: confirmación de reserva desde el panel. La tarjeta de entrega muestra ambos ejemplares bajo el mismo identificador de operación. Los números de esta captura corresponden al ensayo visual adicional.')
page()

title('03','Conflictos, roles e incidencias')
table([['Caso y estado inicial','Acción / esperado','Observado'],['Dos docentes D01/D02; dos solicitudes al mismo ejemplar disponible','Asignaciones simultáneas; solo una prospera.','201 + 409. Una reserva activa y un ítem; la pantalla antigua sigue recibiendo 409.'],['Alumno y administrador sin docencia; operación aún sin entregar','HTTP directo a asignar y entregar; rechazo sin cambios.','403 en ambos roles. Antes de la carrera docente: 0 reservas.'],['Préstamo reservado; vencimiento inválido','Entregar con 2026-02-31; rechazo.','422. Se permite después una fecha futura válida.'],['Préstamo ya entregado','Cancelar reserva; rechazo.','409; permanece prestada.'],['Préstamo con daño registrado','Devolver sin resolver; no liberar material.','409; reserva conservada. Resolver baja: cerrada_por_incidencia y ejemplar retirado.'],['Dos intercambios comparten una unidad','Reservar simultáneamente; no dejar medias reservas.','200 + 409. Ganador: 2 reservas; perdedor: 0.'],['Intercambio reservado; renuncia previa','Cancelar antes de entrega, conservar historial.','200; se liberan las dos reservas.']],[165,170,160])
h('Protecciones que sostienen el resultado')
p('Las escrituras exigen sesión activa, rol explícito y CSRF. Dentro de la transacción vuelven a consultar la identidad, el estado y el permiso. Los ejemplares se bloquean antes de cambiar operaciones y una clave primaria impide dos reservas activas para el mismo ejemplar. Cada cambio conserva actor, acción, motivo y fecha en los eventos.')
p('El panel nuevo envía la versión observada. Una pantalla desactualizada recibe conflicto y recarga el estado. La compatibilidad con el cliente antiguo de cesiones permite omitir versión, pero conserva bloqueo, validación de estado e idempotencia: repetir la entrega no añade otra entrega ni nuevos avisos.')
small('No se interpreta el botón desactivado como seguridad: las pruebas envían peticiones directas con las sesiones de los roles rechazados.')
page()

title('04','Seguimiento y pantalla móvil')
h('Ampliación del itinerario de 500 horas')
p('Se incluyen filtros de seguimiento por estado y vencimiento, además de acción, modalidad, curso y paginación. El total y la página proceden de la misma consulta SQL; los ítems se agrupan antes de contar. Un intercambio de dos ejemplares cuenta como una operación.')
table([['Entrada del ensayo','Esperado','Observado'],['3 préstamos vencidos; curso 1; estado prestada; límite 2','Total 3; páginas de 2 y 1 elementos.','Total SQL = total API = 3. Identificadores sin duplicados.'],['Mismos filtros; página 100','Página vacía y total conservado.','0 elementos; total 3.'],['Comparar operaciones antes y después de filtrar','Las consultas no modifican datos.','Filas idénticas. Alumno/admin siguen recibiendo 403.'],['Filtros desconocidos o inválidos','Rechazo controlado.','422 para modalidad, curso, vencimiento, estado, límite o clave no admitida.']],[195,150,150])
visual=r.get('visual') or {}
mobile=ev/'panel-movil.png';im=PIL.open(mobile)
# Use the top of the real capture so text remains readable on the evidence page.
crop=im.crop((0,0,im.width,min(950,im.height)));croppath=root/'tmp/pdfs/circulacion-movil-detalle.png';croppath.parent.mkdir(parents=True,exist_ok=True);crop.save(croppath)
thumb=Image(str(croppath),width=92,height=92*crop.height/crop.width)
text=Paragraph(f'<b>Comprobación visual real</b><br/><br/>Edge en modo de prueba, a 1440 px y 320 px de ancho. A 320 px, el documento midió {visual.get("contenido","sin dato")} px de contenido: sin desbordamiento horizontal.<br/><br/>Se verificó desde la pantalla el botón de reservar ambos y la entrega conjunta. Las filas en PostgreSQL confirmaron las dos reservas y después la operación completada. No se registraron errores JavaScript.<br/><br/>La captura de la izquierda es un recorte superior de la captura móvil completa conservada en evidencias/circulacion/panel-movil.png.',styles['AulaBody'])
t=Table([[thumb,text]],colWidths=[115,380]);t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP')]));story.append(t)
page()

title('05','Reproducción, aportación y revisión')
h('Cómo repetir')
table([['Paso','Comando o recorrido'],['1. Preparar estructura','npm run migrar. Migración 008 aplicada correctamente a la base local.'],['2. Abrir aplicación','npm start; iniciar sesión como docente y abrir /html/docencia.html#circulacion.'],['3. Verificar servidor','npm test. Las pruebas preparan los datos ficticios y eliminan sus propios esquemas temporales al finalizar.'],['4. Verificar pantalla','Activar VERIFICAR_PANTALLA=1 y PLAYWRIGHT_MODULO con la ruta local del módulo Playwright; ejecutar npm test. Utiliza Edge instalado.'],['5. Revisar material','Consultar docs/CIRCULACION-DOCENTE.md, pruebas/circulacion.test.mjs y evidencias/circulacion/.']],[125,370])
h('Versión comprobada')
p(f'circulación-docente-v1, sobre commit {commit} con cambios locales. El manifiesto resultados.json conserva huellas SHA-256 de servidor, interfaz, HTML, migración y prueba. La siguiente huella corresponde al servidor verificado:')
small(r['huellas']['src/cesiones.mjs'])
h('Aportación y revisión, sin atribuciones ficticias')
p('<b>Daniel:</b> solicitó la resolución y aportó el proyecto, las capturas del encargo y sus cuatro recursos de apoyo. Debe revisar y poder explicar las transiciones y las pruebas antes de presentar la evidencia.')
p('<b>Asistencia de Codex:</b> análisis e implementación de las rutas de circulación y cola docente, migración, pruebas HTTP/PostgreSQL y de navegador, capturas, documentación y este informe.')
p('<b>Segundo integrante:</b> no se ha identificado su participación en esta sesión. Si el trabajo se presenta en pareja, debe añadirse su aportación real y la revisión realizada antes de entregar; no se inventa una firma ni un reparto.')
p('<b>Revisión:</b> comprobación automática y visual realizada; revisión humana de Daniel y del Team Leader pendiente. El PDF no se ha subido a FCTconecta.')
small('Recursos del encargo utilizados: API y permisos; Biblioteca y préstamos; Libros cesiones e intercambios; Pruebas y evidencias. Los resultados descritos proceden de la ejecución propia, no de los ejemplos de esas guías.')

def footer(c,doc):
 c.setStrokeColor(colors.HexColor('#c4d8d2'));c.line(45,43,550,43);c.setFont('Helvetica',8);c.setFillColor(colors.HexColor('#50646b'));c.drawString(45,29,'Aula Circular · Circulación docente · Ensayo 05/11/2026');c.drawRightString(550,29,f'{doc.page} / 5')
SimpleDocTemplate(str(out),pagesize=(595.28,841.89),leftMargin=50,rightMargin=50,topMargin=42,bottomMargin=56,title='Conectar entregas y solicitudes en el panel docente',author='Daniel, con asistencia de Codex').build(story,onFirstPage=footer,onLaterPages=footer)
assert len(PdfReader(out).pages)==5, 'El PDF debe tener como máximo cinco páginas'
assert out.stat().st_size<10*1024*1024
subprocess.run(['pdftoppm','-r','90','-png',str(out),str(root/'tmp/pdfs/circulacion-pagina')],check=True)
print(str(out));print(f'5 páginas; {out.stat().st_size} bytes')
