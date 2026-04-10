-- Add unique index on (account_name, source_loginserver) to prevent duplicate
-- accounts from name-based federation upserts.
-- Safe to apply: duplicates were verified absent before creating this migration.

ALTER TABLE login_accounts
  ADD UNIQUE INDEX uq_name_source (account_name, source_loginserver);
