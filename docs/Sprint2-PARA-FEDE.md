# Sprint 2: cuentas y continuación del trabajo

## Estado y reparto
Rama: Sprint2, creada desde sprint1-servidor-y-datos. Daniel prepara esquema, contraseñas y registro; Federico continúa sesiones, CSRF, acceso/salida, activación y permisos. La integración y revisión son conjuntas.
La base de cuentas está probada directamente en PostgreSQL. Todavía no hay rutas HTTP nuevas montadas en src/app.mjs ni autenticación completa. Faltan semillas activa/docente/admin y su alta local segura.

## Archivos
- sql/002_cuentas.sql: tablas curso, usuario y usuario_rol; dos cursos ficticios.
- src/cuentas/contraseñas.mjs: scrypt asíncrono con sal aleatoria; crearHash y comprobarClave.
- src/cuentas/registro.mjs: validarRegistro y registrarCuenta; alumno pendiente, campos rol/estado ignorados y respuesta genérica al repetir correo.
- tests/cuentas.test.mjs: dos pruebas locales de contraseña y validación.
- tests/registro-postgres.mjs: cinco comprobaciones directas en PostgreSQL; no realiza HTTP.

## Preparación en otro equipo
1. Revisar cambios locales y obtener Sprint2 sin sobrescribir trabajo. Instalar las dependencias fijadas con npm ci --ignore-scripts.
2. Preparar un .env local con PGHOST, PGPORT, PGDATABASE, PGUSER y PGPASSWORD. Nunca publicarlo ni compartir sus valores secretos.
3. Crear una base vacía aula_circular_sprint2_ensayo, propiedad de la cuenta local aula_app. Aplicar 002 una sola vez. Si sus tablas ya existen, detenerse y revisar.
4. Si se ejecutó la migración como postgres, asignar las tablas a aula_app desde esa cuenta, SOLO en la base de ensayo:
```sql
BEGIN;
ALTER TABLE public.curso OWNER TO aula_app;
ALTER TABLE public.usuario OWNER TO aula_app;
ALTER TABLE public.usuario_rol OWNER TO aula_app;
COMMIT;
```
Si se ejecutó como aula_app, este ajuste no es necesario. No repetir scripts que borren bases o datos del Sprint 1.

## Pruebas
Desde la raíz del repositorio:
```powershell
node --test .\tests\cuentas.test.mjs
node --env-file=.env .\tests\registro-postgres.mjs
```
Para la segunda prueba, el entorno debe seleccionar PGDATABASE=aula_circular_sprint2_ensayo, PGHOST local y PGUSER=aula_app. Una variable ya definida en la terminal tiene prioridad sobre el .env: comprobarla antes de ejecutar. La prueba rechaza otra configuración.
Genera una clave aleatoria que no se imprime y deja una cuenta ficticia pendiente por ejecución. No sirve como cuenta manual de login.

Resultados de Daniel el 9 de octubre de 2026: dos pruebas locales sin fallos; registro con código de función 202, alumno pendiente pese a docente/activo enviados, clave correcta aceptada e incorrecta rechazada sobre hash recuperado, correo repetido sin duplicado y misma respuesta, curso inexistente con código de función 422. No confundir estos códigos con respuestas HTTP.

## Contrato para integrar
Entrada: alias, correo, clave, cursoSolicitadoId (entero). registrarCuenta(pool, entrada) devuelve {codigo,cuerpo}. La ruta debe validar CSRF y limitar intentos antes del hash, y responder con ese resultado sin secretos.
comprobarClave(clave, hash) devuelve true/false. Contraseñas de 15 a 128 caracteres; sal distinta y receta scrypt de API y permisos.
usuario_rol permite varios roles explícitos; admin no implica docente. Para activar se necesitan curso_confirmado_id, validado_por y validado_en. Preparar un procedimiento local para la primera cuenta administradora sin clave fija en Git.

## Continuación de Federico
Contrastar las guías del profesor. Añadir semillas pendientes, sesiones persistentes en PostgreSQL, regeneración al entrar, cierre al salir, cookies y CSRF. Revalidar cuenta, roles y auth_version en cada petición. Implementar activación docente y permisos.
Probar HTTP real: registro, clave errónea, activación, acceso, salida, pendiente sin catálogo y alumno sin cambio de rol. Reiniciar Node y verificar persistencia de datos y sesiones. En plan 500, añadir revocación y fallo de conexión sin secretos.
src/app.mjs sigue siendo el laboratorio y usa recurso_demo, que no existe en esta base de cuentas. Acordar las migraciones de integración sin ejecutar scripts destructivos. La ruta pública de demostración no acredita permisos.

## Colaboración y documentación
Avisar antes de modificar servidor, dependencias o migraciones comunes. Mantener cambios nuevos en Sprint2; publicar con revisión y autorización. No forzar subidas. Integrar en sprint1-servidor-y-datos después de comprobar ambas partes; main requiere revisión y autorización del equipo.
PDF conjunto: máximo cinco páginas y 10 MB, versión, casos, esperado/observado, evidencias, aportación de ambos, ayuda de IA y revisión real. La revisión de Federico todavía no se ha realizado.
