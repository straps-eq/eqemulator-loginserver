-- OAuth identity provider links
CREATE TABLE IF NOT EXISTS platform_oauth_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  platform_account_id INT NOT NULL,
  provider ENUM('google', 'discord') NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  provider_email VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_provider_user (provider, provider_user_id),
  INDEX idx_platform (platform_account_id)
);

-- Make password_hash nullable for OAuth-only accounts
ALTER TABLE platform_accounts MODIFY COLUMN password_hash TEXT NULL;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_oauth_links TO 'eqemu_web'@'%';
