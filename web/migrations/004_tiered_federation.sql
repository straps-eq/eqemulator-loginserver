-- Tiered federation architecture migration
-- Run against eqemu_login database AFTER 003_security_phase3.sql

-- Add node_tier column — 'official' for trusted full-sync nodes, 'mesh' for community read-only nodes
ALTER TABLE `federation_nodes` ADD COLUMN IF NOT EXISTS `node_tier` ENUM('official', 'mesh') NOT NULL DEFAULT 'mesh' AFTER `status`;

-- Master nodes are always official
UPDATE `federation_nodes` SET `node_tier` = 'official' WHERE `is_master` = 1;
