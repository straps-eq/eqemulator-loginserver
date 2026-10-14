#!/bin/bash
# Rebuild the loginserver stack from an extracted backup folder.
#   bash restore.sh /opt/eqemu            # fresh host
#   bash restore.sh /opt/eqemu --force    # replace a database that already has accounts
set -euo pipefail

TARGET="${1:?usage: restore.sh <install dir> [--force]}"
FORCE="${2:-}"
SRC="$(cd "$(dirname "$0")" && pwd)"
REPO="https://github.com/straps-eq/eqemulator-loginserver.git"

for f in eqemu_login.sql.gz env login.json nginx-default.conf VERSION; do
  [ -f "$SRC/$f" ] || { echo "missing $f next to restore.sh"; exit 1; }
done
RELEASE="$(sed -n 's/^release=//p' "$SRC/VERSION")"

if [ ! -d "$TARGET/.git" ]; then
  echo "Cloning $REPO at ${RELEASE:-main} into $TARGET"
  git clone -q "$REPO" "$TARGET"
  if [ -n "$RELEASE" ] && git -C "$TARGET" rev-parse -q --verify "$RELEASE^{commit}" >/dev/null; then
    git -C "$TARGET" checkout -q "$RELEASE"
  fi
fi

cd "$TARGET"
install -m 600 "$SRC/env" .env
install -m 600 "$SRC/login.json" loginserver/login.json
mkdir -p nginx/conf.d
install -m 644 "$SRC/nginx-default.conf" nginx/conf.d/default.conf

echo "Starting MariaDB"
docker compose up -d mariadb
until [ "$(docker inspect -f '{{.State.Health.Status}}' eqemu-mariadb 2>/dev/null)" = "healthy" ]; do sleep 3; done

existing="$(docker exec eqemu-mariadb sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb -uroot -N -e "SELECT COUNT(*) FROM \`$MARIADB_DATABASE\`.login_accounts" 2>/dev/null' || echo 0)"
if [ "${existing:-0}" -gt 0 ] && [ "$FORCE" != "--force" ]; then
  echo "The database already has $existing accounts. Re-run with --force to replace it."
  exit 1
fi

echo "Loading database dump"
gunzip -c "$SRC/eqemu_login.sql.gz" | docker exec -i eqemu-mariadb sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot'
docker exec eqemu-mariadb sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb -uroot -N -e "SELECT CONCAT(COUNT(*), \" accounts restored\") FROM \`$MARIADB_DATABASE\`.login_accounts"'

echo "Starting the rest of the stack"
docker compose up -d
docker compose ps
