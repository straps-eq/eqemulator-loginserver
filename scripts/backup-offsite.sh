#!/bin/bash
# ──────────────────────────────────────────────
# Hourly off-site backup of the loginserver stack.
#
# Builds one self-contained, AES-256 encrypted 7-Zip archive (database dump,
# .env, login.json, nginx config, restore kit), tests it, uploads it to
# Dropbox with rclone and prunes old copies. Open an archive with 7-Zip and
# the backup passphrase; RESTORE.md inside explains the rest.
#
# One-time setup (as the user that runs this, normally straps):
#   1. Passphrase, also kept in the operators' password manager:
#        mkdir -p ~/.config/eqemu-backup
#        read -rsp "Passphrase: " p && printf %s "$p" > ~/.config/eqemu-backup/passphrase
#        chmod 600 ~/.config/eqemu-backup/passphrase
#   2. A Dropbox rclone remote named "dropbox" in ~/.config/rclone/rclone.conf
#   3. docker build -t eqemu-backup-tools:1 /opt/eqemu/scripts/backup
#   4. cron: 30 * * * * /opt/eqemu/scripts/backup-offsite.sh >> /opt/eqemu/logs/backup.log 2>&1
#
# Dropbox layout: hourly/ every run (kept 2 days), daily/ from the 03:30 UTC
# run (kept 14 days), weekly/ from Sunday's 03:30 UTC run (kept 8 weeks).
#
# Env overrides: BACKUP_REMOTE (default dropbox:apps/loginserver), UPLOAD=0 to
# build and test the archive without uploading, HEALTHCHECK_URL (or a URL in
# ~/.config/eqemu-backup/healthcheck_url) to ping healthchecks.io-style /start,
# success and /fail.
# ──────────────────────────────────────────────
set -euo pipefail
umask 077

EQEMU_DIR="${EQEMU_DIR:-/opt/eqemu}"
KIT_DIR="$(cd "$(dirname "$0")" && pwd)/backup"
PASSFILE="${BACKUP_PASSFILE:-$HOME/.config/eqemu-backup/passphrase}"
RCLONE_CONF_DIR="${RCLONE_CONF_DIR:-$HOME/.config/rclone}"
REMOTE="${BACKUP_REMOTE:-dropbox:apps/loginserver}"
LOCAL_DIR="${BACKUP_LOCAL_DIR:-$HOME/eqemu-backups}"
TOOLS_IMAGE="${BACKUP_TOOLS_IMAGE:-eqemu-backup-tools:1}"
UPLOAD="${UPLOAD:-1}"
KEEP_HOURLY_HOURS=48
KEEP_DAILY_DAYS=14
KEEP_WEEKLY_DAYS=56
KEEP_LOCAL=3

HEALTHCHECK_FILE="${HEALTHCHECK_FILE:-$HOME/.config/eqemu-backup/healthcheck_url}"
if [ -z "${HEALTHCHECK_URL:-}" ] && [ -s "$HEALTHCHECK_FILE" ]; then
  HEALTHCHECK_URL="$(tr -d '[:space:]' < "$HEALTHCHECK_FILE")"
fi

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] $*"; }
ping_hc() {
  [ -n "${HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL$1" >/dev/null 2>&1 || log "warning: healthcheck ping failed"
}
fail() { log "BACKUP FAILED: $*"; exit 1; }
# Any non-zero exit (fail() or a failed command under set -e) reports to the
# healthcheck, which then alerts; a missed night alerts via its schedule.
trap 'rc=$?; [ $rc -ne 0 ] && ping_hc /fail; exit $rc' EXIT

[ -s "$PASSFILE" ] || fail "passphrase file $PASSFILE missing or empty"
[ "$(stat -c %a "$PASSFILE")" = "600" ] || fail "$PASSFILE must be chmod 600"
docker image inspect "$TOOLS_IMAGE" >/dev/null 2>&1 || fail "tools image $TOOLS_IMAGE not built (docker build -t $TOOLS_IMAGE $EQEMU_DIR/scripts/backup)"

DATE="$(date -u +%Y-%m-%d)"
HOUR="$(date -u +%H)"
NAME="loginserver-backup-${DATE}_${HOUR}00"
WORK="$(mktemp -d)"
trap 'rc=$?; rm -rf "$WORK"; [ $rc -ne 0 ] && ping_hc /fail; exit $rc' EXIT
STAGE="$WORK/$NAME"
mkdir -p "$STAGE" "$WORK/out" "$LOCAL_DIR"

log "=== Backup $NAME started ==="
ping_hc /start

# 1. Database: one consistent InnoDB snapshot, root password read inside the container.
docker exec eqemu-mariadb sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb-dump -uroot \
  --single-transaction --quick --routines --events --triggers --databases "$MARIADB_DATABASE"' \
  | gzip > "$STAGE/eqemu_login.sql.gz"
# grep -q stops reading early, so feed it from a process substitution: under
# pipefail, gunzip's SIGPIPE would otherwise fail the check.
grep -q 'CREATE TABLE `login_accounts`' <(gunzip -c "$STAGE/eqemu_login.sql.gz") || fail "dump has no login_accounts table"
gunzip -c "$STAGE/eqemu_login.sql.gz" | tail -n 1 | grep -q 'Dump completed' || fail "dump did not complete"

# 2. Configuration needed to stand the service up again.
cp -p "$EQEMU_DIR/.env" "$STAGE/env"
cp -p "$EQEMU_DIR/loginserver/login.json" "$STAGE/login.json"
cp -p "$EQEMU_DIR/nginx/conf.d/default.conf" "$STAGE/nginx-default.conf"
cp -p "$KIT_DIR/RESTORE.md" "$KIT_DIR/restore.sh" "$STAGE/"
{
  echo "backup_date_utc=$DATE"
  echo "host=$(hostname)"
  echo "release=$(git -C "$EQEMU_DIR" describe --tags --always 2>/dev/null || echo unknown)"
  for s in loginserver web upgrade-agent; do
    echo "image_$s=$(docker inspect -f '{{.Config.Image}}@{{.Image}}' "eqemu-$s" 2>/dev/null || echo unknown)"
  done
} > "$STAGE/VERSION"

# 3. Encrypt (AES-256, file names hidden) and test the archive before it leaves the host.
docker run --rm --network none --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$WORK:/work" -v "$PASSFILE:/run/passphrase:ro" "$TOOLS_IMAGE" sh -c '
  set -e
  p="$(cat /run/passphrase)"
  cd /work
  7z a -t7z -mx=5 -mhe=on -p"$p" "out/'"$NAME"'.7z" "'"$NAME"'" >/dev/null
  7z t -p"$p" "out/'"$NAME"'.7z" >/dev/null
'
ARCHIVE="$WORK/out/$NAME.7z"
chmod 600 "$ARCHIVE"
log "Archive built and tested: $(du -h "$ARCHIVE" | cut -f1)"

# 4. Keep the last few archives on the host for a fast restore.
cp -p "$ARCHIVE" "$LOCAL_DIR/"
ls -1t "$LOCAL_DIR"/loginserver-backup-*.7z | tail -n +$((KEEP_LOCAL + 1)) | xargs -r rm -f

# 5. Upload: hourly copy every run, daily copy from the 03 UTC run, weekly on Sundays, then prune.
if [ "$UPLOAD" = "1" ]; then
  [ -s "$RCLONE_CONF_DIR/rclone.conf" ] || fail "no rclone config in $RCLONE_CONF_DIR"
  rc() {
    docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
      -v "$RCLONE_CONF_DIR:/config" -v "$WORK/out:/out:ro" \
      "$TOOLS_IMAGE" rclone --config /config/rclone.conf "$@"
  }
  # Pruning a folder that does not exist yet fails, so make sure all three are there.
  rc mkdir "$REMOTE/hourly"
  rc mkdir "$REMOTE/daily"
  rc mkdir "$REMOTE/weekly"
  rc copy "/out/$NAME.7z" "$REMOTE/hourly/"
  if [ "$HOUR" = "03" ]; then
    rc copy "/out/$NAME.7z" "$REMOTE/daily/"
    if [ "$(date -u +%u)" = "7" ]; then
      rc copy "/out/$NAME.7z" "$REMOTE/weekly/"
    fi
  fi
  rc delete "$REMOTE/hourly/" --min-age "${KEEP_HOURLY_HOURS}h" --include 'loginserver-backup-*.7z'
  rc delete "$REMOTE/daily/" --min-age "${KEEP_DAILY_DAYS}d" --include 'loginserver-backup-*.7z'
  rc delete "$REMOTE/weekly/" --min-age "${KEEP_WEEKLY_DAYS}d" --include 'loginserver-backup-*.7z'
  log "Uploaded to $REMOTE/hourly/$NAME.7z"
else
  log "UPLOAD=0: archive kept locally only ($LOCAL_DIR/$NAME.7z)"
fi

ping_hc ""

log "=== Backup $NAME complete ==="
