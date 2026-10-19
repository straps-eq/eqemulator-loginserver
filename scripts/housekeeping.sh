#!/bin/bash
# ──────────────────────────────────────────────
# EQEmulator Housekeeping — run daily via cron
# Handles: Docker image pruning, DB optimization,
#          backup rotation, disk usage checks
# ──────────────────────────────────────────────
set -euo pipefail

EQEMU_DIR="${EQEMU_DIR:-/opt/eqemu}"
LOG="${HOUSEKEEPING_LOG:-$EQEMU_DIR/logs/housekeeping.log}"
mkdir -p "$(dirname "$LOG")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "=== Housekeeping started ==="

# 1. Prune Docker images — but never what a rollback needs.
#    - dangling (untagged, unreferenced) layers: always pruned
#    - eqemu images: keep <repo>:previous, any image used by a container
#      (running or stopped), and the KEEP_VERSIONS most recent images per repo;
#      older eqemu tags are removed explicitly.
#    Other repos' tagged images are left alone (no `prune -a`).
EQEMU_REPOS=(
  ghcr.io/straps-eq/eqemu-web
  ghcr.io/straps-eq/eqemu-loginserver
  ghcr.io/straps-eq/eqemu-upgrade-agent
)
KEEP_VERSIONS=2

log "Pruning dangling Docker images..."
PRUNED=$(docker image prune -f 2>&1 || true)
PRUNED="${PRUNED##*$'\n'}"   # last line (no `| tail`, safe under pipefail)
log "Docker prune (dangling): $PRUNED"

# Full image IDs referenced by any container.
IN_USE=" "
while IFS= read -r cid; do
  [ -n "$cid" ] || continue
  IN_USE+="$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true) "
done < <(docker ps -aq 2>/dev/null || true)

for repo in "${EQEMU_REPOS[@]}"; do
  PREV_ID=$(docker image inspect --format '{{.Id}}' "$repo:previous" 2>/dev/null || true)
  # Newest first. `sort` reads all input, so no SIGPIPE under pipefail.
  ROWS=$(docker images --no-trunc --format '{{.CreatedAt}}|{{.ID}}|{{.Tag}}' "$repo" 2>/dev/null | sort -r || true)
  KEEP=" "
  n=0
  while IFS='|' read -r _created id _tag; do
    [ -n "$id" ] || continue
    case "$KEEP" in *" $id "*) continue ;; esac
    if [ "$n" -lt "$KEEP_VERSIONS" ]; then
      KEEP+="$id "
      n=$((n + 1))
    fi
  done <<< "$ROWS"

  removed=0
  while IFS='|' read -r _created id tag; do
    [ -n "$id" ] || continue
    [ "$tag" = "previous" ] && continue
    [ -n "$PREV_ID" ] && [ "$id" = "$PREV_ID" ] && continue
    case "$KEEP" in *" $id "*) continue ;; esac
    case "$IN_USE" in *" $id "*) continue ;; esac
    if [ "$tag" = "<none>" ]; then ref="$id"; else ref="$repo:$tag"; fi
    if docker rmi "$ref" >/dev/null 2>&1; then
      removed=$((removed + 1))
      log "Removed old image $ref"
    else
      log "Could not remove $ref (still referenced?) — kept"
    fi
  done <<< "$ROWS"
  log "Image cleanup $repo: removed $removed, kept newest $KEEP_VERSIONS + :previous + in-use"
done

# 2. Optimize MariaDB tables (OPTIMIZE reclaims fragmented space)
log "Optimizing MariaDB tables..."
source "$EQEMU_DIR/.env"
# Password via the environment (docker exec -e MYSQL_PWD inherits it), not argv.
MYSQL_PWD="$DB_ROOT_PASSWORD" docker exec -e MYSQL_PWD eqemu-mariadb mysql -u root "${DB_NAME:-eqemu_login}" -e "
  OPTIMIZE TABLE login_accounts, login_world_servers, login_server_admins,
    server_profiles, platform_accounts, platform_admins, account_login_links,
    platform_oauth_links, world_server_admin_links,
    federation_changelog, federation_audit_log, federation_server_status;
" >> "$LOG" 2>&1 || log "DB optimize warning (non-fatal)"

# 3. Rotate old backups (keep last 7 days)
BACKUP_DIR="$EQEMU_DIR/backups"
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
DISK_PCT=$(df --output=pcent "$EQEMU_DIR" | tail -1 | tr -d ' %')
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
