-- Marcar leído solo afecta al aviso, no a su operación ni a sus eventos.
ALTER TABLE aviso ADD COLUMN leido_en timestamptz;
CREATE INDEX aviso_destinatario_orden ON aviso(destinatario_id, creado_en DESC, id DESC);
CREATE INDEX operacion_item_destino ON operacion_item(destino_usuario_id, operacion_id);
CREATE INDEX operacion_item_origen ON operacion_item(origen_usuario_id, operacion_id);
