-- Seed data for EQEmu Login Server

USE eqemu_login;

-- Server list types (required by loginserver binary)
INSERT INTO login_server_list_types (id, description) VALUES
  (1, 'Legends'),
  (2, 'Preferred'),
  (3, 'Standard');

-- API token seeded by 04-grants.sh (reads LOGINSERVER_API_TOKEN env var at runtime)

-- Health check account (required when auto_create_accounts is false)
-- The loginserver health check probes localhost:5999 with these credentials
-- Password is scrypt-hashed via the loginserver's security mode 14
-- We'll create a placeholder; the actual hash will be set by the first API call
-- For now, insert with a known scrypt hash for 'healthcheckpassword'
