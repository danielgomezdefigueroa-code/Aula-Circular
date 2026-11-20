\# Diagnóstico de recurso inexistente



\## Procedencia



Ejercicio didáctico preparado sobre el commit 4926a3c.

La ruta original de ficha de Biblioteca no estaba implementada.

Se añadió GET /api/ensayo/recursos/:id, solo en desarrollo.



\## Causa y corrección



El caso preparado accedía a resultado.rows\[0].id sin comprobar

si la consulta había encontrado filas, provocando un HTTP 500.



Se añadió una comprobación de resultado.rowCount antes de

leer la fila. Si no existe un recurso del centro con ese ID,

se devuelve 404 RECURSO\_NO\_DISPONIBLE.



Se mantienen la consulta parametrizada, la validación del ID

y los controles de sesión, cuenta activa y permisos.



\## Preparación local



Usar una base de ensayo con las migraciones aplicadas.

Configurar .env localmente sin subir credenciales.



Las pruebas documentadas utilizaron:

\- Base: aula\_circular\_devoluciones\_ensayo.

\- Cuenta docente activa.

\- Recurso 11: Manual de SQL, tipo fisico.

\- ID 2147483647: ausencia comprobada mediante SQL.



Los identificadores deben comprobarse en cada instalación.



\## Arranque en PowerShell



&#x20;   $env:NODE\_ENV = 'development'

&#x20;   $env:PORT = '3010'

&#x20;   $env:APP\_ORIGIN = 'http://127.0.0.1:3010'

&#x20;   node --env-file=.env .\\src\\app.mjs



\## Pruebas manuales realizadas



Iniciar sesión en http://127.0.0.1:3010.

Consultar las rutas y observar estado y respuesta en Red.



| Entrada | Esperado | Observado |

| --- | --- | --- |

| /api/ensayo/recursos/11 | 200 y ficha correcta | 200; Manual de SQL, fisico |

| /api/ensayo/recursos/2147483647 | 404 controlado | 404; RECURSO\_NO\_DISPONIBLE |

| /api/ensayo/recursos/abc | 422 controlado | 422; DATOS\_INVALIDOS |



Antes de corregir, el ID inexistente devolvía HTTP 500.

Después, los rechazos no muestran SQL ni trazas internas.



\## Evidencia y ayuda



Capturas del navegador incluidas en el PDF de la práctica.

Ayuda de IA para preparar el caso, explicar la causa,

proponer la corrección y organizar la documentación.



No compartir cookies, tokens, contraseñas ni archivos .env.

