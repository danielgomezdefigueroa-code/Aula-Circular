from pathlib import Path
import json
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,Preformatted
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
p=Path('tarea/historial-avisos');r=json.loads((p/'resultados.json').read_text(encoding='utf-8'));out=p/'output/pdf';out.mkdir(parents=True,exist_ok=True)
s=getSampleStyleSheet();s['Normal'].fontSize=10;s['Normal'].leading=14;s['Normal'].spaceAfter=9
s['Title'].fontSize=24;s['Title'].leading=28;s['Title'].alignment=TA_LEFT;s['Title'].spaceAfter=14
s['Heading2'].fontSize=13;s['Heading2'].leading=17;s['Heading2'].textColor=colors.HexColor('#087f80');s['Heading2'].spaceBefore=9
s.add(ParagraphStyle('Codigo',fontName='Courier',fontSize=8.5,leading=12,spaceAfter=12))
s.add(ParagraphStyle('Celda',parent=s['Normal'],fontSize=9,leading=12,spaceAfter=0))
story=[]
def P(t,st='Normal'):return Paragraph(escape(str(t)),s[st])
def add(t,st='Normal'):story.append(P(t,st))
def code(t):story.append(Preformatted(t,s['Codigo']))
def table(rows,widths):
 t=Table([[P(c,'Celda') for c in row] for row in rows],colWidths=widths,hAlign='LEFT')
 t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e4f2ef')),('LINEBELOW',(0,0),(-1,0),.7,colors.HexColor('#087f80')),('LINEBELOW',(0,1),(-1,-1),.3,colors.HexColor('#dae5e3')),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story.append(t);story.append(Spacer(1,9))
add('Historial propio y avisos','Title')
add('Aula Circular - EQ-05 | Plan de 370 horas | 18/11/2026')
add('1. Mi objetivo y punto de partida','Heading2')
add('En esta práctica reviso que Mi espacio muestre solicitudes y operaciones propias, con estados, fechas y eventos coherentes. La lectura de un aviso debe ser independiente del préstamo, la cesión o el intercambio al que se refiere.')
add('Mi versión local es HIST-370-2026-11-18-v1, rama ejercicio/historial-avisos, sobre la base 7e7f5d93e80990f05def3082203030f90d0989df. Los archivos modificados se identifican por SHA-256 en version.json.')
add('2. La historia conocida de mi ensayo','Heading2')
table([['Operación','Estado guardado','Participantes'],['Cesión #1','Completada','A entrega a B'],['Cesión #2','Completada','A entrega a B'],['Préstamo #3','Prestada; conserva una reserva','Centro entrega a B'],['Intercambio #4','Cancelada; sin reservas','A y B, dos ítems y una operación']],[130,220,161])
add('Las cesiones y el préstamo se preparan por HTTP real. El intercambio cancelado se carga como semilla SQL histórica con dos ítems, evento docente y avisos; esta tarea comprueba su lectura, sin acreditar aquí su ciclo de cancelación por HTTP. Los ID corresponden a esta ejecución temporal.')
add('3. Qué puede consultar cada actor','Heading2')
table([['Actor ficticio','Resultado esperado y observado'],['Alumno A','3 operaciones propias: dos cesiones e intercambio'],['Alumno B','4 operaciones propias y sus solicitudes'],['Alumno C, ajeno','0 operaciones; no recibe actividad de A o B'],['Docente D','4 operaciones mediante /api/gestion/historial'],['Admin sin rol docente','403 en historial docente y en la nueva ruta de historial propio']],[160,351])
add('La API obtiene mi identidad de la sesión. Si envío usuarioId como filtro, responde 422. El anónimo recibe 401 y la cuenta pendiente 403. Ser administrador no concede el permiso docente.')
add('El historial conserva autores, fechas y siguiente acción. Un préstamo prestado indica devolución o incidencia por el profesorado; una operación cerrada solo ofrece consulta histórica.')
story.append(PageBreak())
add('Avisos y comprobaciones','Title')
add('4. Leer un aviso no cambia una operación','Heading2')
add('La migración 014 añade leido_en al aviso. La nueva ruta POST /api/avisos/:id/leido exige sesión activa y CSRF; recibe {} y solo actualiza el aviso cuyo destinatario coincide con la sesión. La primera fecha de lectura se conserva:')
code('UPDATE aviso\nSET leido_en = COALESCE(leido_en, now())\nWHERE id = $1 AND destinatario_id = $2;')
notice=next(e['observado'] for e in r['evidencia'] if e['caso']=='Leer aviso propio y ajeno')
add('En el ensayo, el aviso #'+str(notice['id'])+' queda leído a '+notice['leido']+'. Dos peticiones simultáneas devuelven 200 y la misma fecha. El aviso ajeno devuelve 404 y la petición sin CSRF, 403.')
add('Las consultas antes/después confirman que operacion, operacion_item, evento_operacion, reserva_activa y solicitud permanecen idénticas. El préstamo sigue prestado y conserva su reserva. No se simula una devolución.')
add('5. Historial estable y transiciones repetidas','Heading2')
table([['Comprobación','Esperado','Observado'],['Repetir entrega de cesión completada','No duplicar evento ni aviso','200; mismas filas y fechas'],['Cambiar curso de B al curso 2','Conservar la historia anterior','Mismas operaciones, ID, fechas, actores y eventos'],['Desactivar categoría','Mantener hechos ya registrados','Historial idéntico y reserva del préstamo intacta'],['Filtrar por préstamo y quitar filtro','Una operación; después cuatro','1 y 4, en API y pantalla'],['Páginas de dos operaciones','Orden estable, sin duplicados','Dos páginas reúnen cuatro ID distintos']],[157,177,177])
add('El cambio de curso y la desactivación son cambios de escenario mediante SQL de ensayo; no se presenta una nueva pantalla administrativa. La consulta de historial no filtra por curso actual ni por categoría activa.')
add('6. Mi SQL de control','Heading2')
code('SELECT o.tipo, o.estado, count(*) AS total\nFROM operacion o\nWHERE EXISTS (\n  SELECT 1 FROM operacion_item i\n  WHERE i.operacion_id = o.id\n    AND (i.origen_usuario_id = $1\n         OR i.destino_usuario_id = $1)\n)\nGROUP BY o.tipo, o.estado;')
add('control.sql se ejecuta con el ID ficticio como parámetro y coincide con la API: A=3, B=4 y C=0. Cuento operaciones, no eventos ni ítems: el intercambio no se cuenta dos veces. Este control no es un informe de la ampliación de 500 horas.')
story.append(PageBreak())
add('Implementación y reproducción','Title')
add('7. Qué incluye mi entrega','Heading2')
add('src/historial.mjs incorpora GET /api/mi-espacio/historial y GET /api/gestion/historial, además de la lectura del aviso. Se mantiene el contrato anterior de /api/mi-espacio para anuncios. src/app.mjs monta el nuevo router y src/cesiones.mjs ordena los avisos por fecha e ID.')
add('public/mjs/historial.mjs y la sección nueva de public/html/mi-espacio.html muestran operaciones, solicitudes y avisos, con filtro de modalidad, paginación, autores y fechas. La migración sql/migraciones/014_avisos_leidos.sql añade la fecha de lectura y los índices.')
add('La consulta usa EXISTS por origen o destino del usuario de sesión y subconsultas para ítems y eventos. Devuelve una fila por operación. Orden estable: fecha descendente e ID descendente; los eventos se muestran por fecha e ID. El límite máximo de página es 20.')
add('8. Pruebas ejecutadas y cómo repetirlas','Heading2')
add('La ejecución conjunta con regresión dio 18 aprobados y 0 fallos (15 casos y 3 contenedores de node:test). La repetición final del ejercicio dio 8 aprobados y 0 fallos (7 casos y un contenedor). Entorno: Node '+r['node']+' y PostgreSQL '+r['postgres']+'.')
add('La prueba de pantalla usa Edge automatizado: filtrar y restaurar operaciones, marcar un aviso sin cambiar las tablas de operación y vista de 390 px sin desbordamiento horizontal. Capturas en evidencias/historial.png e historial-movil.png. No es una comprobación manual atribuida a otra persona.')
code('node --env-file=.env --test --test-concurrency=1\n  tarea/historial-avisos/prueba.mjs\n  tests/cesiones.test.mjs\n  tests/diagnosticoServidor.test.mjs')
add('Ejecutar el comando en una sola línea desde la raíz Aula-Circular. Requiere Node 24, dependencias instaladas y .env propio para PostgreSQL con permiso de crear esquemas. La prueba aplica migraciones y datos ficticios en un esquema aislado, usa puerto libre y elimina solo su esquema al terminar.')
add('Para incluir navegador: PRUEBA_NAVEGADOR=1 y PLAYWRIGHT_MODULE apuntando a Playwright, con Edge instalado. Sin navegador se omite el caso de pantalla. Para usar la función manualmente en la base habitual hay que aplicar antes las migraciones pendientes, incluida 014; esta entrega no ha migrado esa base.')
add('Archivos reproducibles: tarea/historial-avisos/LEEME.md, prueba.mjs, control.sql, resultados.json, version.json y evidencias/. La semilla está dentro del script y las respuestas y SQL quedan registrados sin contraseñas, cookies ni tokens.')
add('9. Mi conclusión y ayuda utilizada','Heading2')
add('Mi identidad de sesión y mi relación con la operación deciden qué historia puedo consultar. Leer un aviso solo registra su lectura; cambiar de curso o desactivar una categoría no borra el pasado. He contado con Codex para implementar, preparar y ejecutar las pruebas automáticas y redactar esta evidencia, reutilizando el código del equipo y las guías 05, 06, 09 y 11 de la tarea.')
add('Trabajo individual de 370 horas: no incluyo informes exclusivos de 500. No dispongo de compañero para la revisión humana independiente, que queda pendiente para el tutor. El ejercicio está guardado en local; la entrega en FCTconecta se realiza aparte.')
def pie(c,d):
 c.setFont('Helvetica',8);c.setFillColor(colors.HexColor('#536560'));c.drawString(42,24,'HIST-370 | 18/11/2026 | Datos ficticios y ayuda de Codex');c.drawRightString(553,24,str(d.page))
pdf=out/'Historial-avisos.pdf'
SimpleDocTemplate(str(pdf),leftMargin=42,rightMargin=42,topMargin=35,bottomMargin=42).build(story,onFirstPage=pie,onLaterPages=pie)
from pypdf import PdfReader
print('Paginas:',len(PdfReader(pdf).pages),'Bytes:',pdf.stat().st_size)
