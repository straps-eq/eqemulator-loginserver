-- Node status reported through the federation heartbeat (web 1.7.0+).
-- Additive and idempotent: nullable columns, guarded with IF NOT EXISTS.
-- Web 1.7.0 tolerates these columns being absent (falls back to software_version only).
--   updater_status      JSON document from the node's updater (/host-state/updater-status.json), stored as text
--   federation_protocol federation protocol revision the node speaks (2 = 1.7.0)
--   last_status_at      when the node last reported its status
ALTER TABLE federation_nodes ADD COLUMN IF NOT EXISTS updater_status TEXT DEFAULT NULL;
ALTER TABLE federation_nodes ADD COLUMN IF NOT EXISTS federation_protocol INT DEFAULT NULL;
ALTER TABLE federation_nodes ADD COLUMN IF NOT EXISTS last_status_at DATETIME DEFAULT NULL;
