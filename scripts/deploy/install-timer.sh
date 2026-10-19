#!/bin/bash
# ──────────────────────────────────────────────
# Install the node self-updater timer for the current (non-root) user.
#
#   scripts/deploy/install-timer.sh             # user crontab, every 15 min
#   scripts/deploy/install-timer.sh --systemd   # systemd --user timer instead
#   scripts/deploy/install-timer.sh --uninstall # remove both
#   scripts/deploy/install-timer.sh --print     # show what would be installed
#
# The timer runs scripts/deploy/cron-run.sh, which adds 0-5 min of random
# jitter and calls `scripts/deploy.sh --auto`, logging to
# ~/eqemu-updater/updater.log. Whether anything is installed automatically is
# decided by updater.conf (auto=false by default: check and report only).
#
# No root needed. systemd --user timers only run while you are logged in
# unless lingering is enabled (`sudo loginctl enable-linger $USER`, once);
# cron has no such limit, which is why it is the default.
# ──────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EQEMU_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
RUNNER="$SCRIPT_DIR/cron-run.sh"
MARK="# eqemu-updater (scripts/deploy/install-timer.sh)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
MODE="cron"

case "${1:-}" in
  "") ;;
  --systemd) MODE="systemd" ;;
  --uninstall) MODE="uninstall" ;;
  --print) MODE="print" ;;
  -h|--help) sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown option $1" >&2; exit 2 ;;
esac

[ "$(id -u)" != 0 ] || { echo "run as the operator user, not root" >&2; exit 2; }
id -nG | tr ' ' '\n' | grep -qx docker || echo "warning: $(id -un) is not in the docker group; deploy.sh will fail" >&2
[ -x "$RUNNER" ] || chmod +x "$RUNNER" "$EQEMU_DIR/scripts/deploy.sh"

# A per-node minute offset (0-14) spreads the fleet; cron-run.sh adds seconds of jitter.
OFFSET=$((RANDOM % 15))
MINUTES="$OFFSET,$((OFFSET + 15)),$((OFFSET + 30)),$((OFFSET + 45))"
CRON_LINE="$MINUTES * * * * EQEMU_DIR=$EQEMU_DIR $RUNNER $MARK"

remove_cron() {
  if crontab -l >/dev/null 2>&1; then
    crontab -l | grep -vF "$MARK" | crontab -
  fi
}

remove_systemd() {
  if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
    systemctl --user disable --now eqemu-updater.timer >/dev/null 2>&1 || true
  fi
  rm -f "$UNIT_DIR/eqemu-updater.service" "$UNIT_DIR/eqemu-updater.timer"
  if command -v systemctl >/dev/null 2>&1; then systemctl --user daemon-reload >/dev/null 2>&1 || true; fi
}

service_unit() {
  cat <<EOF
[Unit]
Description=EQEmulator.dev node self-updater (scripts/deploy.sh --auto)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
Environment=EQEMU_DIR=$EQEMU_DIR
Environment=UPDATER_JITTER=0
ExecStart=$RUNNER --no-jitter
EOF
}

timer_unit() {
  cat <<'EOF'
[Unit]
Description=Run the EQEmulator.dev node self-updater every 15 minutes

[Timer]
OnCalendar=*:0/15
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
EOF
}

case "$MODE" in
  print)
    echo "crontab line:"; echo "  $CRON_LINE"
    echo; echo "systemd --user units ($UNIT_DIR):"; service_unit; echo; timer_unit
    ;;
  uninstall)
    remove_cron; remove_systemd
    echo "eqemu-updater timer removed (cron and systemd --user)"
    ;;
  cron)
    command -v crontab >/dev/null 2>&1 || { echo "crontab not available; try --systemd" >&2; exit 1; }
    remove_systemd
    { crontab -l 2>/dev/null | grep -vF "$MARK" || true; echo "$CRON_LINE"; } | crontab -
    echo "installed user crontab entry:"; echo "  $CRON_LINE"
    echo "log: ${UPDATER_HOME:-$HOME/eqemu-updater}/updater.log"
    ;;
  systemd)
    command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1 \
      || { echo "systemd --user is not available in this session; use the default (cron)" >&2; exit 1; }
    remove_cron
    mkdir -p "$UNIT_DIR"
    service_unit >"$UNIT_DIR/eqemu-updater.service"
    timer_unit >"$UNIT_DIR/eqemu-updater.timer"
    systemctl --user daemon-reload
    systemctl --user enable --now eqemu-updater.timer
    echo "installed systemd --user timer eqemu-updater.timer"
    if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || echo no)" != yes ]; then
      echo "warning: lingering is off, so the timer stops when you log out." >&2
      echo "         Ask an admin to run once: sudo loginctl enable-linger $(id -un)  (or use cron)" >&2
    fi
    ;;
esac

if [ ! -f "$EQEMU_DIR/updater.conf" ]; then
  echo
  echo "note: no $EQEMU_DIR/updater.conf yet; defaults apply (channel=stable, auto=false = check only)."
  echo "      cp $EQEMU_DIR/scripts/deploy/updater.conf.example $EQEMU_DIR/updater.conf"
fi
