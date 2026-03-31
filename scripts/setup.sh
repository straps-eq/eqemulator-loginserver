#!/bin/bash
set -e

# ──────────────────────────────────────────────
# EQEmulator.dev — One-command setup
# Generates all secrets and config files.
# ──────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "════════════════════════════════════════════"
echo "  EQEmulator.dev — Setup"
echo "════════════════════════════════════════════"
echo ""

# ── Check dependencies ──
for cmd in docker openssl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd is required but not installed."
    exit 1
  fi
done

if ! docker compose version &>/dev/null; then
  echo "ERROR: docker compose v2 is required."
  exit 1
fi

# ── Generate secrets ──
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
  echo "WARNING: .env already exists. Backing up to .env.backup"
  cp .env .env.backup
fi

cat > .env <<EOF
# ──────────────────────────────────────────────
# EQEmulator.dev — Generated $(date -u +"%Y-%m-%d %H:%M UTC")
# ──────────────────────────────────────────────

# Domain — CHANGE THIS to your public hostname
DOMAIN=eqemu.example.com

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
RESEND_FROM_EMAIL=noreply@eqemu.example.com

# ── Federation ──
FEDERATION_SYNC_SECRET=${FEDERATION_SYNC_SECRET}
FEDERATION_KEY_ENCRYPTION_SECRET=${FEDERATION_KEY_ENCRYPTION_SECRET}

# ── Monitoring ──
METRICS_BEARER_TOKEN=${METRICS_BEARER_TOKEN}
EOF

echo "✓ Generated .env with unique secrets"

# ── Create login.json ──
if [ ! -f loginserver/login.json ]; then
  sed "s/CHANGE_ME_DB_PASSWORD/${DB_PASSWORD}/" \
    loginserver/login.json.example > loginserver/login.json
  echo "✓ Generated loginserver/login.json"
else
  echo "· loginserver/login.json already exists (skipped)"
fi

# ── Create nginx config ──
if [ ! -f nginx/conf.d/default.conf ]; then
  cp nginx/conf.d/default.conf.example nginx/conf.d/default.conf
  echo "✓ Copied nginx config (edit YOURDOMAIN.COM in nginx/conf.d/default.conf)"
else
  echo "· nginx/conf.d/default.conf already exists (skipped)"
fi

# ── Create data directories ──
mkdir -p mariadb/data backups certbot/conf certbot/www
echo "✓ Created data directories"

echo ""
echo "════════════════════════════════════════════"
echo "  Setup complete!"
echo "════════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Edit .env — set DOMAIN to your hostname"
echo "  2. Edit nginx/conf.d/default.conf — replace YOURDOMAIN.COM"
echo "  3. Start everything:"
echo ""
echo "     docker compose -f docker-compose.release.yml up -d"
echo ""
echo "  4. Run migrations:"
echo ""
echo "     for f in web/migrations/*.sql; do"
echo "       docker exec eqemu-mariadb mysql -u root -p\"\$DB_ROOT_PASSWORD\" eqemu_login < \"\$f\""
echo "     done"
echo ""
echo "  5. Set up SSL (after DNS is pointing to this server):"
echo ""
echo "     docker run --rm -v ./certbot/conf:/etc/letsencrypt \\"
echo "       -v ./certbot/www:/var/www/certbot \\"
echo "       certbot/certbot certonly --webroot \\"
echo "       -w /var/www/certbot -d YOUR_DOMAIN"
echo ""
echo "  See README.md for full documentation."
echo ""
