# Crear usuarios y materiales de intercambio

Este procedimiento prepara las cuentas de prueba de `users.md` y los anuncios indicados. Se puede ejecutar más de una vez: no duplica cuentas ni materiales.

## Requisitos

- Node.js 24.
- PostgreSQL local iniciado.
- `.env` configurado con `NODE_ENV=development`, `PGHOST=127.0.0.1` o `localhost` y la base de Aula Circular.
- Migraciones aplicadas con `npm.cmd run migrar`.

## Ejecución

Desde la raíz del proyecto, ejecutar en PowerShell:

```powershell
node --env-file=.env tests_Alberto/crearUsuarios.mjs
```

El script lee las cuentas desde `tests_Alberto/users.md`, guarda las contraseñas usando el hash de la aplicación y no las muestra ni las copia a otro archivo. Las cuentas nuevas quedan activas; las ya existentes conservan sus datos y contraseña. El usuario docente de dos columnas se crea con rol docente.

## Materiales

- `EJ-LA-03` se asigna a `A02`.
- `EJ-LA-04` se asigna a `A06`.
- `Iniciación a la programación - JAVA` se asigna a `A01`; si no existe, se crea con el código `EJ-LA-07`.
- `EJ-LA-01` y `EJ-LA-05` se asignan aleatoriamente a alumnos activos de DAW1.
- `EJ-LA-02` y `EJ-LA-06` se asignan aleatoriamente a alumnos activos de DAW2.

Los tres anuncios nuevos/anteriormente preparados quedan marcados para intercambio. Los cuatro ejemplares de la serie que se asignan aleatoriamente mantienen su modalidad de demostración. Al elegir alumno, el script prioriza quienes tienen menos ejemplares asignados (primero los que no tienen ninguno) y desempata aleatoriamente.

Las asignaciones existentes se conservan si el propietario sigue siendo un alumno activo del curso correspondiente. Si el propietario no cumple esas condiciones, se vuelve a asignar a un alumno válido. El bloqueo transaccional evita que dos ejecuciones simultáneas elijan alumnos de forma conflictiva; volver a ejecutar el script no cambia asignaciones válidas ni duplica materiales.

Los ejemplares nuevos se crean como materiales físicos del alumnado, publicados, con asignatura `General`, edición `2026` y conservación indicada en el script. Si el material nuevo ya existe, se reutiliza en vez de duplicarlo.

`users.md` contiene contraseñas de prueba en texto claro. Mantén ese archivo local y privado; no lo subas a un repositorio público.
