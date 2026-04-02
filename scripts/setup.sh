#!/bin/bash
set -e

# ──────────────────────────────────────────────
# EQEmulator.dev — Idempotent node setup
# Usage: ./scripts/setup.sh [domain] [email]
#        ./scripts/setup.sh --reset    # regenerate all credentials
#
# Safe to re-run: credentials are generated once and preserved.
# All derived configs (login.json, nginx) are always rebuilt from .env.
# ──────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo ""
echo "════════════════════════════════════════════"
echo "  EQEmulator.dev — Node Setup"
echo "════════════════════════════════════════════"
echo ""

# ── Handle --reset flag ──
if [ "${1:-}" = "--reset" ]; then
  if [ -f .env ]; then
    BACKUP=".env.backup.$(date +%s)"
    cp .env "$BACKUP"
    rm .env
    echo "  ⚠ Credentials will be regenerated (backup: $BACKUP)"
    echo ""
  fi
  shift
fi

# ── Helper ──
gen_secret() { openssl rand -hex "$1"; }

# ══════════════════════════════════════════════
# PHASE 1: CONFIGURE — generate or load .env, derive all configs
# ══════════════════════════════════════════════

if [ -f .env ]; then
  # ── Existing installation: load credentials ──
  echo "── Loading existing .env (credentials preserved) ──"
  set -a; source .env; set +a

  # Allow overriding domain/email from CLI args
  DOMAIN="${1:-$DOMAIN}"
  EMAIL="${2:-${EMAIL:-}}"

  if [ -z "$DOMAIN" ]; then
    echo "  ERROR: DOMAIN not set in .env and not provided as argument."
    exit 1
  fi
  echo "  ✓ Loaded .env (domain: $DOMAIN)"
else
  # ── First run: prompt and generate everything ──
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
    echo ""
  else
    echo "  ✓ Ports 80, 443, 5998, 5999, 15900 available"
  fi

  # ── Generate secrets (only on first run) ──
  echo ""
  echo "── Generating secrets ──"
  DB_ROOT_PASSWORD=$(gen_secret 32)
  DB_PASSWORD=$(gen_secret 32)
  DB_WEB_PASSWORD=$(gen_secret 32)
  SESSION_SECRET=$(gen_secret 64)
  LOGINSERVER_API_TOKEN=$(gen_secret 32)
  FEDERATION_SYNC_SECRET=$(gen_secret 32)
  FEDERATION_KEY_ENCRYPTION_SECRET=$(gen_secret 32)
  METRICS_BEARER_TOKEN=$(gen_secret 32)
  UPGRADE_AGENT_TOKEN=$(gen_secret 32)
  echo "  ✓ All secrets generated"

  # ── Optional: Resend email API ──
  echo ""
  echo "── Email Configuration (optional) ──"
  echo "  Resend (https://resend.com) enables email verification and MFA codes."
  echo "  Press Enter to skip if you don't have one yet."
  echo ""
  read -rp "  Resend API Key (or Enter to skip): " RESEND_API_KEY
  RESEND_API_KEY="${RESEND_API_KEY:-}"

  if [ -n "$RESEND_API_KEY" ]; then
    echo "  ✓ Resend API key configured"
    read -rp "  From email (e.g. noreply@yourdomain.com) [noreply@eqemulator.dev]: " RESEND_FROM_EMAIL
    RESEND_FROM_EMAIL="${RESEND_FROM_EMAIL:-noreply@eqemulator.dev}"
    echo "  ✓ From email: ${RESEND_FROM_EMAIL}"
  else
    RESEND_FROM_EMAIL="noreply@${DOMAIN}"
    echo "  · Skipped — emails disabled (can be added to .env later)"
  fi

  # ── Write .env ──
  cat > .env <<EOF
# ──────────────────────────────────────────────
# EQEmulator.dev — Generated $(date -u +"%Y-%m-%d %H:%M UTC")
# DO NOT DELETE — credentials are not regenerated on re-run
# ──────────────────────────────────────────────

DOMAIN=${DOMAIN}
EMAIL=${EMAIL}

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
# Get keys from https://dash.cloudflare.com → Turnstile → Add Site
# NEXT_PUBLIC_ vars are inlined at build time — rebuild web after changing
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=

# ── Resend (optional — email verification + MFA) ──
RESEND_API_KEY=${RESEND_API_KEY}
RESEND_FROM_EMAIL=${RESEND_FROM_EMAIL}

# ── Federation ──
FEDERATION_SYNC_SECRET=${FEDERATION_SYNC_SECRET}
FEDERATION_KEY_ENCRYPTION_SECRET=${FEDERATION_KEY_ENCRYPTION_SECRET}

# ── Monitoring ──
METRICS_BEARER_TOKEN=${METRICS_BEARER_TOKEN}

# ── Upgrade Agent ──
UPGRADE_AGENT_TOKEN=${UPGRADE_AGENT_TOKEN}
EOF

  echo "  ✓ Generated .env"
fi

echo ""
echo "  Domain: $DOMAIN"
echo ""

# ── Always rebuild derived configs from .env ──
echo "── Building configs from .env ──"

# login.json — always rebuild (single source of truth: .env)
mkdir -p loginserver
# Remove if it was accidentally created as a directory
if [ -d "loginserver/login.json" ]; then
  rm -rf loginserver/login.json
fi
sed "s/CHANGE_ME_DB_PASSWORD/${DB_PASSWORD}/" \
  loginserver/login.json.example > loginserver/login.json
echo "  ✓ loginserver/login.json"

# nginx config — always rebuild
mkdir -p nginx/conf.d
sed "s/YOURDOMAIN.COM/${DOMAIN}/g" \
  nginx/conf.d/default.conf.example > nginx/conf.d/default.conf
echo "  ✓ nginx/conf.d/default.conf"

# Data directories
mkdir -p mariadb/data backups certbot/conf certbot/www
echo "  ✓ Data directories"

# ══════════════════════════════════════════════
# PHASE 2: DEPLOY — SSL, pull, start, migrate, validate
# ══════════════════════════════════════════════

# ── Get SSL certificate ──
echo ""
echo "── SSL certificate ──"
if [ -d "certbot/conf/live/${DOMAIN}" ]; then
  echo "  · SSL cert already exists for ${DOMAIN} (skipped)"
else
  echo "  Port 80 must be open and DNS must point to this server."
  echo ""
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
    echo "  Re-run this script after fixing the issue."
    echo "  Your .env and configs are saved — credentials will be reused."
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
docker compose pull
echo "  ✓ Images pulled"

# ── Start services ──
echo ""
echo "── Starting services ──"
docker compose up -d
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

# ── Sync DB passwords (handles credential drift after re-runs) ──
echo ""
echo "── Syncing database credentials ──"
docker exec eqemu-mariadb mysql -u root -p"${DB_ROOT_PASSWORD}" -e "
  ALTER USER 'eqemu_ls'@'%' IDENTIFIED BY '${DB_PASSWORD}';
  ALTER USER 'eqemu_web'@'%' IDENTIFIED BY '${DB_WEB_PASSWORD}';
  FLUSH PRIVILEGES;
" 2>/dev/null && echo "  ✓ DB user passwords synced with .env" || echo "  · DB users not yet created (first init — will be created by MariaDB entrypoint)"

# ── Run migrations ──
echo ""
echo "── Running database migrations ──"
for f in web/migrations/*.sql; do
  docker exec -i eqemu-mariadb mysql -u root -p"${DB_ROOT_PASSWORD}" eqemu_login < "$f" 2>&1 | \
    grep -v "Duplicate column\|Duplicate key\|already exists" || true
  echo "  ✓ $(basename "$f")"
done
echo "  ✓ Migrations complete"

# ── Validate installation ──
echo ""
echo "── Validating installation ──"
sleep 5
if bash "$SCRIPT_DIR/validate.sh"; then
  echo ""
else
  echo ""
  echo "  Some checks failed. Review the output above."
  echo "  Re-run validation anytime: ./scripts/validate.sh"
  echo ""
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
