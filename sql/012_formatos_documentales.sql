-- ============================================================
-- AULA CIRCULAR
-- Publicar archivos y documentos por curso
-- Área: Biblioteca y Documentos
-- Ampliación de formatos para archivos protegidos.
-- Mantiene compatibilidad con los metadatos anteriores.
-- ============================================================
BEGIN;

ALTER TABLE metadato_digital
DROP CONSTRAINT metadato_digital_formato_check;

ALTER TABLE metadato_digital
ADD CONSTRAINT metadato_digital_formato_check
CHECK (formato IN ('PDF', 'JPG', 'PNG', 'DOCX', 'TXT', 'ODT'));

COMMIT;
