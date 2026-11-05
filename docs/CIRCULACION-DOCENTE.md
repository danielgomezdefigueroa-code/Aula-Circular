# Conectar entregas y solicitudes en el panel docente

Versión: circulación-docente-v1 (05/11/2026). Pantalla: `/html/docencia.html#circulacion`.

La cola agrupa revisar, asignar, entregar y devolver; admite modalidad, curso,
estado, vencimiento y páginas de hasta 20 registros. Cada tarjeta muestra material,
edición, conservación, participantes por identificador, condición previa y bloqueos
conocidos. La confirmación muestra ambos ejemplares del intercambio. Tras el POST,
se recarga y se informa del estado confirmado por el servidor.

## Preparación y reproducción

1. Con PostgreSQL local preparado y `.env` privado: `npm run migrar`.
2. `npm start`. Acceder con una cuenta que tenga rol docente explícito.
3. `npm test`: 36 pruebas, incluyendo 7 casos nuevos bajo una prueba de integración.
   Las pruebas crean y eliminan esquemas aleatorios aislados con datos ficticios.
4. El resultado de circulación se escribe en `evidencias/circulacion/resultados.json`.
   Se conservan entorno, casos, reservas comunes y huellas SHA-256 del código.

Para repetir también la prueba de pantalla en PowerShell, con Playwright disponible:

```powershell
$env:VERIFICAR_PANTALLA='1'
$env:PLAYWRIGHT_MODULO='ruta absoluta al módulo playwright instalado'
npm test
```

Utiliza Edge instalado en modo headless; comprueba reserva y entrega desde la
pantalla, errores JavaScript y ausencia de desbordamiento a 320 px. Guarda capturas.
No acredita una auditoría completa de accesibilidad ni una revisión humana.

## Rutas y reglas

- `GET /api/gestion/cola`: solo docente activo. Total y página provienen de una
  consulta con la misma instantánea; un intercambio cuenta una sola vez.
- `POST /api/solicitudes` y `/api/gestion/solicitudes/:id/asignar`:
  préstamo del centro o alumno y cesión. Solicitar no reserva; asignar reserva,
  actualiza solicitudes y genera avisos en una transacción.
- `POST /api/intercambios`: alumno propietario, `ejemplarA`, `ejemplarB`,
  `confirmoPropuesta:true`. Registra consentimiento del proponente.
- `POST /api/intercambios/:id/aceptar`: propietario participante, `version`.
- `POST /api/gestion/intercambios/:id/reservar`: docente, `version`.
  Exige ambos consentimientos, propiedad y disponibilidad actuales.
- `/api/gestion/operaciones/:id/entregar`: `version`, y para préstamo,
  `vencimiento` como fecha ISO válida futura. Préstamo pasa a prestada y mantiene
  reserva; cesión/intercambio se completan y retiran material del circuito.
- `.../devolver`: préstamo prestado, `version` y `conservacion` apta descrita.
- `.../incidencias`: `version` y `motivo`; conserva reserva y bloquea entrega/retorno.
- `.../resolver`: `version`, `motivo`, `resolucion` apto/baja; baja solo préstamo,
  retira material y cierra por incidencia. Apto habilita el siguiente paso real.
- `.../cancelar`: solo antes de entrega, `version` y `motivo`.

La cola añade campos de vencimiento/conservación que deben cumplimentarse antes
de confirmar. La disponibilidad visible es orientativa: cada escritura revalida
identidad y permiso y bloquea ejemplares por ID ascendente, después la operación.
La reserva activa tiene clave única por ejemplar. Las dos unidades de intercambio
se modifican en una transacción o ninguna. Pantallas antiguas reciben 409.

Compatibilidad: las rutas anteriores de cesión admiten omitir `version`; siguen
revalidando estado, bloqueo e idempotencia. El panel nuevo siempre envía versión.
Repetir una entrega de cesión antigua no duplica eventos ni avisos.

Los avisos solo se dirigen a participantes afectados (incluidos solicitantes cuya
petición queda rechazada al asignar), nunca al administrador por su mero rol.
Los listados de operaciones muestran historial de cualquier modalidad al participante.
La pantalla de historial remite las acciones docentes a la cola unificada.

## Evidencia y revisión

PDF: `output/pdf/Ejercicio-conectar-entregas-solicitudes.pdf` (máximo cinco páginas).
Registros y capturas: `evidencias/circulacion/`.
La evidencia separa resultados reales de expectativas y revisión humana pendiente.
No atribuye trabajo a un segundo integrante sin información ni declara subida a FCTconecta.
