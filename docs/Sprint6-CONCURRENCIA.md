\# Sprint 6 — Concurrencia y reintentos



\## Base y alcance



Código de partida: 95bad2b.

Autor del ensayo de intercambios: Federico Aguado.

Itinerario: 370 horas.



Se comprueban las garantías existentes sin modificar el servidor:

reserva concurrente de dos intercambios, rollback antes del COMMIT

y repetición de entrega tras retener su resultado en el cliente de ensayo.



\## Ejecución



Usar PostgreSQL local, una base de ensayo y un .env privado con

las credenciales propias de aula\_app. Las dependencias se instalan

mediante npm.cmd ci --ignore-scripts.



Desde la raíz:



&#x20;   node --env-file=.env --test pruebas/concurrencia-intercambios.test.mjs



El test crea un esquema temporal, aplica las migraciones y prepara

cuentas ficticias. Lo elimina al terminar. No necesita arrancar

manualmente el servidor.



\## Casos comprobados



1\. E10/E20 y E10/E30 compiten por E10 con dos cuentas docentes.

&#x20;  Una barrera SQL confirma ambas peticiones esperando el bloqueo.

&#x20;  Resultado: HTTP 200 y HTTP 409 EJEMPLAR\_OCUPADO.

&#x20;  La ganadora tiene dos reservas; la perdedora queda intacta,

&#x20;  sin reservas ni eventos o avisos adicionales.



2\. Un trigger exclusivo del esquema temporal provoca un fallo

&#x20;  al insertar el aviso, antes del COMMIT.

&#x20;  Resultado: HTTP 500 ERROR\_INTERNO sin detalles SQL.

&#x20;  Operación, ítems, reservas, eventos y avisos conservan el estado previo.

&#x20;  Se retira el trigger y su función; el reintento reserva correctamente.



3\. El cliente del ensayo retiene el resultado de una entrega.

&#x20;  Antes de repetir, consulta el estado por HTTP y observa completada.

&#x20;  La repetición devuelve HTTP 200 con el estado existente:

&#x20;  cero reservas, un evento de entrega y ningún aviso adicional.

&#x20;  No se modifican propietarios históricos.

&#x20;  Esta simulación no acredita latencia real ni pérdida de conexión.



\## Diagnóstico durante el desarrollo



La primera ejecución del caso de respuesta tardía falló porque su bloque

estaba antes de retirar el trigger y reintentar la reserva.

Se corrigió el orden del test, conservando los resultados esperados

y sin modificar el servicio.



\## Regresión



Se ejecutaron conjuntamente anuncios, cesiones, devoluciones,

incidencias y el nuevo ensayo: 29 pruebas superadas y 0 fallos.



Las líneas P0001 corresponden a fallos provocados por las pruebas.



\## Pendientes y límites



El test E01 de Daniel no estaba incluido en la versión recibida.

Debe compartirse para permitir su reproducción.



Reproducción por otra pareja: pendiente de registrar autor, versión

y resultado real.



Se excluyen las ampliaciones de 500 horas: cancelación frente a entrega

e intercambios con orden inverso de libros.



Ayuda de IA: preparación y revisión del test y de la documentación;

ejecución local y comprobación de resultados por Federico.
