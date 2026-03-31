-- Platform tables for eqemulator.dev web application
-- User creation and grants handled by 04-grants.sh (reads env vars at runtime)

USE eqemu_login;

-- Platform accounts (separate identity from loginserver accounts)
CREATE TABLE IF NOT EXISTS platform_accounts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  verification_token VARCHAR(128) DEFAULT NULL,
  verification_expires_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Link platform accounts to loginserver accounts
CREATE TABLE IF NOT EXISTS account_login_links (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  platform_account_id INT UNSIGNED NOT NULL,
  login_account_id INT UNSIGNED NOT NULL,
  linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_login_account (login_account_id),
  INDEX idx_platform (platform_account_id)
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
  login_server_admin_id INT UNSIGNED DEFAULT NULL,
  description TEXT,
  website_url VARCHAR(255) DEFAULT NULL,
  discord_url VARCHAR(255) DEFAULT NULL,
  banner_image_url VARCHAR(255) DEFAULT NULL,
  expansion_era VARCHAR(50) DEFAULT NULL,
  custom_ruleset TEXT,
  tags JSON DEFAULT NULL,
  claimed_by_admin_id INT UNSIGNED DEFAULT NULL,
  display_tier ENUM('high', 'medium', 'low') DEFAULT NULL,
  show_player_count TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (world_server_id)
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

-- Platform config key-value store
CREATE TABLE IF NOT EXISTS platform_config (
  config_key VARCHAR(100) PRIMARY KEY,
  config_value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Link platform accounts to world server admin accounts
CREATE TABLE IF NOT EXISTS world_server_admin_links (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  platform_account_id INT UNSIGNED NOT NULL,
  login_server_admin_id INT UNSIGNED NOT NULL,
  account_password VARCHAR(255) NOT NULL DEFAULT '',
  linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin (login_server_admin_id),
  INDEX idx_ws_platform (platform_account_id)
);

