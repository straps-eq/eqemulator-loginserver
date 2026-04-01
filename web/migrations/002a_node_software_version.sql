-- Track software version reported by each federation node
ALTER TABLE federation_nodes ADD COLUMN IF NOT EXISTS software_version VARCHAR(32) DEFAULT NULL;
