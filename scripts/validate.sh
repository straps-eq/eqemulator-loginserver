#!/bin/bash
# ──────────────────────────────────────────────
# EQEmulator.dev — Post-setup validation
# Checks DB schema, grants, services, and endpoints.
# Usage: ./scripts/validate.sh
# Exit code 0 = all checks passed, 1 = failures found
# ──────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Load env
if [ -f .env ]; then
  set -a; source .env; set +a
fi

DOMAIN="${DOMAIN:-localhost}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-}"
PASS=0
FAIL=0
WARN=0

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }
warn() { WARN=$((WARN + 1)); echo "  ⚠ $1"; }

db_exec() {
  docker exec -i eqemu-mariadb mysql -u root -p"${DB_ROOT_PASSWORD}" eqemu_login -N -s -e "$1" 2>/dev/null
}

echo ""
echo "════════════════════════════════════════════"
echo "  EQEmulator.dev — Validation"
echo "════════════════════════════════════════════"

# ── 1. Container status ──
echo ""
echo "── Containers ──"
for svc in eqemu-mariadb eqemu-loginserver eqemu-web eqemu-nginx; do
  STATUS=$(docker inspect -f '{{.State.Status}}' "$svc" 2>/dev/null || echo "missing")
  if [ "$STATUS" = "running" ]; then
    pass "$svc"
  else
    fail "$svc ($STATUS)"
  fi
done
# Redis may be named eqemu-redis (release) or redis (dev)
REDIS_STATUS=$(docker inspect -f '{{.State.Status}}' eqemu-redis 2>/dev/null || docker inspect -f '{{.State.Status}}' redis 2>/dev/null || echo "missing")
if [ "$REDIS_STATUS" = "running" ]; then
  pass "redis"
else
  warn "redis ($REDIS_STATUS) — rate limiting will use in-memory fallback"
fi

# ── 2. Required tables ──
echo ""
echo "── Database tables ──"
REQUIRED_TABLES=(
  "login_accounts"
  "login_world_servers"
  "login_server_admins"
  "login_server_list_types"
  "login_api_tokens"
  "platform_accounts"
  "platform_sessions"
  "platform_admins"
  "platform_config"
  "server_profiles"
  "server_claims"
  "account_login_links"
  "world_server_admin_links"
  "federation_nodes"
  "federation_config"
  "federation_changelog"
  "federation_audit_log"
)

EXISTING_TABLES=$(db_exec "SHOW TABLES" | tr '\n' ' ')
for tbl in "${REQUIRED_TABLES[@]}"; do
  if echo "$EXISTING_TABLES" | grep -qw "$tbl"; then
    pass "$tbl"
  else
    fail "$tbl (missing)"
  fi
done

# ── 3. Required columns (ones that caused issues before) ──
echo ""
echo "── Critical columns ──"

check_column() {
  local table=$1 column=$2
  RESULT=$(db_exec "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='eqemu_login' AND TABLE_NAME='$table' AND COLUMN_NAME='$column'")
  if [ "$RESULT" = "1" ]; then
    pass "$table.$column"
  else
    fail "$table.$column (missing — run: ALTER TABLE $table ADD COLUMN $column INT DEFAULT NULL)"
  fi
}

check_column "login_world_servers" "federation_source_node_id"
check_column "login_server_admins" "federation_source_node_id"
check_column "server_profiles" "display_tier"
check_column "server_profiles" "show_player_count"

# ── 4. Grants ──
echo ""
echo "── Database grants ──"

check_grant() {
  local table=$1 privilege=$2
  GRANTS=$(db_exec "SHOW GRANTS FOR 'eqemu_web'@'%'" 2>/dev/null || echo "")
  # Check for table-level or ALL PRIVILEGES
  if echo "$GRANTS" | grep -qi "ALL PRIVILEGES ON.*eqemu_login" 2>/dev/null; then
    pass "eqemu_web: $privilege on $table (via ALL)"
    return
  fi
  if echo "$GRANTS" | grep -qi "$privilege.*ON.*\`eqemu_login\`\.\`$table\`" 2>/dev/null; then
    pass "eqemu_web: $privilege on $table"
  elif echo "$GRANTS" | grep -qi "ALL.*ON.*\`eqemu_login\`\.\`$table\`" 2>/dev/null; then
    pass "eqemu_web: $privilege on $table (via ALL)"
  else
    fail "eqemu_web: $privilege on $table (run migration 006 or grant manually)"
  fi
}

check_grant "login_accounts" "INSERT"
check_grant "login_accounts" "DELETE"
check_grant "login_world_servers" "INSERT"
check_grant "login_world_servers" "DELETE"
check_grant "login_server_admins" "INSERT"
check_grant "login_server_admins" "DELETE"
check_grant "platform_accounts" "SELECT"
check_grant "federation_nodes" "SELECT"

# ── 5. API endpoints ──
echo ""
echo "── API endpoints ──"

# Wait for web container to be ready
WEB_READY=0
for i in $(seq 1 5); do
  HTTP_CODE=$(docker exec eqemu-nginx curl -s -o /dev/null -w "%{http_code}" http://web:3000/api/status 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" != "000" ]; then
    WEB_READY=1
    break
  fi
  sleep 2
done

if [ "$WEB_READY" -eq 0 ]; then
  fail "Web app not responding (check: docker logs eqemu-web)"
else
  # /api/status
  HTTP_CODE=$(docker exec eqemu-nginx curl -s -o /dev/null -w "%{http_code}" http://web:3000/api/status 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    pass "/api/status → $HTTP_CODE"
  else
    fail "/api/status → $HTTP_CODE"
  fi

  # /api/servers
  HTTP_CODE=$(docker exec eqemu-nginx curl -s -o /dev/null -w "%{http_code}" http://web:3000/api/servers 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    pass "/api/servers → $HTTP_CODE"
  else
    fail "/api/servers → $HTTP_CODE"
  fi

  # /verify-email (should return 200 HTML)
  HTTP_CODE=$(docker exec eqemu-nginx curl -s -o /dev/null -w "%{http_code}" "http://web:3000/verify-email?token=test" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    pass "/verify-email → $HTTP_CODE"
  else
    fail "/verify-email → $HTTP_CODE"
  fi

  # CSP check — ensure no nonce in script-src (breaks pre-rendered pages)
  CSP=$(docker exec eqemu-nginx curl -s -D- -o /dev/null "http://web:3000/" 2>/dev/null | grep -i "content-security-policy" || echo "")
  if echo "$CSP" | grep -q "nonce-"; then
    fail "CSP contains script nonce (will break client-side JS on pre-rendered pages)"
  elif echo "$CSP" | grep -q "unsafe-inline"; then
    pass "CSP script-src uses unsafe-inline (correct for Next.js)"
  else
    warn "Could not verify CSP headers"
  fi
fi

# ── 6. SSL ──
echo ""
echo "── SSL ──"
if [ -f "certbot/conf/live/${DOMAIN}/fullchain.pem" ]; then
  EXPIRY=$(openssl x509 -enddate -noout -in "certbot/conf/live/${DOMAIN}/fullchain.pem" 2>/dev/null | cut -d= -f2)
  if [ -n "$EXPIRY" ]; then
    pass "Certificate valid until $EXPIRY"
  else
    warn "Could not read certificate expiry"
  fi
else
  warn "No SSL certificate found for $DOMAIN"
fi

# ── Summary ──
echo ""
echo "════════════════════════════════════════════"
TOTAL=$((PASS + FAIL + WARN))
if [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
  echo "  ✓ All $TOTAL checks passed"
elif [ "$FAIL" -eq 0 ]; then
  echo "  ✓ $PASS passed, $WARN warnings"
else
  echo "  ✗ $PASS passed, $FAIL FAILED, $WARN warnings"
  echo ""
  echo "  Fix the failures above and re-run:"
  echo "    ./scripts/validate.sh"
fi
echo "════════════════════════════════════════════"
echo ""

exit $FAIL
