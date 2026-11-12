-- Sprint 5, tarea 3.5.3: estado leído de los avisos internos.
-- Aplicar con scripts/migrar.mjs después de 007, en un entorno de ensayo.
-- El ejecutor ya proporciona BEGIN/COMMIT; este archivo no abre otra transacción.

ALTER TABLE aviso ADD COLUMN IF NOT EXISTS leido boolean NOT NULL DEFAULT false;
