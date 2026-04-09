#!/bin/bash
# ──────────────────────────────────────────────
# EQEmulator Housekeeping — run daily via cron
# Handles: Docker image pruning, DB optimization,
#          backup rotation, disk usage checks
# ──────────────────────────────────────────────
set -euo pipefail

LOG="/opt/eqemu/logs/housekeeping.log"
mkdir -p /opt/eqemu/logs

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "=== Housekeeping started ==="

# 1. Prune unused Docker images (keep latest tag for each repo)
log "Pruning unused Docker images..."
PRUNED=$(docker image prune -af --filter "until=72h" 2>&1 | tail -1)
log "Docker prune: $PRUNED"

# 2. Optimize MariaDB tables (OPTIMIZE reclaims fragmented space)
log "Optimizing MariaDB tables..."
source /opt/eqemu/.env
docker exec eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" "$DB_NAME" -e "
  OPTIMIZE TABLE login_accounts, login_world_servers, login_server_admins,
    server_profiles, platform_accounts, platform_admins, account_login_links,
    platform_oauth_links, world_server_admin_links,
    federation_changelog, federation_audit_log, federation_server_status;
" >> "$LOG" 2>&1 || log "DB optimize warning (non-fatal)"

# 3. Rotate old backups (keep last 7 days)
BACKUP_DIR="/opt/eqemu/backups"
if [ -d "$BACKUP_DIR" ]; then
  OLD_BACKUPS=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -type f 2>/dev/null | wc -l)
  find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -type f -delete 2>/dev/null || true
  log "Removed $OLD_BACKUPS old backups (>7 days)"
fi

# 4. Rotate this housekeeping log (keep last 1MB)
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || stat -c%s "$LOG" 2>/dev/null)" -gt 1048576 ]; then
  tail -c 512000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  log "Rotated housekeeping log"
fi

# 5. Check disk usage — warn if >80%
DISK_PCT=$(df --output=pcent /opt/eqemu | tail -1 | tr -d ' %')
if [ "$DISK_PCT" -gt 80 ]; then
  log "WARNING: Disk usage at ${DISK_PCT}%!"
fi

# 6. Check container health
for svc in eqemu-web eqemu-mariadb eqemu-loginserver eqemu-nginx eqemu-upgrade-agent; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$svc" 2>/dev/null || echo "missing")
  if [ "$STATUS" != "running" ]; then
    log "WARNING: $svc is $STATUS"
  fi
done

log "=== Housekeeping complete ==="
