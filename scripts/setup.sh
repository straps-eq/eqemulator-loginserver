#!/bin/bash
set -e

# ──────────────────────────────────────────────
# EQEmulator.dev — One-command node setup
# Usage: ./scripts/setup.sh <domain> [email]
# Example: ./scripts/setup.sh login.myserver.com admin@myserver.com
#
# This script:
#   1. Generates all secrets and config files
#   2. Obtains an SSL certificate via Let's Encrypt
#   3. Starts all Docker services
#   4. Runs database migrations
#   5. Prints next steps (register + promote admin)
# ──────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo ""
echo "════════════════════════════════════════════"
echo "  EQEmulator.dev — Node Setup"
echo "════════════════════════════════════════════"
echo ""

# ── Get domain ──
DOMAIN="${1:-}"
EMAIL="${2:-}"

if [ -z "$DOMAIN" ]; then
  read -rp "  Enter your domain (e.g. login.myserver.com): " DOMAIN
fi

if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "eqemu.example.com" ]; then
  echo ""
  echo "  ERROR: A valid domain is required."
  echo "  Usage: $0 <domain> [email]"
  exit 1
fi

if [ -z "$EMAIL" ]; then
  read -rp "  Enter your email (for Let's Encrypt SSL): " EMAIL
fi

if [ -z "$EMAIL" ]; then
  echo "  ERROR: An email is required for Let's Encrypt."
  exit 1
fi

echo ""
echo "  Domain: $DOMAIN"
echo "  Email:  $EMAIL"
echo ""

# ── Check dependencies ──
echo "── Checking dependencies ──"
for cmd in docker openssl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "  ERROR: '$cmd' is required but not installed."
    echo ""
    echo "  Install Docker:"
    echo "    curl -fsSL https://get.docker.com | sh"
    echo "    sudo usermod -aG docker \$USER"
    echo "    # Log out and back in, then re-run this script"
    exit 1
  fi
done

if ! docker compose version &>/dev/null; then
  echo "  ERROR: 'docker compose v2' is required."
  echo "  Install: https://docs.docker.com/compose/install/"
  exit 1
fi
echo "  ✓ docker, openssl, docker compose"

# ── Check ports ──
echo ""
echo "── Checking ports ──"
PORTS_NEEDED="80 443 5998 5999 15900"
PORTS_BUSY=""
for port in $PORTS_NEEDED; do
  if ss -tlnp 2>/dev/null | grep -q ":${port} " || \
     ss -ulnp 2>/dev/null | grep -q ":${port} "; then
    PORTS_BUSY="$PORTS_BUSY $port"
  fi
done
if [ -n "$PORTS_BUSY" ]; then
  echo "  WARNING: These ports are already in use:$PORTS_BUSY"
  echo "  The setup will continue, but services may fail to bind."
  echo "  Stop conflicting services or adjust your firewall."
  echo ""
else
  echo "  ✓ Ports 80, 443, 5998, 5999, 15900 available"
fi

# ── Generate secrets ──
echo ""
echo "── Generating secrets ──"
gen_secret() { openssl rand -hex "$1"; }

DB_ROOT_PASSWORD=$(gen_secret 32)
DB_PASSWORD=$(gen_secret 32)
DB_WEB_PASSWORD=$(gen_secret 32)
SESSION_SECRET=$(gen_secret 64)
LOGINSERVER_API_TOKEN=$(gen_secret 32)
FEDERATION_SYNC_SECRET=$(gen_secret 32)
FEDERATION_KEY_ENCRYPTION_SECRET=$(gen_secret 32)
METRICS_BEARER_TOKEN=$(gen_secret 32)

# ── Create .env ──
if [ -f .env ]; then
  echo "  WARNING: .env already exists — backing up to .env.backup"
  cp .env .env.backup
fi

cat > .env <<EOF
# ──────────────────────────────────────────────
# EQEmulator.dev — Generated $(date -u +"%Y-%m-%d %H:%M UTC")
# ──────────────────────────────────────────────

DOMAIN=${DOMAIN}

# ── MariaDB ──
DB_ROOT_PASSWORD=${DB_ROOT_PASSWORD}
DB_NAME=eqemu_login
DB_USER=eqemu_ls
DB_PASSWORD=${DB_PASSWORD}
DB_WEB_USER=eqemu_web
DB_WEB_PASSWORD=${DB_WEB_PASSWORD}

# ── Loginserver ──
LOGINSERVER_API_TOKEN=${LOGINSERVER_API_TOKEN}

# ── Web Application ──
SESSION_SECRET=${SESSION_SECRET}

# ── Cloudflare Turnstile (optional — registration captcha) ──
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=

# ── Resend (optional — email verification + MFA) ──
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@${DOMAIN}

# ── Federation ──
FEDERATION_SYNC_SECRET=${FEDERATION_SYNC_SECRET}
FEDERATION_KEY_ENCRYPTION_SECRET=${FEDERATION_KEY_ENCRYPTION_SECRET}

# ── Monitoring ──
METRICS_BEARER_TOKEN=${METRICS_BEARER_TOKEN}
EOF

echo "  ✓ Generated .env"

# ── Create login.json ──
if [ ! -f loginserver/login.json ]; then
  sed "s/CHANGE_ME_DB_PASSWORD/${DB_PASSWORD}/" \
    loginserver/login.json.example > loginserver/login.json
  echo "  ✓ Generated loginserver/login.json"
else
  echo "  · loginserver/login.json already exists (skipped)"
fi

# ── Create nginx config with domain ──
mkdir -p nginx/conf.d
sed "s/YOURDOMAIN.COM/${DOMAIN}/g" \
  nginx/conf.d/default.conf.example > nginx/conf.d/default.conf
echo "  ✓ Generated nginx/conf.d/default.conf"

# ── Create data directories ──
mkdir -p mariadb/data backups certbot/conf certbot/www
echo "  ✓ Created data directories"

# ── Get SSL certificate ──
echo ""
echo "── Obtaining SSL certificate ──"
echo "  Port 80 must be open and your DNS must point to this server."
echo ""
if [ -d "certbot/conf/live/${DOMAIN}" ]; then
  echo "  · SSL cert already exists for ${DOMAIN} (skipped)"
else
  # Stop anything on port 80 first
  docker stop eqemu-nginx 2>/dev/null || true

  if docker run --rm -p 80:80 \
    -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
    certbot/certbot certonly --standalone \
    --non-interactive --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN"; then
    echo "  ✓ SSL certificate obtained"
  else
    echo ""
    echo "  ERROR: SSL certificate failed. Common causes:"
    echo "    - DNS for ${DOMAIN} doesn't point to this server's IP"
    echo "    - Port 80 is blocked by firewall or another process"
    echo "    - Let's Encrypt rate limit (try again in an hour)"
    echo ""
    echo "  You can re-run this script after fixing the issue."
    echo "  The .env and config files have been saved."
    exit 1
  fi
fi

# ── Generate DH params ──
if [ ! -f certbot/conf/ssl-dhparams.pem ]; then
  echo ""
  echo "── Generating DH parameters (takes ~30 seconds) ──"
  openssl dhparam -out certbot/conf/ssl-dhparams.pem 2048 2>/dev/null
  echo "  ✓ DH parameters generated"
else
  echo "  · DH parameters already exist (skipped)"
fi

# ── Pull images ──
echo ""
echo "── Pulling Docker images ──"
docker compose -f docker-compose.release.yml pull
echo "  ✓ Images pulled"

# ── Start services ──
echo ""
echo "── Starting services ──"
docker compose -f docker-compose.release.yml up -d
echo "  ✓ All services started"

# ── Wait for MariaDB ──
echo ""
echo "── Waiting for MariaDB ──"
READY=0
for i in $(seq 1 60); do
  if docker exec eqemu-mariadb healthcheck.sh --connect --innodb_initialized 2>/dev/null; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" -eq 0 ]; then
  echo "  ERROR: MariaDB did not become ready in 120 seconds."
  echo "  Check: docker logs eqemu-mariadb"
  exit 1
fi
echo "  ✓ MariaDB is ready"

# ── Run migrations ──
echo ""
echo "── Running database migrations ──"
for f in web/migrations/*.sql; do
  # Suppress harmless errors (duplicate column, table exists)
  docker exec -i eqemu-mariadb mysql -u root -p"${DB_ROOT_PASSWORD}" eqemu_login < "$f" 2>&1 | \
    grep -v "Duplicate column\|Duplicate key\|already exists" || true
  echo "  ✓ $(basename "$f")"
done
echo "  ✓ Migrations complete"

# ── Verify services ──
echo ""
echo "── Verifying services ──"
sleep 3
SERVICES="eqemu-mariadb eqemu-loginserver eqemu-web eqemu-nginx eqemu-redis"
ALL_OK=1
for svc in $SERVICES; do
  STATUS=$(docker inspect -f '{{.State.Status}}' "$svc" 2>/dev/null || echo "missing")
  if [ "$STATUS" = "running" ]; then
    echo "  ✓ $svc"
  else
    echo "  ✗ $svc ($STATUS)"
    ALL_OK=0
  fi
done

if [ "$ALL_OK" -eq 0 ]; then
  echo ""
  echo "  WARNING: Some services are not running."
  echo "  Check logs: docker logs <container-name>"
fi

echo ""
echo "════════════════════════════════════════════"
echo "  ✓ Setup complete!"
echo "════════════════════════════════════════════"
echo ""
echo "  Your node is live at: https://${DOMAIN}"
echo ""
echo "  ── Next steps ──"
echo ""
echo "  1. Register an account at https://${DOMAIN}"
echo ""
echo "  2. Promote yourself to admin:"
echo ""
echo "     source .env"
echo "     docker exec eqemu-mariadb mysql -u root -p\"\$DB_ROOT_PASSWORD\" eqemu_login \\"
echo "       -e \"INSERT INTO platform_admins (login_account_id, role)"
echo "           SELECT id, 'admin' FROM platform_accounts"
echo "           WHERE username = 'YOUR_USERNAME';\""
echo ""
echo "  3. Join the federation:"
echo "     Go to Admin → Federation → Join Existing Federation"
echo "     Master URL: https://eqemulator.dev"
echo "     Get a bootstrap token from Discord: https://discord.gg/6T4n3DdPVB"
echo ""
echo "  4. Configure EQ clients — players update eqhost.txt:"
echo "     [LoginServer]"
echo "     Host=${DOMAIN}:5999"
echo ""
echo "  Full docs: README.md"
echo ""
