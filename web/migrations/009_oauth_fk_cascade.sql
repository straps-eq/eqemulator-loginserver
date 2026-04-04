-- Fix column type to match platform_accounts.id (unsigned)
ALTER TABLE platform_oauth_links
  MODIFY COLUMN platform_account_id INT UNSIGNED NOT NULL;

-- Add foreign key with cascade delete so removing a platform account cleans up OAuth links
ALTER TABLE platform_oauth_links
  ADD CONSTRAINT fk_oauth_platform_account
  FOREIGN KEY (platform_account_id) REFERENCES platform_accounts(id)
  ON DELETE CASCADE;
