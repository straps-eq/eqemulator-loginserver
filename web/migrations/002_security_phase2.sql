-- Phase 2 security hardening migration
-- Run against eqemu_login database AFTER 001_federation_tables.sql

-- Widen private_key column to TEXT to support encrypted values
ALTER TABLE `federation_nodes` MODIFY COLUMN `private_key` TEXT DEFAULT NULL;

-- Origin map table — tracks which node owns each row in synced tables
-- Used for robust origin authority checks that survive changelog pruning
CREATE TABLE IF NOT EXISTS `federation_origin_map` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `table_name` VARCHAR(64) NOT NULL,
  `row_id` INT NOT NULL,
  `origin_node_id` INT NOT NULL,
  `created_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_table_row` (`table_name`, `row_id`),
  KEY `idx_origin_node` (`origin_node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Grant permissions to web user
-- GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_origin_map TO 'eqemu_web'@'%';
-- FLUSH PRIVILEGES;
