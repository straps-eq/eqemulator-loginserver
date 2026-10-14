#!/bin/bash
# =============================================================================
# EQEmu Login Server - encrypted database backup with off-site copy
#
# Dumps the login database without locking logins (--single-transaction),
# encrypts it with BACKUP_PASSPHRASE, keeps 2 days locally and uploads to the
# rclone remote in BACKUP_REMOTE (e.g. "dropbox:EQEmu Backups").
#
# Remote layout and retention:
#   hourly/  every run, kept 7 days
#   daily/   first run of each UTC day, kept 30 days
#
# Settings come from /opt/eqemu/.env:
#   DB_ROOT_PASSWORD   (required)
#   BACKUP_PASSPHRASE  (required; without it backups cannot be restored)
#   BACKUP_REMOTE      (optional; local-only backups when empty)
#
# Restore:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
#     -in FILE.sql.gz.enc | gunzip | docker exec -i -e MYSQL_PWD eqemu-mariadb \
#     mariadb -u root eqemu_login
#
# Cron (hourly):
#   7 * * * * /opt/eqemu/scripts/backup.sh >> /opt/eqemu/backups/backup.log 2>&1
# =============================================================================
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/eqemu}"
BACKUP_DIR="$COMPOSE_DIR/backups/db"
RCLONE_IMAGE="rclone/rclone:1.68.2"

set -a
# shellcheck disable=SC1091
. "$COMPOSE_DIR/.env"
set +a

DB_NAME="${DB_NAME:-eqemu_login}"
: "${DB_ROOT_PASSWORD:?DB_ROOT_PASSWORD missing from .env}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE missing from .env}"
export BACKUP_PASSPHRASE
export MYSQL_PWD="$DB_ROOT_PASSWORD"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] $*"; }

# One run at a time
mkdir -p "$COMPOSE_DIR/backups"
exec 9>"$COMPOSE_DIR/backups/.backup.lock"
flock -n 9 || { log "Another backup is running, skipping"; exit 0; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077

STAMP=$(date -u +%Y%m%d_%H%M)
FILE="${DB_NAME}_${STAMP}.sql.gz.enc"
TMP="$BACKUP_DIR/.$FILE.partial"
trap 'rm -f "$TMP"' EXIT

log "Dumping $DB_NAME"
docker exec -e MYSQL_PWD eqemu-mariadb \
  mariadb-dump -u root --single-transaction --quick --routines --triggers \
  --events --hex-blob "$DB_NAME" \
  | gzip -6 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
  > "$TMP"

# Sanity check: decrypts, decompresses and ends with mariadb-dump's trailer
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$TMP" \
     | gunzip | tail -n 1 | grep -q "Dump completed"; then
  log "ERROR: backup failed verification"
  exit 1
fi
mv "$TMP" "$BACKUP_DIR/$FILE"
log "Wrote $FILE ($(du -h "$BACKUP_DIR/$FILE" | cut -f1))"

# Local retention: 2 days
find "$BACKUP_DIR" -name "*.sql.gz.enc" -mmin +2880 -type f -delete

if [ -z "${BACKUP_REMOTE:-}" ]; then
  log "BACKUP_REMOTE not set, local backup only"
  exit 0
fi

rclone() {
  docker run --rm --network host \
    -v "$COMPOSE_DIR/rclone:/config/rclone" \
    -v "$BACKUP_DIR:/data:ro" \
    "$RCLONE_IMAGE" "$@"
}

rclone copyto "/data/$FILE" "$BACKUP_REMOTE/hourly/$FILE"
if ! rclone lsf "$BACKUP_REMOTE/daily/" --include "*_$(date -u +%Y%m%d)_*" | grep -q .; then
  rclone copyto "/data/$FILE" "$BACKUP_REMOTE/daily/$FILE"
  log "Uploaded daily copy"
fi
rclone delete "$BACKUP_REMOTE/hourly/" --min-age 7d
rclone delete "$BACKUP_REMOTE/daily/" --min-age 30d
log "Uploaded $FILE to $BACKUP_REMOTE"
