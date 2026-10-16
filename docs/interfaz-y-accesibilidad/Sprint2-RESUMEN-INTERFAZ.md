# Sprint 2 · Resumen de la interfaz y el montaje local

**Fecha:** 16 de octubre de 2026
**Rama:** `sprint1-interfaz-y-accesibilidad`

Resumen del trabajo reciente sobre la parte pública de la web (`public/`) y del montaje local con el que se ha verificado contra la API real. Complementa a `docs/Sprint2-INTEGRACION.md` (cuentas y sesiones) y `docs/Sprint2-PARA-FEDE.md`.

## 1. Qué se ha hecho

1. **Reorganización de `public/` en carpetas** (`html/`, `mjs/`, `css/`, `local/`) y **seis páginas**: `login.html` aparte (sin menú) y cinco con estructura común: `index`, `biblioteca`, `libros`, `documentacion` y `mi-espacio`.
2. **Shell común** (`mjs/shell.mjs`): comprueba la sesión contra `/api/yo` al cargar, pinta el menú según permisos y estado, avisa si la cuenta está pendiente o suspendida y conecta el cierre de sesión. Tolera páginas sin zona de sesión y recomprueba la sesión al volver con el botón atrás.
3. **Bloque de sesión movido a «Mi espacio»**: «Sesión: alias» y «Cerrar sesión» viven solo en `mi-espacio.html`, fuera de las cabeceras. Decisión tomada: «Mi espacio» se muestra a cualquier sesión (así una cuenta pendiente o admin también pueden cerrar sesión); las tres áreas siguen reservadas a cuentas activas.
4. **Muestra temporal de las áreas**: Biblioteca, Libros y Documentación pintan 9 recursos ficticios (3 por área) con scripts clásicos de `local/`, para poder verlas antes de conectarlas a la API. Se retirará cuando cada página tenga su módulo de API (paso 3).
5. **Accesibilidad del login**: al cargar, el foco entra en el título de la página (`tabindex="-1"`) y `aria-labelledby` apunta a él.
6. **Montaje local verificado**: PostgreSQL 17.11 (clúster de usuario) + servidor Node; comprobadas las cuatro cuentas de ensayo contra la API real (matriz en el apartado 4).
7. **Limpieza de restos**: retirados los tres módulos sin uso (`sesion.mjs`, `acceso.mjs`, `catalogo.mjs`), el bloque muerto de formularios del Inicio (`#zona-forms`), el CSS sin uso (`.boton-cabecera`, `#estado`, `.t-enlace`), las clases sin efecto (`presentacion`, `contenido`, `contenedor-casilla`) y los comentarios desfasados.

## 2. Estructura de `public/`

```
public/
├── index.html              Puerta provisional: redirige a html/index.html
├── css/
│   └── estilo.css          Hoja de estilos común
├── html/
│   ├── login.html          Acceso, registro y estados de cuenta (sin shell)
│   ├── index.html          Inicio
│   ├── biblioteca.html     Área Biblioteca (muestra temporal)
│   ├── libros.html         Área Libros (muestra temporal)
│   ├── documentacion.html  Área Documentación (muestra temporal)
│   └── mi-espacio.html     Mi espacio: sesión y cierre de sesión
├── mjs/
│   ├── shell.mjs           Estructura, sesión y menú comunes
│   └── login.mjs           Lógica del acceso, registro y activación
└── local/
    ├── datos.js            9 recursos ficticios (catálogo y muestras)
    ├── motor.js            Filtros del catálogo de muestra
    ├── catalogo-local.js   Catálogo de muestra del Inicio
    └── muestra-area.js     Muestra temporal de las páginas de área
```

- Los scripts de `local/` son clásicos a propósito: así las muestras también funcionan al abrir el HTML como archivo (`file://`), sin servidor.
- Los módulos de `mjs/` son ES modules y necesitan servidor. Las cinco páginas con estructura cargan `shell.mjs` directamente.
- La muestra se retira borrando `local/muestra-area.js` y las dos etiquetas `<script>` (de `datos.js` y de `muestra-area.js`) en las tres páginas de área.

## 3. El shell y su contrato

El shell es el módulo común de las cinco páginas con estructura. Ofrece a los módulos de cada página:

- `listo`: promesa con la sesión ya comprobada.
- `pedir(ruta)` y `enviar(ruta, cuerpo)`: peticiones a la API (CSRF incluido); `leerJson(respuesta)`, `irALogin()`, `avisar(texto)`.
- `puedeVerAreas(identidad)`: decide si la cuenta puede usar las tres áreas.

Avisa en `document` con el evento `aula:sesion` cuando recomprueba la sesión (importante para el botón atrás). La zona de sesión usa los ids `#zona-sesion`, `#sesion-alias` y `#boton-salir`.

## 4. Sesión y permisos (verificado contra la API)

| Cuenta de ensayo | Perfil | `/api/yo` | `/api/biblioteca` | Menú que ve |
| --- | --- | --- | --- | --- |
| A01 | alumno · activa | 200 | 200 · 2 recursos | 3 áreas + Mi espacio |
| D01 | docente · activa | 200 | 200 · 2 recursos | 3 áreas + Mi espacio |
| P01 | alumno · pendiente | 200 (estado pendiente) | 403 `CUENTA_NO_ACTIVA` | Mi espacio + aviso |
| ADM01 | admin | 200 | 403 `PERMISO_INSUFICIENTE` | Mi espacio |

- Cuenta suspendida: `/api/yo` responde 403 y el shell redirige al login.
- Los POST van protegidos con CSRF (cabecera `X-CSRF-Token` + cookie de sesión + `Origin`); hay límite de intentos en acceso (5/15 min por ip+correo) y general (30/15 min).
- Las cuentas son ficticias. `.cuentas-ensayo.json` y `.env` están en `.gitignore` y no se comparten; no contienen datos reales.

## 5. Montaje local (esta máquina)

- Comprobado: `/api/salud` → `{"estado":"listo","baseDatos":true}` y `/api/csrf` → 200.
- Los servicios del sistema (`postgresql`, `postgresql17`) siguen sin inicializar en esta máquina y no se usan: la base de trabajo es el clúster del home.
- Páginas: `http://127.0.0.1:3000/html/…` (login en `http://127.0.0.1:3000/html/login.html`). La raíz `/` sirve por ahora `public/index.html`, una puerta que redirige con JavaScript a `html/index.html` (hay una decisión pendiente, apartado 6).
- Recorrido rápido: entrar en `login.html` con A01 y comprobar que «Mi espacio» muestra «Sesión: A01» y «Cerrar sesión»; con P01 aparece además el aviso de estado y no hay enlaces a las áreas.
- En otras máquinas, seguir `docs/GUIA-LABORATORIO.md` (pendiente de actualizar: aún cita rutas antiguas).

## 6. Pendientes y próximos pasos

1. **Entrada `/` (decide el equipo)**: opción A, recomendada: borrar la puerta y añadir `app.get('/', res.redirect('/html/index.html'))` a `src/app.mjs`, antes de `express.static`; opción B: renombrar `html/index.html` a `inicio.html` y mantener la puerta.
2. **Paso 3 (siguiente trabajo)**: un módulo de API por página. Biblioteca contra `/api/biblioteca`; Libros y Documentación mostrarán «todavía no disponible» si el servidor responde 404; Mi espacio queda hueco provisional. El Inicio ya está en su forma definitiva: sin secciones de área, sin el bloque muerto `#zona-forms` y cargando `shell.mjs` directamente.
3. **Pruebas en navegador y teclado** (sin sesión, pendiente, activa, cierre y botón atrás) con A01 y D01. Con el recorrido anotado se preparará la **evidencia de la tarea 2.2.3** (PDF de ≤5 páginas y ≤10 MB).
4. **Documentación**: actualizar `docs/GUIA-LABORATORIO.md`, que aún cita rutas antiguas (p. ej. `public/catalogo.mjs`).
5. **Sin decidir**: campos de filtro (buscar / solo disponibles) en las páginas de área; mostrar u ocultar la muestra según la sesión; ubicación del enlace «Ayuda»; nombre del endpoint de Mi espacio (coordinar con la tarea 2.2.5).

## 7. Ver también

- `docs/Sprint2-INTEGRACION.md` — integración de cuentas y sesiones (backend).
- `docs/Sprint2-PARA-FEDE.md` — pautas para el compañero.
- `docs/GUIA-LABORATORIO.md` — montaje en otras máquinas (desactualizado en rutas).
- Ficha de la tarea 2.2.3 «Conectar registro, acceso y menú a la API».
