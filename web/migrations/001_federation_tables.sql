-- Federation tables for distributed loginserver network
-- Run against eqemu_login database

CREATE TABLE IF NOT EXISTS `federation_nodes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `endpoint_url` VARCHAR(255) NOT NULL,
  `public_key` VARCHAR(128) NOT NULL,
  `private_key` TEXT DEFAULT NULL,
  `is_self` TINYINT NOT NULL DEFAULT 0,
  `is_master` TINYINT NOT NULL DEFAULT 0,
  `is_approved` TINYINT NOT NULL DEFAULT 0,
  `status` ENUM('active','suspended','revoked') NOT NULL DEFAULT 'active',
  `last_sync_seq` BIGINT NOT NULL DEFAULT 0,
  `last_config_version` INT NOT NULL DEFAULT 0,
  `last_sync_at` DATETIME DEFAULT NULL,
  `last_heartbeat_at` DATETIME DEFAULT NULL,
  `bootstrap_token` VARCHAR(128) DEFAULT NULL,
  `bootstrap_expires_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_public_key` (`public_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `federation_config` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `config_key` VARCHAR(100) NOT NULL,
  `config_value` JSON NOT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `updated_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `federation_changelog` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `table_name` VARCHAR(64) NOT NULL,
  `row_id` INT NOT NULL,
  `operation` ENUM('insert','update','delete') NOT NULL,
  `origin_node_id` INT NOT NULL,
  `payload` JSON NOT NULL,
  `created_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_origin` (`origin_node_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `federation_audit_log` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `node_id` INT DEFAULT NULL,
  `action` VARCHAR(100) NOT NULL,
  `detail` JSON DEFAULT NULL,
  `created_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_node` (`node_id`),
  KEY `idx_fed_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Grant permissions to web user (adjust 'eqemu_web'@'%' as needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_nodes TO 'eqemu_web'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_config TO 'eqemu_web'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_changelog TO 'eqemu_web'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_audit_log TO 'eqemu_web'@'%';
-- FLUSH PRIVILEGES;
