-- ============================================================
-- AULA CIRCULAR - T8
-- Vigencia predeterminada de versiones documentales
-- ============================================================

-- Una nueva versión comienza como borrador.
-- La publicación explícita establece actual = true
-- y estado_version = 'vigente'.

ALTER TABLE documento_version
ALTER COLUMN actual SET DEFAULT false;
