-- Seed data for EQEmu Login Server

USE eqemu_login;

-- Server list types (required by loginserver binary)
INSERT INTO login_server_list_types (id, description) VALUES
  (1, 'Legends'),
  (2, 'Preferred'),
  (3, 'Standard');

-- API token for Next.js backend (read+write)
-- Generate your own: openssl rand -hex 32
-- Must match LOGINSERVER_API_TOKEN in .env
INSERT INTO login_api_tokens (token, can_write, can_read, created_at)
VALUES ('CHANGE_ME_GENERATE_WITH_openssl_rand_hex_32', 1, 1, NOW());

-- Health check account (required when auto_create_accounts is false)
-- The loginserver health check probes localhost:5999 with these credentials
-- Password is scrypt-hashed via the loginserver's security mode 14
-- We'll create a placeholder; the actual hash will be set by the first API call
-- For now, insert with a known scrypt hash for 'healthcheckpassword'
