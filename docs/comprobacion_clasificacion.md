# Comprobación de clasificación

## Caso CP-01 — Manual de referencia

Entrada:
Manual de SQL utilizado como material de consulta del centro.

Clasificación esperada:
- Área: Biblioteca
- Tipo: Físico
- Propietario: Centro educativo
- Modalidad: Préstamo
- Curso: CUR-01

Clasificación observada:
- Área: Biblioteca
- Tipo: Físico
- Propietario: Centro educativo
- Modalidad: Préstamo
- Curso: CUR-01

Resultado:
Correcto.

## Caso CP-02 — Solicitud administrativa

Entrada:
Plantilla general utilizada para solicitar material del centro.

Clasificación esperada:
- Área: Documentación
- Tipo: Digital
- Propietario: Centro educativo
- Curso: GENERAL
- Versión: v1

Clasificación observada:
- Área: Documentación
- Tipo: Digital
- Propietario: Centro educativo
- Curso: GENERAL
- Versión: v1

Resultado:
Correcto.

## Revisión de campos ambiguos

Durante la comprobación se detectó una posible ambigüedad entre el tipo
del recurso y el área o procedencia a la que pertenece.

Inicialmente se utilizaron los valores Físico, Digital, Enlace y Estudiantil
como si pertenecieran a una misma clasificación.

Después de revisar el modelo se decidió separar ambos conceptos:

- Área o procedencia:
  - Biblioteca
  - Libros / Estudiantil
  - Documentación

- Tipo o formato:
  - Físico
  - Digital
  - Enlace

De esta forma, "Estudiantil" no se utiliza como formato del recurso.
Un libro aportado por un alumno puede ser de tipo Físico y, al mismo
tiempo, pertenecer al área de Libros y tener procedencia Estudiantil.

### Decisión adoptada

La clasificación se realizará atendiendo primero a la finalidad y
procedencia del elemento y después a su tipo o formato.

Ejemplos:

- RC-03 Manual de SQL:
  Área Biblioteca · Tipo Físico · Procedencia Centro.

- LA-01 Fundamentos de programación:
  Área Libros · Tipo Físico · Procedencia Estudiantil.

- DOC-003 Plantilla de solicitud de material:
  Área Documentación · Tipo Digital · Procedencia Centro.

Esta separación evita utilizar un mismo campo para representar conceptos
diferentes y hace la clasificación más clara para futuras consultas.

## Casos conservados para futuras pruebas de acceso

Después de la revisión se mantienen recursos y documentos asociados a
distintos ámbitos de curso para poder utilizarlos posteriormente en las
pruebas de acceso de Aula Circular.

Casos conservados:

- RC-02 — Kit de electrónica básica
  - Área: Biblioteca
  - Curso: GENERAL
  - Permite comprobar el acceso a un recurso no limitado a un curso.

- DOC-001 — Guía de inicio del curso
  - Área: Documentación
  - Curso: CUR-01
  - Versión actual: v1

- DOC-002 — Listado de material escolar
  - Área: Documentación
  - Curso: CUR-02
  - Versión actual: v1

- DOC-003 — Plantilla de solicitud de material
  - Área: Documentación
  - Curso: GENERAL
  - Versión actual: v1

### Resultado de la revisión

La clasificación permite distinguir entre recursos generales y recursos
asociados a cursos concretos.

Se conservan intencionadamente documentos de CUR-01, CUR-02 y GENERAL
para poder comprobar posteriormente que el acceso y filtrado por curso
funcionan correctamente.

No se eliminan estos casos durante la revisión porque servirán como datos
de prueba en las siguientes fases del proyecto.