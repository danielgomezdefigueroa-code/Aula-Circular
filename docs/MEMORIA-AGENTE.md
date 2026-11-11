# MEMORIA DEL AGENTE — Aula Circular

> Estado de trabajo, no fuente de alcance. Si choca con `conocimiento/02`, `03`, `07` o el código actual, mandan ellos.

## Estado actual (2026-11-11)

- Servidor local: `npm run start` en `http://127.0.0.1:3000` (sin `--watch`). Log en `/tmp/opencode/aula-circular.log`.
- BD: `aula_prueba_catalogo` en PostgreSQL local (ver `.env`, no versionado).
- Cuentas de ensayo ficticias en `.cuentas-ensayo.json` (no versionado). Las cuatro inician sesión correctamente.
- `catalogo@example.invalid` tiene rol **alumno**, no admin, aunque su alias sea `ADM01`.
- Los 12 ejemplares y 6 anuncios de demo tienen `propietario_usuario_id = NULL` (`sql/001_laboratorio.sql`).

## Cambios aplicados

- `public/html/mi-espacio.html`: `<div class="paginacion" hidden>`. El JS sigue encontrando `#anterior`, `#siguiente` y `#pagina`, así que no rompe. Pendiente de confirmación del usuario.
- `src/anuncios.mjs` (`GET /api/libros`): `JOIN usuario` → `LEFT JOIN usuario` y `COALESCE(u.alias,'Centro') AS propietario_alias`. Sin esto, los anuncios de demo (dueño `NULL`) desaparecían por el `INNER JOIN`.
- **3.5.3 (11 nov)**: `GET /api/libros` devuelve siempre `datos` y `total`, también sin filtros (antes cortaba con `sinDatos` y vaciaba Libros). `sql/migraciones/008_aviso_leido.sql` añade `aviso.leido`; el panel de Mi espacio devuelve `operacion_id` y `operacion_tipo`; `POST /api/avisos/:id/leido` marca solo avisos propios (404 ajeno, 422 id inválido). `public/mjs/mi-espacio.mjs` pinta «Nuevo/Leído», enlace al detalle y botón de marcar; los vacíos de las cinco secciones indican siguiente acción. `public/html/cesiones.html` carga `shell.mjs`. Evidencia: `evidencias/evidencia-3.5.3-responsive.html` y capturas `3.5.3-*.png`.

## Trampas verificadas

- **Servidor sin watch sirviendo código viejo**: el proceso arrancado el 5 nov 10:27 no tenía los cambios del commit `fe1d34f` (5 nov 11:23). Síntoma: `/api/mi-espacio/panel` daba 404 y `/api/libros` mostraba datos. Tras cualquier cambio en `src/`, reiniciar el proceso; comprobar con `ls -l src/*.mjs` frente a `ps -o lstart`.
- **`APP_ORIGIN` exacto**: abrir con `http://localhost:3000` devuelve `403 CSRF_INVALIDO` (el formulario lo muestra como «La sesión del formulario caducó»). Usar siempre `http://127.0.0.1:3000`.
- **Rate limit de login**: 30 intentos/15 min por IP y 5 fallos por cuenta. Se reinicia al reiniciar el servidor.
- **`/api/libros` exige dueño**: si se vuelve a usar `JOIN usuario` o se añaden anuncios con dueño `NULL`, la sección Libros saldrá vacía.
- **Columna usada antes de migrar**: el panel consultaba `aviso.leido` sin migración y devolvía 500 (PG 42703). Al añadir columnas, crear migración nueva y ejecutar `npm run migrar`; las pruebas crean su propio esquema y no avisan de que la base local está atrasada.
- **CSP sin scripts en línea**: `public/index.html` redirige con `<script>` en línea y la política `script-src 'self'` lo bloquea; la raíz `/` no redirige y deja solo el enlace. Usar `<meta http-equiv="refresh">` si se toca.
- **Reset universal y `<dialog>`**: `* { margin: 0 }` (estilo.css:12) anula el `margin: auto` nativo del `dialog` modal y lo pega arriba a la izquierda. Cualquier diálogo nuevo necesita `margin: auto` explícito. `.dialogo-intercambio` ya lo tiene.

## Comandos útiles

```bash
npm run start          # arranca en 3000 sin vigilar cambios
npm test               # suite contra PostgreSQL y HTTP reales
curl -s http://127.0.0.1:3000/api/salud
```

## Pendientes

- 500 h de 3.5.3: `tests/componentes.test.mjs` (textos largos) y revisión de contraste con herramienta documentada.
- Confirmar con el usuario si el paginador oculto de «Mi espacio» se queda. Con más de 20 anuncios propios no habría forma de pasar de página.
- Revisar si «Libros» debe listar solo anuncios de alumnos (y entonces asignar dueño a los datos de demo) o incluir los del centro con `COALESCE(...,'Centro')`.
- La base local tiene ahora datos de ensayo de 3.5.3: operación 1 (`cesion`, reservada) y avisos 1 y 2 para A01, creados a mano para la captura. Borrarlos si se quiere volver al estado inicial.
