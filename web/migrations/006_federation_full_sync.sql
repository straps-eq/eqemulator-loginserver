-- Federation full data sync support
-- Adds tracking columns and grants for replicating loginserver data to mesh nodes

-- Track which records came from federation sync vs local connections
ALTER TABLE `login_world_servers`
  ADD COLUMN IF NOT EXISTS `federation_source_node_id` INT DEFAULT NULL;

ALTER TABLE `login_server_admins`
  ADD COLUMN IF NOT EXISTS `federation_source_node_id` INT DEFAULT NULL;

-- Grants handled by mariadb/init/04-grants.sh and upgrade agent
