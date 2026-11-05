from pathlib import Path
import json,subprocess,zipfile
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,Image,PageBreak
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from PIL import Image as PIL
from pypdf import PdfReader
root=Path(__file__).parent;r=json.loads((root/'resultados.json').read_text(encoding='utf-8'))
out=root/'output/pdf/Ejercicio-teclado-y-movil.pdf';out.parent.mkdir(parents=True,exist_ok=True)
tmp=root/'tmp';tmp.mkdir(exist_ok=True)
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='TituloAula',fontName='Helvetica-Bold',fontSize=23,leading=27,spaceAfter=12,textColor=colors.HexColor('#164e4a')))
styles.add(ParagraphStyle(name='TextoAula',fontSize=10,leading=13.5,spaceAfter=8,textColor=colors.HexColor('#243b42')))
styles.add(ParagraphStyle(name='PieAula',fontSize=8,leading=10.5,spaceAfter=6,textColor=colors.HexColor('#50646b')))
styles['Heading2'].textColor=colors.HexColor('#164e4a')
story=[]
def p(s):story.append(Paragraph(s.replace('→',' / '),styles['TextoAula']))
def small(s):story.append(Paragraph(s,styles['PieAula']))
def h(s):story.append(Paragraph(s,styles['Heading2']))
def title(s):story.append(Paragraph(s,styles['TituloAula']))
def table(rows,widths):
 t=Table([[Paragraph(str(x).replace('→',' / '),styles['PieAula'])for x in row]for row in rows],colWidths=widths,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e4f1eb')),('GRID',(0,0),(-1,-1),.4,colors.HexColor('#c4d8d2')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]));story.append(t);story.append(Spacer(1,8))
def recorte(name,box,dest):
 im=PIL.open(root/'evidencias'/name);im.crop(box).save(tmp/dest);return str(tmp/dest)
def footer(c,doc):
 c.setStrokeColor(colors.HexColor('#c4d8d2'));c.line(45,42,550,42);c.setFillColor(colors.HexColor('#50646b'));c.setFont('Helvetica',8);c.drawString(45,28,'Aula Circular · Daniel · Ensayo individual asistido · 05/11/2026');c.drawRightString(550,28,f'{doc.page} / 3')

title('01 / Teclado y pantalla estrecha')
p('<b>Comprobar una pantalla con teclado y móvil</b><br/>Aula Circular · EQ-05 · Daniel · 05/11/2026')
p(f'<b>Versión:</b> copia del commit fe1d34f, rama interfaz-y-accesibilidad. Edge {r["entorno"]["navegador"]}, Node {r["entorno"]["node"]} y PostgreSQL {r["entorno"]["postgres"]}. No se han modificado los archivos ni las ramas del equipo.')
h('Recorrido y condiciones de partida')
p('Buscar un libro y solicitar su cesión. Se preparó por HTTP una sesión de alumno activo ficticio; el recorrido de la pantalla se hizo con eventos de teclado, sin clics. La solicitud se comprobó por HTTP y en PostgreSQL. El formulario de acceso vacío se ensayó por separado, sin sesión.')
table([['N.','Control y acción de teclado','Esperado / observado'],['1','Tab: marca → Abrir menú; Enter.','Se abre y aria-expanded pasa a true.'],['2','Tab: enlace Inicio; Escape.','Se cierra el menú y el foco vuelve a Abrir menú.'],['3','Tab a enlace Cesiones; Mayús+Tab.','Regresa al botón del menú; sin bloqueo.'],['4','Tab: Buscar → Curso → Modalidad → Solo disponibles → Buscar. Escribir título y Enter.','Una coincidencia para el título de ensayo.'],['5','Tab: Limpiar → Solicitar cesión; Enter.','HTTP 201. Foco al aviso: solicitud enviada.'],['6','Consultar estado persistido en el ensayo.','Solicitud pendiente; 0 reservas activas. Solicitar no reserva.']],[32,240,223])
h('Resultados por ancho')
table([['Ancho CSS','Recorrido / error','Medida y resultado'],['320 px','Original, antes y después; formulario vacío.','Contenido 320 px; sin desbordamiento horizontal.'],['390 px','Original, antes y después; formulario vacío.','Contenido 390 px; sin desbordamiento horizontal.'],['768 / 1440 px','Reflujo de la copia corregida.','Contenido dentro del viewport en ambos casos.']],[75,235,185])
small('12 escenarios registrados y 0 errores JavaScript. Los casos "antes" reproducen intencionadamente una barrera de foco y no se declaran accesibles. Prueba con viewport de navegador, no en móvil físico.')
story.append(PageBreak())

title('02 / Una barrera antes y después')
p('<b>Diagnóstico honesto:</b> el recorrido original se completa con foco visible. Como permite el encargo, se añadió un fallo deliberado a una copia didáctica. No se atribuye este defecto al código de los compañeros.')
before=recorte('antes-320-01-foco.png',(16,20,184,130),'antes-foco.png');after=recorte('despues-320-01-foco.png',(16,20,184,130),'despues-foco.png')
t=Table([[Paragraph('<b>ANTES · fallo preparado</b>',styles['TextoAula']),Paragraph('<b>DESPUÉS · regla retirada</b>',styles['TextoAula'])],[Image(before,width=218,height=143),Image(after,width=218,height=143)]],colWidths=[247.5,247.5]);t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),8)]));story.append(t)
small('Recortes de las capturas reales a 320 px. El mismo botón tiene foco de teclado en ambos casos. En el antes solo se ve el borde normal; después aparece el contorno blanco exterior.')
table([['Dato observado','Antes','Después'],['Control activo','menu-boton; :focus-visible = true','menu-boton; :focus-visible = true'],['Indicador CSS','outline: none','outline: solid; 3 px; blanco'],['Teclado y retorno','El orden sigue existiendo, pero no se ve el foco.','Tab, Mayús+Tab, Enter y Escape funcionan con indicador.']],[130,182,183])
h('Corrección mínima y causa')
p('La copia antes añade esta regla al final de public/css/estilo.css:<br/><font face="Courier" size="9">:focus, :focus-visible {<br/>  outline: none !important;<br/>  box-shadow: none !important;<br/>}</font>')
p('La corrección elimina únicamente esa regla añadida y conserva el estilo original de Aula Circular: contorno visible de 3 px y contorno blanco en la cabecera. No cambia el orden de controles ni las validaciones del servidor.')
h('Explicación propuesta para Daniel')
p('El foco muestra qué control recibirá la siguiente pulsación. Quitar el contorno no elimina el control del recorrido: hace que una persona que navega con teclado pierda su posición visual. Restituir el indicador permite localizarlo y continuar. He distinguido este fallo preparado del comportamiento correcto observado en el original.')
small('Explicación redactada con asistencia de IA para que Daniel la revise y la defienda con sus palabras. La repetición manual personal aún no se ha registrado.')
story.append(PageBreak())

title('03 / Error, evidencia y límites')
h('Formulario inválido, a 320 y 390 px')
p('Sin sesión: Tab recorre Crear cuenta → Entrar → Correo → Contraseña → Mostrar → Entrar. Al enviar vacío con Enter, el foco pasa al resumen de dos errores. Tab y Enter sobre el primer enlace llevan al campo de correo.')
im=root/'evidencias/despues-390-04-error.png';iw,ih=PIL.open(im).size
captura=Image(str(im),width=150,height=150*ih/iw)
texto=Paragraph('<b>Esperado y observado</b><br/><br/>Correo y contraseña tienen etiquetas visibles, aria-invalid="true" y mensajes específicos enlazados por aria-describedby.<br/><br/>El error no depende solo del color: aparece texto y un resumen navegable. A 320 y 390 px no se midió desbordamiento horizontal ni se ocultó mediante overflow-x:hidden.<br/><br/>El resumen recibe foco. Activar su enlace con Enter devuelve el foco a Correo.<br/><br/><b>Captura real:</b> formulario vacío a 390 px, versión después.',styles['TextoAula'])
t=Table([[captura,texto]],colWidths=[170,325]);t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP')]));story.append(t);story.append(Spacer(1,8))
h('Reproducción y aportación')
p('<b>Código y datos:</b> LEEME.md, preparar.py, prueba.mjs, resultados.json y las carpetas antes/despues. El script crea un esquema aleatorio de ensayo y lo elimina al finalizar; no modifica datos del centro. Las capturas completas y el registro de teclas se conservan en evidencias/ y resultados.json.')
p('<b>Ayuda utilizada:</b> Codex preparó las copias, ejecutó las comprobaciones y redactó el informe. Daniel aportó el encargo y los recursos. Revisión personal de Daniel y del tutor pendiente. No se declara entrega en FCTconecta.')
small('Límites: Edge headless con anchos CSS emulados; sin prueba en móvil físico, sin lector de pantalla y sin certificación completa WCAG. Recursos leídos: Inicio IA y apoyo, Interfaz responsive y Pruebas y evidencias; el ZIP visual se usa solo como referencia, no sustituye controles HTML.')

SimpleDocTemplate(str(out),pagesize=(595.28,841.89),leftMargin=50,rightMargin=50,topMargin=40,bottomMargin=54,title='Comprobar una pantalla con teclado y móvil',author='Daniel, con asistencia de Codex').build(story,onFirstPage=footer,onLaterPages=footer)
assert len(PdfReader(out).pages)==3
assert out.stat().st_size<10*1024*1024
subprocess.run(['pdftoppm','-r','90','-png',str(out),str(tmp/'pagina')],check=True,capture_output=True)
with zipfile.ZipFile(root/'Ejercicio-teclado-y-movil.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
 for f in root.rglob('*'):
  if f.is_file() and f.name!='Ejercicio-teclado-y-movil.zip' and 'tmp' not in f.relative_to(root).parts:z.write(f,f.relative_to(root))
print(f'{out}: 3 páginas; {out.stat().st_size} bytes')
