# Preparar el nuevo curso sin perder operaciones abiertas

## Reproducir el caso

En la raíz del repositorio, con las dependencias instaladas y una conexión local a
PostgreSQL configurada en `.env`, ejecuta:

```powershell
node --env-file=.env --test tests/cambiosCurso.test.mjs
```

La prueba levanta Express en un puerto local, aplica las migraciones a un esquema
temporal, carga datos ficticios y genera tres PDFs de prueba que publica mediante
la API. Los archivos de la prueba y el esquema se retiran al terminar.

- A01 parte en DAW-1 con un préstamo entregado y reservado, una propuesta de
  intercambio y una cesión completada. A02 participa en el intercambio.
- En **Mi espacio → Perfil**, A01 elige DAW-2 y solicita el cambio. Su curso sigue
  siendo DAW-1. En **Validación de cuentas → Cambios de curso**, el docente ve el
  préstamo y la propuesta y confirma la solicitud.
- A01 puede refrescar **Mi espacio** con la misma sesión y ver DAW-2 y su aviso.
  En **Documentación** ve DAW-2 y general. Las descargas directas del curso
  anterior se rechazan con HTTP 403, tanto por ID de archivo como de versión.
  El filtro de otro curso en **Libros** permite consultar el catálogo.
- En **Cambios de curso**, el docente abre la ficha y registra la devolución con
  el estado de conservación y la confirmación de buen estado. Se libera la
  reserva del préstamo y se añade el evento de devolución.

## Datos y código

- `tests/cambiosCurso.test.mjs` contiene las entradas, los resultados esperados y
  los controles HTTP y SQL.
- `sql/migraciones/015_cambios_curso.sql` conserva curso de origen y destino,
  fecha de solicitud, docente y fecha de confirmación.
- `src/cambiosCurso.mjs` registra solicitud, confirma pertenencia y guarda el
  aviso en la misma transacción. El middleware de sesión vuelve a consultar la
  pertenencia desde PostgreSQL en cada petición.
- La prueba compara estados, vencimiento, reservas, participantes y eventos
  antes y después de confirmar. La devolución se prueba como acto posterior.

Al probar desde la interfaz, aplica antes las migraciones con `npm run migrar`
sobre tu base local de desarrollo. La prueba automatizada no requiere ese paso.
