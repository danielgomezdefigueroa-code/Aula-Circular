
-- ============================================================
-- AULA CIRCULAR - T8
-- Gestión de versiones y descargas autorizadas
-- ============================================================

-- 1. Estado individual de cada versión documental.
ALTER TABLE documento_version
ADD COLUMN estado_version text NOT NULL DEFAULT 'borrador';

ALTER TABLE documento_version
ADD CONSTRAINT documento_version_estado_valido
CHECK (
  estado_version IN ('borrador', 'vigente', 'historica')
);

-- 2. Adaptar los datos existentes de T6.
-- Las versiones actuales de documentos publicados
-- pasan a ser vigentes.
UPDATE documento_version v
SET estado_version = 'vigente'
FROM documento d
WHERE v.documento_id = d.id
  AND d.estado_editorial = 'publicado'
  AND v.actual = true;

-- Las versiones no actuales de documentos publicados
-- se conservan como históricas.
UPDATE documento_version v
SET estado_version = 'historica'
FROM documento d
WHERE v.documento_id = d.id
  AND d.estado_editorial = 'publicado'
  AND v.actual = false;

-- Las versiones de documentos no publicados
-- se consideran borradores.
UPDATE documento_version v
SET estado_version = 'borrador',
    actual = false
FROM documento d
WHERE v.documento_id = d.id
  AND d.estado_editorial <> 'publicado';

-- 3. Coherencia entre el estado y la vigencia.
ALTER TABLE documento_version
ADD CONSTRAINT documento_version_vigencia_coherente
CHECK (
  (estado_version = 'vigente' AND actual = true)
  OR
  (estado_version IN ('borrador', 'historica')
   AND actual = false)
);

-- El índice documento_version_actual de T5
-- ya impide dos versiones vigentes por documento.
-- No es necesario duplicarlo.

-- 4. Índice para consultar versiones y estados.
CREATE INDEX idx_documento_version_estado
ON documento_version (documento_id, estado_version);
