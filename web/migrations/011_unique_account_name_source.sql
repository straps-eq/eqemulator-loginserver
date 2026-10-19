-- Add unique index on (account_name, source_loginserver) to prevent duplicate
-- accounts from name-based federation upserts.
-- Safe to apply: duplicates were verified absent before creating this migration.
-- verify: SELECT COUNT(*) FROM information_schema.STATISTICS WHERE table_schema=DATABASE() AND table_name='login_accounts' AND index_name='uq_name_source'

ALTER TABLE login_accounts
  ADD UNIQUE INDEX uq_name_source (account_name, source_loginserver);
