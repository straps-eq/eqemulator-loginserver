-- Platform tables for eqemulator.dev web application

USE eqemu_login;

-- Web app DB user with limited permissions
-- Password must match DB_WEB_PASSWORD in .env
CREATE USER IF NOT EXISTS 'eqemu_web'@'%' IDENTIFIED BY 'CHANGE_ME_DB_WEB_PASSWORD';
GRANT SELECT ON eqemu_login.login_accounts TO 'eqemu_web'@'%';
GRANT SELECT ON eqemu_login.login_world_servers TO 'eqemu_web'@'%';
GRANT SELECT ON eqemu_login.login_server_list_types TO 'eqemu_web'@'%';
GRANT SELECT ON eqemu_login.login_api_tokens TO 'eqemu_web'@'%';

-- Email verification / platform account state
CREATE TABLE IF NOT EXISTS platform_accounts (
  login_account_id INT UNSIGNED PRIMARY KEY,
  email VARCHAR(255) DEFAULT NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  verification_token VARCHAR(128) DEFAULT NULL,
  verification_expires_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Web session management
CREATE TABLE IF NOT EXISTS platform_sessions (
  id VARCHAR(64) PRIMARY KEY,
  login_account_id INT UNSIGNED NOT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_account (login_account_id),
  INDEX idx_expires (expires_at)
);

-- Platform admin roles
CREATE TABLE IF NOT EXISTS platform_admins (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  login_account_id INT UNSIGNED NOT NULL,
  role ENUM('admin', 'moderator') NOT NULL DEFAULT 'moderator',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (login_account_id)
);

-- Server directory profiles
CREATE TABLE IF NOT EXISTS server_profiles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  world_server_id INT UNSIGNED NOT NULL,
  description TEXT,
  website_url VARCHAR(255) DEFAULT NULL,
  discord_url VARCHAR(255) DEFAULT NULL,
  banner_image_url VARCHAR(255) DEFAULT NULL,
  expansion_era VARCHAR(50) DEFAULT NULL,
  custom_ruleset TEXT,
  tags JSON DEFAULT NULL,
  claimed_by_admin_id INT UNSIGNED DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (world_server_id)
);

-- Server stats snapshots (every 5 min)
CREATE TABLE IF NOT EXISTS server_stats_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  world_server_id INT UNSIGNED NOT NULL,
  players_online INT UNSIGNED NOT NULL DEFAULT 0,
  zones_booted INT UNSIGNED NOT NULL DEFAULT 0,
  status INT NOT NULL DEFAULT 0,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_server_recorded (world_server_id, recorded_at)
);

-- Server ownership claims
CREATE TABLE IF NOT EXISTS server_claims (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  world_server_id INT UNSIGNED NOT NULL,
  login_account_id INT UNSIGNED NOT NULL,
  verification_method ENUM('tag', 'admin_key') NOT NULL,
  verification_token VARCHAR(64) DEFAULT NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_server (world_server_id)
);

-- Grant web user access to platform tables
GRANT ALL ON eqemu_login.platform_accounts TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.platform_sessions TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.platform_admins TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.server_profiles TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.server_stats_history TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.server_claims TO 'eqemu_web'@'%';

FLUSH PRIVILEGES;
