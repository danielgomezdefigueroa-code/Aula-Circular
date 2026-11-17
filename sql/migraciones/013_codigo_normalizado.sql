-- T14: impide reutilizar un codigo cambiando mayusculas o espacios exteriores.
-- Se suma al UNIQUE(codigo) ya existente, sin modificar datos historicos.
CREATE UNIQUE INDEX ejemplar_codigo_normalizado_unico
ON ejemplar (UPPER(BTRIM(codigo)));
