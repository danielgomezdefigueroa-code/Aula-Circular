# SQL histórico

Esta carpeta conserva scripts SQL antiguos como referencia. **No se ejecutan** al arrancar el servidor ni forman parte de la instalación actual.

Los archivos activos están fuera de esta carpeta:

- `sql/001_laboratorio.sql`: datos ficticios de demo, inventario, anuncios y documentos.
- `sql/migraciones/002_cuentas.sql` a `sql/migraciones/005_documentos.sql`: esquema aplicado por `npm run migrar`.

## Contenido

- `inventario_raisa_historico.sql`: inventario y documentos del modelo antiguo. No es compatible con las migraciones actuales.
- `002_cuentas.sql`, `003_sesiones.sql` y `004_recursos_ensayo.sql`: pasos antiguos del Sprint 2, sustituidos por `sql/migraciones/002_cuentas.sql` y el resto de migraciones actuales.
- `002_usuarios.sql`: modelo de referencia de cuentas.
- `005_catalogo_biblioteca.sql`, `006_validacion_ejemplares.sql`, `007_datos_biblioteca.sql` y `008_metadatos_digitales.sql`: esquema y datos antiguos del área de Biblioteca.
- `005_ejercicio_231.sql` y `005_ejercicio_231_dump.sql`: ejercicio didáctico de la tarea 2.3.1, no una migración del producto.

Ninguno de estos archivos debe aplicarse sobre la base actual sin revisar antes su cabecera y su compatibilidad.
