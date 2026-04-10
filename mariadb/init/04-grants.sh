#!/bin/bash
# Create eqemu_web DB user and seed API token using env vars.
# MariaDB Docker runs .sh files in /docker-entrypoint-initdb.d/ at init time.
# Environment variables are passed from docker-compose.yml.

set -e

mysql -u root -p"${MARIADB_ROOT_PASSWORD}" "${MARIADB_DATABASE:-eqemu_login}" <<EOSQL

-- Create web application DB user
CREATE USER IF NOT EXISTS 'eqemu_web'@'%' IDENTIFIED BY '${DB_WEB_PASSWORD}';

-- Loginserver tables: SELECT always, plus write access for federation sync
GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.login_accounts TO 'eqemu_web'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.login_world_servers TO 'eqemu_web'@'%';
GRANT SELECT ON eqemu_login.login_server_list_types TO 'eqemu_web'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.login_server_admins TO 'eqemu_web'@'%';
GRANT SELECT ON eqemu_login.login_api_tokens TO 'eqemu_web'@'%';

-- Full access on platform tables
GRANT ALL ON eqemu_login.platform_accounts TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.account_login_links TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.platform_sessions TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.platform_admins TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.server_profiles TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.server_claims TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.platform_config TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.world_server_admin_links TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.platform_oauth_links TO 'eqemu_web'@'%';

-- Full access on federation tables (created by migrations)
GRANT ALL ON eqemu_login.federation_nodes TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.federation_config TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.federation_changelog TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.federation_audit_log TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.federation_origin_map TO 'eqemu_web'@'%';
GRANT ALL ON eqemu_login.federation_server_status TO 'eqemu_web'@'%';

-- Seed API token for loginserver <-> web communication
INSERT INTO login_api_tokens (token, can_write, can_read, created_at)
  VALUES ('${LOGINSERVER_API_TOKEN}', 1, 1, NOW())
  ON DUPLICATE KEY UPDATE token=token;

FLUSH PRIVILEGES;

EOSQL

echo "✓ Created eqemu_web user and seeded API token"
