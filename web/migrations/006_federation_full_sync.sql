-- Federation full data sync support
-- Adds tracking columns and grants for replicating loginserver data to mesh nodes

-- Track which records came from federation sync vs local connections
ALTER TABLE `login_world_servers`
  ADD COLUMN `federation_source_node_id` INT DEFAULT NULL;

ALTER TABLE `login_server_admins`
  ADD COLUMN `federation_source_node_id` INT DEFAULT NULL;

-- Grant eqemu_web write access to loginserver tables for federation sync
GRANT INSERT, UPDATE, DELETE ON eqemu_login.login_accounts TO 'eqemu_web'@'%';
GRANT INSERT, UPDATE, DELETE ON eqemu_login.login_world_servers TO 'eqemu_web'@'%';
GRANT INSERT, UPDATE, DELETE ON eqemu_login.login_server_admins TO 'eqemu_web'@'%';
FLUSH PRIVILEGES;
