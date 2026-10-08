# Tarea 2.2.1: sesión y permisos, paso a paso

Versión: ejemplo-2.2.1-v2. Rama: sprint1-servidor-y-datos, compartida con Federico.
Práctica individual de Daniel, separada del trabajo de Federico. No se cambia el servidor del equipo.

## Qué es cada archivo
- ejercicio.mjs: un ejemplo pequeño preparado con ayuda de Codex.
- README.md: explicación, pasos, capturas y texto para Docs.

IMPORTANTE: el programa ejecuta JavaScript, pero SIMULA respuestas. No hay peticiones HTTP reales, cookies, login ni PostgreSQL. La ficha permite ejemplos si se explica esta limitación y cómo repetir la prueba real.

## 1. Entender las cuentas
Abre ejercicio.mjs. Las cuentas alumno y docente tienen estado y rol.
const pone nombre a un dato; las llaves agrupan sus características.
Estado activo: cuenta admitida. Pendiente: espera validación. Rol: alumno o docente.
Como en el estadio: reconocerte por tu acreditación no significa que puedas entrar al vestuario.

## 2. Entender las condiciones
consultar es una función: recibe datos, comprueba condiciones y devuelve un resultado.
- if = «si ocurre esto».
- === = es igual a; !== = es distinto de.
- return = devuelve el resultado y termina esa consulta.
- null representa que no hay sesión.
Primero comprueba sesión (si falta, 401), luego estado (si no está activo, 403) y finalmente rol (si no es docente, 403). Si todo cumple, 200.
rolEnviado representa lo que declara el navegador. Se ignora al conceder permisos: se usa cuenta.rol.
Ocultar un botón no impide enviar directamente la petición a su ruta.

CAPTURA 1: código desde const alumno hasta el cierre de consultar.
Ctrl+P > ejercicio.mjs; Ctrl+F > const alumno. Busca, no escribas código nuevo.
Alt+Z ajusta líneas. Windows+Mayús+S recorta. Debe verse el nombre del archivo y el código completo.
Pie: Figura 1. Cuentas ficticias y comprobaciones de sesión, estado y rol.

## 3. Ejecutar
Antes de ver la salida, escribe tu predicción: ¿el docente pendiente podrá entrar aunque conserve el rol?
Terminal > Nuevo terminal, en la raíz de Aula-Circular:

    node .\tarea\daniel\sesiones\ejercicio.mjs

No instala nada, no abre un servidor y no modifica datos ni archivos.

Caso 1: sin sesión, esperado 401.
Caso 2: alumno activo, esperado 403.
Caso 3: docente activo, esperado 200.
Caso 4: alumno envía rol docente, esperado 403.
Caso 5 en la variante actual de Daniel: mismo docente, estado activo, esperado 200. La ejecución inicial pendiente/403 está documentada en el PDF.
Todos representan la misma consulta GET /zona-docente. Compara cada esperado y observado.

CAPTURA 2: aviso EJEMPLO DIDACTICO y casos 1, 2 y 3 completos.
Pie: Figura 2. Respuestas del ejemplo: 401, 403 y 200. No son respuestas HTTP de Aula Circular.

CAPTURA 3: caso 4, mostrando rol guardado alumno, rol enviado docente y resultado 403.
Pie: Figura 3. Enviar un rol no concede ese permiso.

## 4. Una modificación que hagas tú
La versión inicial traía docente.estado = 'pendiente'. Daniel la cambió a 'activo' y ajustó el esperado a 200. Esta es la variante actual publicada. Para comparar, puedes ensayar pendiente/403 y volver a activo/200; no afirmes que hiciste pasos que no has realizado.
Para tener una aportación sencilla propia:
1. Cambia únicamente 'pendiente' por 'activo' en esa línea.
2. Cambia el último esperado de 403 a 200.
3. Guarda con Ctrl+S, anota tu predicción y ejecuta el mismo comando.
4. Observa que el último caso tiene estado activo y devuelve 200.
5. Restablece 'pendiente' y el último esperado 403. Guarda y ejecuta.
6. Observa que la misma identidad docente ahora devuelve 403.
Así aislamos el estado: un alumno sería rechazado por su rol incluso estando activo.

CAPTURA 4: dos recortes del último caso, uno activo/200 y otro pendiente/403. Conserva estado, ruta, esperado y observado. Opcional: muestra la línea que cambiaste.
Pie: Figura 4. La misma identidad docente accede estando activa y pierde acceso estando pendiente.

No muestres .env, contraseñas, cookies ni otros datos privados de la terminal.

## 5. Diagrama y revisión
Este diagrama representa cómo debe funcionar la aplicación, no lo que ejecuta nuestra función:

    Navegador -> petición con cookie -> servidor
    Servidor -> sesión -> identidad
    Servidor -> base de datos -> estado y rol
    Servidor -> respuesta 401, 403 o 200

La cookie lleva un identificador. El servidor comprueba la sesión y consulta la cuenta en la base de datos.
Explícalo a un compañero y conserva un comentario real.

Para repetir la prueba real: cuando exista autenticación, iniciar sesión con alumno y docente ficticios en clientes separados; consultar la misma ruta protegida; cambiar el estado mediante el procedimiento autorizado de la base de ensayo y repetir con la sesión anterior. Guardar método, ruta, código HTTP y cuerpo, ocultando secretos.

## 6. Texto para Google Docs
Máximo tres páginas y 10 MB. Completa SOLO lo que realmente hagas.

PÁGINA 1
Título: Aula Circular · Sprint 2 · Explicar la sesión y los permisos.
Nombre: ___. Fecha: ___.
Objetivo: distinguir una sesión válida de un permiso.
Ejemplo utilizado: utilicé un ejemplo de JavaScript preparado con ayuda de Codex, con alumno y docente ficticios. Representa la lógica del servidor, pero no hace peticiones HTTP ni usa PostgreSQL.
Conceptos: la sesión permite reconocer al usuario; el estado indica si la cuenta está activa; el rol determina qué acciones puede realizar.
Coloca CAPTURA 1 con su pie.

PÁGINA 2
Comprobaciones: sin sesión esperaba 401; alumno activo, 403; docente activo, 200. En mi ejecución observé ___, ___ y ___. Son respuestas del ejemplo.
Coloca CAPTURA 2.
Intento de rol: enviando rol docente desde la identidad alumno esperaba 403; observé ___. Se comprueba el rol guardado, no el enviado.
Coloca CAPTURA 3.
Mi variante: cambié ___ por ___. Predije ___. Observé ___. Al restablecer pendiente observé ___.
Coloca CAPTURA 4 (dos recortes si hace falta).

PÁGINA 3
Coloca el diagrama del paso 5.
Mi explicación: [escribe con tus palabras por qué un docente pendiente no entra aunque conserve su identidad y rol].
Limitación: interpreto un ejemplo; no he probado sesiones reales. Para repetirlo en la aplicación [resume los pasos del apartado 5].
Versión: ejemplo-2.2.1-v2, ejercicio.mjs, rama sprint1-servidor-y-datos. Commit ___ cuando exista.
Ayuda y aportación: Codex preparó el ejemplo y las instrucciones. Yo ___ y comprobé ___.
Revisión: expliqué el resultado a ___ el día ___ y su comentario fue ___. Completar después de hacerlo.
No afirmar que el código lo escribiste sin ayuda ni inventar resultados/revisiones.

Exporta: Archivo > Descargar > Documento PDF. Comprueba tres páginas como máximo y capturas legibles.
Si no cabe, reduce texto repetido; no hagas ilegible el código.

Fuentes: ficha 2.2.1 AC-WEB-01, Guía del alumno y API y permisos. La ficha concreta manda.
Reflexión: basta con entender una condición, cambiarla y comprobar su efecto. No es una cita atribuida.
