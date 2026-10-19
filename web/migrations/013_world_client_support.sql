-- Client support per world, filled by the client probe.
-- Additive and idempotent: new tables only, nothing existing is changed.
-- See docs/client-probe.md.
-- verify: SELECT COUNT(*)=2 FROM information_schema.TABLES WHERE table_schema=DATABASE() AND table_name IN ('world_client_support','world_client_probe_optout')
--   world_client_support       latest probe result per (world, client)
--     status             supported | blocked | unsupported | error | unreachable
--     detail             short reason for the status (admin view only)
--     last_checked       when this client was last probed on this world
--     last_supported_at  last time the probe reached character select
--   world_client_probe_optout  worlds the probe must skip
CREATE TABLE IF NOT EXISTS `world_client_support` (
  `world_server_id` INT UNSIGNED NOT NULL COMMENT 'login_world_servers.id',
  `client` VARCHAR(16) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `detail` VARCHAR(255) NOT NULL DEFAULT '',
  `last_checked` DATETIME NOT NULL,
  `last_supported_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`world_server_id`, `client`),
  KEY `idx_wcs_last_checked` (`last_checked`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `world_client_probe_optout` (
  `world_server_id` INT UNSIGNED NOT NULL PRIMARY KEY COMMENT 'login_world_servers.id',
  `note` VARCHAR(255) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

GRANT SELECT, INSERT, UPDATE, DELETE ON `eqemu_login`.`world_client_support` TO 'eqemu_web'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `eqemu_login`.`world_client_probe_optout` TO 'eqemu_web'@'%';
FLUSH PRIVILEGES;
