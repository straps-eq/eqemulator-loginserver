-- Federation server status cache
-- Updated by the web app during federation sync with live server data from peers.
-- Read by the loginserver to inject federated servers into the EQ client server list.
CREATE TABLE IF NOT EXISTS `federation_server_status` (
  `world_server_id` INT UNSIGNED NOT NULL PRIMARY KEY COMMENT 'FK to login_world_servers.id (local synced copy)',
  `remote_ip` VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'Public IP of the world server',
  `players_online` INT UNSIGNED NOT NULL DEFAULT 0,
  `server_status` INT NOT NULL DEFAULT 0 COMMENT '0=up, negative=down/locked',
  `zones_booted` INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Grant loginserver read access
GRANT SELECT ON `eqemu_login`.`federation_server_status` TO 'eqemu_ls'@'%';
-- Grant web app write access
GRANT SELECT, INSERT, UPDATE, DELETE ON `eqemu_login`.`federation_server_status` TO 'eqemu_web'@'%';
FLUSH PRIVILEGES;
