from pathlib import Path
import json,hashlib
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,Image,PageBreak
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from PIL import Image as PIL
root=Path.cwd();ev=root/'evidencias/panel-docente';out=root/'output/pdf/Evidencia-panel-docente-administracion.pdf'
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='TituloAula',fontName='Helvetica-Bold',fontSize=25,leading=29,textColor=colors.HexColor('#164d47'),spaceAfter=16))
styles.add(ParagraphStyle(name='TextoAula',fontSize=10,leading=14,spaceAfter=9,textColor=colors.HexColor('#243b42')))
styles.add(ParagraphStyle(name='PieAula',fontSize=8,leading=11,textColor=colors.HexColor('#596b70'),spaceAfter=7))
styles['Heading2'].textColor=colors.HexColor('#164d47')
story=[]
def p(t):story.append(Paragraph(t,styles['TextoAula']))
def h(t):story.append(Paragraph(t,styles['Heading2']))
def title(n,t):story.append(Paragraph(f'{n} / {t}',styles['TituloAula']))
def caption(t):story.append(Paragraph(t,styles['PieAula']))
def img(name,w=500,maxh=380):
 f=ev/name;im=PIL.open(f);iw,ih=im.size;s=min(w/iw,maxh/ih);story.append(Image(str(f),width=iw*s,height=ih*s));story.append(Spacer(1,8))
def table(rows,widths):
 data=[[Paragraph(str(v),styles['PieAula']) for v in row]for row in rows];t=Table(data,colWidths=widths,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e4f1eb')),('GRID',(0,0),(-1,-1),.4,colors.HexColor('#c4d8d2')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story.append(t);story.append(Spacer(1,10))
r=json.loads((ev/'resultados.json').read_text(encoding='utf-8'))
title('01','Permisos reales por función')
p('<b>Aula Circular · Panel docente y administración · v1 · 29/10/2026</b><br/>Centro ficticio. Pruebas con Node.js, Express y PostgreSQL locales. Responsable de la entrega: Daniel, único integrante.')
p('Se han incorporado administración separada, roles explícitos, suspensión sin borrado, gestión de cursos/categorías y auditoría. El panel docente reúne validación de cuentas, revisión de anuncios y acceso a los recursos y operaciones existentes.')
h('Matriz observada: respuestas HTTP')
rows=[['Rol','Cola de cuentas','Revisión anuncios','Administración','Biblioteca / Docs']]
for x in r['matriz']:rows.append([{'alumno':'Alumno','docente':'Docente','admin':'Administrador','ambos':'Admin + docente'}[x['rol']],x['cola'],x['revision'],x['administracion'],f"{x['biblioteca']} / {x['documentacion']}"])
table(rows,[105,90,100,100,110])
p('200 permite la consulta; 403 deniega el permiso. Sin sesión, administración responde 401. El administrador sin docencia también recibe 403 al intentar asignar solicitudes o confirmar entregas por HTTP directo.')
img('06-admin-sin-docencia.jpg',maxh=240)
caption('Captura real: acceso directo del administrador al panel docente. No se muestran cuentas ni anuncios privados.')
story.append(PageBreak())
title('02','Cola y validación docente')
p('El docente confirma pertenencia y curso mediante la ruta existente. La validación registra actor, fecha y curso en evento_cuenta. Los anuncios se aprueban o devuelven con motivo; la revisión conserva el responsable y el cambio de estado.')
img('01-panel-docente.jpg',maxh=445)
caption('Captura real anterior a las acciones: cuenta pendiente y anuncio enviado a revisión, con datos ficticios.')
table([['Entrada / acción','Esperado','Observado'],['Validar cuenta pendiente con curso 2','200 + evento de pertenencia','200; evento_cuenta conserva usuario y actor'],['Devolver anuncio con motivo breve','Cambio de estado y responsable','Revisión registrada; desaparece de la cola'],['Consultar recursos y operaciones','Usar reglas existentes','Enlaces a Biblioteca, Documentación y Cesiones']],[210,135,160])
story.append(PageBreak())
title('03','Gestión y protección administrativa')
p('Administración permite altas, edición y desactivación de cursos y categorías, además de roles y suspensión de cuentas. No convierte una pertenencia pendiente en activa ni confirma su curso. Las mutaciones exigen sesión activa, permiso admin y CSRF.')
img('05-ultimo-admin.jpg',maxh=270)
caption('Captura real: el servidor rechaza suspender al último administrador activo. El mensaje de la interfaz explica el motivo.')
img('08-categorias-auditoria.jpg',maxh=260)
caption('Captura real: categorías y registro de cambios. Alta de Guías de estudio y retirada de rol con actor, fecha y valores anterior/posterior.')
story.append(PageBreak())
title('04','Sesión abierta y concurrencia')
table([['Caso real','Resultado esperado y observado'],['Retirada docente de una cuenta admin + docente','PATCH 200. Misma cookie: cola docente 403; administración 200. Restituido explícitamente el rol, cola 200.'],['Suspensión después del acceso','PATCH 200. La petición siguiente a Biblioteca recibe 401 por versión de sesión revocada.'],['Conservación tras suspender','Permanecen usuario, operación, item y reserva activa. No se borran relaciones. Restaurar la cuenta no recupera la sesión antigua.'],['Último administrador: retirada o suspensión','Ambas acciones reciben 409; permanece al menos una cuenta admin activa.'],['Ampliación 500: dos retiradas simultáneas','Se lanzan dos peticiones HTTP con Promise.all sobre las dos últimas cuentas admin. Respuestas: '+str(r['concurrencia']['respuestas'])+'. Administradores activos al terminar: 1.']],[175,330])
h('Por qué resiste la carrera')
p('Todas las escrituras administrativas adquieren pg_advisory_xact_lock(71001) dentro de la transacción. Después revalidan al actor, cuentan administradores activos y escriben. Una segunda petición espera y comprueba el estado confirmado por la primera antes de decidir.')
h('Decisión sobre la sesión')
p('Los roles se consultan en la base en cada petición. Retirar docencia conserva la sesión y elimina ese permiso en la siguiente petición. Un cambio de estado incrementa auth_version y revoca la sesión. Esto permite comprobar el caso de retirada de permiso sin cerrar toda la sesión.')
h('Verificación de regresión')
p('<b>npm test: 28 pruebas aprobadas, 0 fallos, 0 omitidas.</b> Incluye cuentas, anuncios, cesiones y administración; servidor HTTP y PostgreSQL reales en esquemas temporales. No se acredita el resultado mediante respuestas simuladas.')
p('Los listados administrativos paginan a 20 elementos, rechazan filtros no admitidos y no exponen hashes. Se comprueban CSRF ausente, código duplicado y activación administrativa de una cuenta aún pendiente.')
caption('Registro reproducible: evidencias/panel-docente/pruebas.txt y resultados.json. Los resultados corresponden al código de esta entrega.')
story.append(PageBreak())
title('05','Reproducción y revisión')
# Two-column image and explanatory text
mobile=ev/'07-administracion-movil.jpg';im=PIL.open(mobile);iw,ih=im.size
mobile_image=Image(str(mobile),width=145,height=145*ih/iw)
text=Paragraph('<b>Comprobación móvil</b><br/><br/>Administración a 320 px de ancho. La medición del navegador dio 320 px de ventana y 305 px de contenido: sin desbordamiento horizontal.<br/><br/><b>Arranque</b><br/>npm run migrar<br/>npm start<br/><br/><b>Pruebas</b><br/>npm test<br/><br/><b>Ensayo visual aislado</b><br/>node --env-file=.env scripts/ensayo-panel.mjs<br/>Puerto local 3001; centro y cuentas ficticias independientes.',styles['TextoAula'])
t=Table([[mobile_image,text]],colWidths=[170,335]);t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP')]));story.append(t);story.append(Spacer(1,12))
h('Autoría, asistencia y revisión')
p('<b>Integrante:</b> Daniel. Ha confirmado que realiza la tarea individualmente; no existe un segundo integrante. Ha facilitado el proyecto, los requisitos y los recursos de la actividad.')
p('<b>Ayuda de Codex:</b> análisis del código, implementación de administración y cola docente, migración 007, pruebas HTTP/PostgreSQL, comprobación visual, capturas y preparación de este informe. No se atribuye esta implementación asistida a una segunda persona.')
p('<b>Revisión:</b> comprobaciones automáticas y visuales realizadas durante esta sesión. Revisión humana de Daniel o del tutor pendiente. No se declara aprobación del Team Leader ni entrega en FCTconecta.')
p('<b>Alcance:</b> se integra con las operaciones de cesión existentes. La tarea no añade el módulo completo de préstamos o intercambios. Las categorías se gestionan como catálogo administrativo; no se modifica la clasificación de las fichas anteriores.')
def footer(c,doc):
 c.setStrokeColor(colors.HexColor('#c4d8d2'));c.line(44,42,551,42);c.setFont('Helvetica',8);c.setFillColor(colors.HexColor('#596b70'));c.drawString(44,28,'Aula Circular · Evidencia de ensayo · Daniel · 29/10/2026');c.drawRightString(551,28,f'{doc.page} / 5')
SimpleDocTemplate(str(out),pagesize=(595.28,841.89),rightMargin=45,leftMargin=45,topMargin=42,bottomMargin=54,title='Panel docente y administración - Evidencia',author='Daniel (con asistencia de Codex)').build(story,onFirstPage=footer,onLaterPages=footer)
print(out)
