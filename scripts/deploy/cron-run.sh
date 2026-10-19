#!/bin/bash
# ──────────────────────────────────────────────
# Timer entry point for the node self-updater (installed by install-timer.sh).
#
# Sleeps a random 0..UPDATER_JITTER seconds (default 300) so the federation
# does not hit GitHub/GHCR in the same second, rotates the log at 5 MiB and
# runs `scripts/deploy.sh --auto`. All policy (auto on/off, window, max_jump)
# lives in /opt/eqemu/updater.conf; with auto=false this only checks and
# reports.
# ──────────────────────────────────────────────
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EQEMU_DIR="${EQEMU_DIR:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
export EQEMU_DIR
LOG_DIR="${UPDATER_HOME:-$HOME/eqemu-updater}"
LOG="$LOG_DIR/updater.log"
JITTER="${UPDATER_JITTER:-300}"

mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5242880 ]; then
  mv -f "$LOG" "$LOG.1"
fi

if [ "${1:-}" != "--no-jitter" ] && [[ "$JITTER" =~ ^[0-9]+$ ]] && [ "$JITTER" -gt 0 ]; then
  sleep $((RANDOM % JITTER))
fi

rc=0
"$EQEMU_DIR/scripts/deploy.sh" --auto >>"$LOG" 2>&1 || rc=$?
# 3 = another run holds the lock: not an error for a timer.
[ "$rc" = 3 ] && rc=0
exit "$rc"
