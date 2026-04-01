#!/bin/sh
# ──────────────────────────────────────────────
# EQEmulator Upgrade Agent — lightweight HTTP API for Docker operations
# Runs inside a docker:cli container with Docker socket access.
# Authenticated with AGENT_TOKEN bearer token.
# ──────────────────────────────────────────────
set -e

PORT="${AGENT_PORT:-9090}"
TOKEN="${AGENT_TOKEN:-}"
COMPOSE_DIR="${COMPOSE_DIR:-/host}"
COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.release.yml"
BACKUP_DIR="${COMPOSE_DIR}/backups"
MIGRATIONS_DIR="/migrations"

if [ -z "$TOKEN" ]; then
  echo "[upgrade-agent] ERROR: AGENT_TOKEN not set"
  exit 1
fi

# Load .env for DB credentials
if [ -f "${COMPOSE_DIR}/.env" ]; then
  set -a; . "${COMPOSE_DIR}/.env"; set +a
fi

log() { echo "[upgrade-agent] $*"; }

# ── Request handler (called by socat for each connection) ──
handle_request() {
  # Read request line
  read -r METHOD PATH _PROTO

  # Normalize
  METHOD=$(echo "$METHOD" | tr -d '\r')
  PATH=$(echo "$PATH" | tr -d '\r')

  # Read headers
  AUTH=""
  CONTENT_LENGTH=0
  while IFS= read -r header; do
    header=$(echo "$header" | tr -d '\r')
    [ -z "$header" ] && break
    case "$header" in
      Authorization:*|authorization:*)
        AUTH=$(echo "$header" | sed 's/^[Aa]uthorization: Bearer //')
        ;;
      Content-Length:*|content-length:*)
        CONTENT_LENGTH=$(echo "$header" | sed 's/^[Cc]ontent-[Ll]ength: //')
        ;;
    esac
  done

  # Auth check
  if [ "$AUTH" != "$TOKEN" ]; then
    send_response 401 '{"error":"unauthorized"}'
    return
  fi

  # Route
  case "$METHOD $PATH" in
    "GET /status")    do_status ;;
    "GET /version")   do_version ;;
    "POST /pull")     do_pull ;;
    "POST /migrate")  do_migrate ;;
    "POST /upgrade")  do_upgrade ;;
    "POST /restart/"*)
      SVC=$(echo "$PATH" | sed 's|^/restart/||')
      do_restart "$SVC"
      ;;
    "POST /backup")   do_backup ;;
    *)
      send_response 404 '{"error":"not found"}'
      ;;
  esac
}

send_response() {
  CODE="$1"
  BODY="$2"
  BODY_LEN=$(echo -n "$BODY" | wc -c)
  printf "HTTP/1.1 %s OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s" "$CODE" "$BODY_LEN" "$BODY"
}

# ── Actions ──

do_status() {
  log "GET /status"
  WEB=$(docker inspect --format='{{.State.Status}}' eqemu-web 2>/dev/null || echo "not found")
  LS=$(docker inspect --format='{{.State.Status}}' eqemu-loginserver 2>/dev/null || echo "not found")
  DB=$(docker inspect --format='{{.State.Status}}' eqemu-mariadb 2>/dev/null || echo "not found")
  REDIS=$(docker inspect --format='{{.State.Status}}' eqemu-redis 2>/dev/null || echo "not found")
  NGINX=$(docker inspect --format='{{.State.Status}}' eqemu-nginx 2>/dev/null || echo "not found")

  # Get uptime
  WEB_START=$(docker inspect --format='{{.State.StartedAt}}' eqemu-web 2>/dev/null || echo "")
  LS_START=$(docker inspect --format='{{.State.StartedAt}}' eqemu-loginserver 2>/dev/null || echo "")

  # Get image info
  WEB_IMG=$(docker inspect --format='{{.Config.Image}}' eqemu-web 2>/dev/null || echo "unknown")
  LS_IMG=$(docker inspect --format='{{.Config.Image}}' eqemu-loginserver 2>/dev/null || echo "unknown")

  send_response 200 "{\"services\":{\"web\":{\"status\":\"$WEB\",\"image\":\"$WEB_IMG\",\"started_at\":\"$WEB_START\"},\"loginserver\":{\"status\":\"$LS\",\"image\":\"$LS_IMG\",\"started_at\":\"$LS_START\"},\"mariadb\":{\"status\":\"$DB\"},\"redis\":{\"status\":\"$REDIS\"},\"nginx\":{\"status\":\"$NGINX\"}}}"
}

do_version() {
  log "GET /version"
  # Get image digests
  WEB_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$(docker inspect --format='{{.Image}}' eqemu-web 2>/dev/null)" 2>/dev/null || echo "unknown")
  LS_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$(docker inspect --format='{{.Image}}' eqemu-loginserver 2>/dev/null)" 2>/dev/null || echo "unknown")
  send_response 200 "{\"web_digest\":\"$WEB_DIGEST\",\"loginserver_digest\":\"$LS_DIGEST\"}"
}

do_backup() {
  log "POST /backup"
  mkdir -p "$BACKUP_DIR"
  STAMP=$(date +%Y%m%d-%H%M%S)
  BACKUP_FILE="$BACKUP_DIR/pre-upgrade-${STAMP}.sql"
  if docker exec eqemu-mariadb mysqldump -u root -p"${DB_ROOT_PASSWORD}" eqemu_login > "$BACKUP_FILE" 2>/dev/null; then
    SIZE=$(wc -c < "$BACKUP_FILE")
    log "Backup saved: $BACKUP_FILE ($SIZE bytes)"
    # Prune old backups (keep last 5)
    ls -1t "$BACKUP_DIR"/pre-upgrade-*.sql 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
    send_response 200 "{\"ok\":true,\"file\":\"pre-upgrade-${STAMP}.sql\",\"size\":$SIZE}"
  else
    rm -f "$BACKUP_FILE"
    send_response 500 '{"error":"backup failed"}'
  fi
}

do_pull() {
  log "POST /pull"
  cd "$COMPOSE_DIR"
  OUTPUT=$(docker compose -f docker-compose.release.yml pull web loginserver 2>&1) || true
  log "Pull complete"
  # Escape JSON
  OUTPUT_ESC=$(echo "$OUTPUT" | head -20 | tr '\n' ' ' | sed 's/"/\\"/g')
  send_response 200 "{\"ok\":true,\"output\":\"$OUTPUT_ESC\"}"
}

do_migrate() {
  log "POST /migrate"
  APPLIED=0
  ERRORS=""

  # Copy migrations from the new web image
  TEMP_CONTAINER=$(docker create eqemu-web 2>/dev/null || docker create ghcr.io/straps-eq/eqemu-web:latest 2>/dev/null)
  if [ -n "$TEMP_CONTAINER" ]; then
    docker cp "$TEMP_CONTAINER:/app/migrations/." "$MIGRATIONS_DIR/" 2>/dev/null || true
    docker rm "$TEMP_CONTAINER" >/dev/null 2>&1 || true
  fi

  if [ -d "$MIGRATIONS_DIR" ] && ls "$MIGRATIONS_DIR"/*.sql >/dev/null 2>&1; then
    for f in "$MIGRATIONS_DIR"/*.sql; do
      FNAME=$(basename "$f")
      RESULT=$(docker exec -i eqemu-mariadb mysql -u root -p"${DB_ROOT_PASSWORD}" eqemu_login < "$f" 2>&1) || true
      # Filter harmless errors
      REAL_ERRORS=$(echo "$RESULT" | grep -vi "Duplicate column\|Duplicate key\|already exists\|Warning" || true)
      if [ -n "$REAL_ERRORS" ]; then
        ERRORS="${ERRORS}${FNAME}: ${REAL_ERRORS}; "
      fi
      APPLIED=$((APPLIED + 1))
      log "  ✓ $FNAME"
    done
  fi

  if [ -n "$ERRORS" ]; then
    ERRORS_ESC=$(echo "$ERRORS" | sed 's/"/\\"/g')
    send_response 200 "{\"ok\":true,\"applied\":$APPLIED,\"errors\":\"$ERRORS_ESC\"}"
  else
    send_response 200 "{\"ok\":true,\"applied\":$APPLIED}"
  fi
}

do_restart() {
  SVC="$1"
  log "POST /restart/$SVC"
  case "$SVC" in
    web|loginserver|mariadb|redis|nginx)
      cd "$COMPOSE_DIR"
      docker compose -f docker-compose.release.yml up -d --force-recreate "$SVC" 2>&1 || true
      send_response 200 "{\"ok\":true,\"service\":\"$SVC\"}"
      ;;
    *)
      send_response 400 "{\"error\":\"invalid service: $SVC\"}"
      ;;
  esac
}

do_upgrade() {
  log "POST /upgrade — starting full upgrade"

  # Step 1: Backup
  log "Step 1/4: Backing up database"
  mkdir -p "$BACKUP_DIR"
  STAMP=$(date +%Y%m%d-%H%M%S)
  BACKUP_FILE="$BACKUP_DIR/pre-upgrade-${STAMP}.sql"
  if ! docker exec eqemu-mariadb mysqldump -u root -p"${DB_ROOT_PASSWORD}" eqemu_login > "$BACKUP_FILE" 2>/dev/null; then
    rm -f "$BACKUP_FILE"
    send_response 500 '{"error":"backup failed, upgrade aborted"}'
    return
  fi
  BACKUP_SIZE=$(wc -c < "$BACKUP_FILE")
  log "  ✓ Backup saved ($BACKUP_SIZE bytes)"

  # Step 2: Pull new images
  log "Step 2/4: Pulling new images"
  cd "$COMPOSE_DIR"
  docker compose -f docker-compose.release.yml pull web loginserver 2>&1 || true
  log "  ✓ Images pulled"

  # Step 3: Run migrations from new image
  log "Step 3/4: Running migrations"
  TEMP_CONTAINER=$(docker create ghcr.io/straps-eq/eqemu-web:latest 2>/dev/null || echo "")
  if [ -n "$TEMP_CONTAINER" ]; then
    docker cp "$TEMP_CONTAINER:/app/migrations/." "$MIGRATIONS_DIR/" 2>/dev/null || true
    docker rm "$TEMP_CONTAINER" >/dev/null 2>&1 || true
  fi
  MIG_COUNT=0
  if [ -d "$MIGRATIONS_DIR" ] && ls "$MIGRATIONS_DIR"/*.sql >/dev/null 2>&1; then
    for f in "$MIGRATIONS_DIR"/*.sql; do
      docker exec -i eqemu-mariadb mysql -u root -p"${DB_ROOT_PASSWORD}" eqemu_login < "$f" 2>&1 | \
        grep -vi "Duplicate column\|Duplicate key\|already exists\|Warning" || true
      MIG_COUNT=$((MIG_COUNT + 1))
    done
  fi
  log "  ✓ $MIG_COUNT migrations applied"

  # Step 4: Restart services with new images
  log "Step 4/4: Restarting services"
  docker compose -f docker-compose.release.yml up -d --force-recreate web loginserver 2>&1 || true
  log "  ✓ Services restarted"

  # Prune old backups (keep last 5)
  ls -1t "$BACKUP_DIR"/pre-upgrade-*.sql 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true

  log "Upgrade complete"
  send_response 200 "{\"ok\":true,\"backup\":\"pre-upgrade-${STAMP}.sql\",\"backup_size\":$BACKUP_SIZE,\"migrations\":$MIG_COUNT}"
}

# ── Handle mode: called by socat for each connection ──
if [ "${1:-}" = "--handle" ]; then
  handle_request
  exit 0
fi

# ── Main: start HTTP server ──
log "Starting on port $PORT (token: ${TOKEN:0:8}...)"
mkdir -p "$MIGRATIONS_DIR"

# Verify dependencies
if ! command -v socat >/dev/null 2>&1; then
  log "ERROR: socat not found (should be pre-installed in image)"
  exit 1
fi

log "Listening on port $PORT"
exec socat TCP-LISTEN:${PORT},reuseaddr,fork EXEC:"/agent/upgrade-agent.sh --handle"
