-- Add display_tier column to server_profiles for web-only tier display
-- NULL = auto-computed from population rules; set value = admin override
ALTER TABLE `server_profiles` ADD COLUMN IF NOT EXISTS `display_tier` ENUM('legends', 'preferred', 'standard') DEFAULT NULL AFTER `claimed_by_admin_id`;

-- Platform config table for tier population thresholds and other settings
CREATE TABLE IF NOT EXISTS `platform_config` (
  `config_key` VARCHAR(100) NOT NULL PRIMARY KEY,
  `config_value` TEXT NOT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Default population thresholds
INSERT INTO `platform_config` (`config_key`, `config_value`) VALUES
  ('tier_legends_min_players', '100'),
  ('tier_preferred_min_players', '25')
ON DUPLICATE KEY UPDATE `config_value` = VALUES(`config_value`);

-- Grants handled by mariadb/init/04-grants.sh and upgrade agent
