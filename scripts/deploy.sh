#!/bin/bash
# shellcheck disable=SC2016 # single-quoted jq programs and in-container sh -c scripts are intended
# ──────────────────────────────────────────────
# EQEmulator.dev — node self-updater
#
#   scripts/deploy.sh <version> [--allow-downgrade] [--dry-run] [--skip-health-precheck]
#   scripts/deploy.sh --auto [--now] [--dry-run]
#   scripts/deploy.sh --rollback [--dry-run]
#
# Installs a signed release on this node: fetches release.json + its cosign
# bundle from GitHub Releases, verifies both (keyless, release.yml identity),
# checks local policy (updater.conf), takes a DB dump, pulls the images by
# digest and verifies their signatures, swaps the tracked config files to the
# release tag, backfills new .env keys, re-renders nginx, applies new DB
# migrations, restarts (loginserver last), runs health gates with a soak and
# rolls back automatically if any gate fails. The result is written to
# state/updater-status.json, which the web app reads (read-only) at
# /host-state/updater-status.json.
#
# Runs as the non-root operator user in the docker group. No sudo. Nothing
# here listens on a port; everything is outbound (github.com, ghcr.io, gcr.io).
# See UPGRADING.md for setup, policy and recovery.
#
# Options:
#   <version>              install X.Y.Z (a leading "v" is accepted)
#   --auto                 timer mode: target = min(signed latest stable,
#                          desired version published by the master); obeys
#                          auto=, window= and max_jump= from updater.conf
#   --now                  with --auto: ignore the maintenance window
#   --allow-downgrade      allow a target below the running/highest version
#   --test-rollback        install, then fail the health gates on purpose to
#                          exercise the automatic rollback (manual runs only)
#   --dry-run              do every check (signatures, policy, pre-flight,
#                          staged compose config) and print the plan; changes
#                          no tracked file, container, image, database or state
#   --rollback             restore the snapshot of the last upgrade
#                          (versions.env.previous, :previous images, config)
#   --skip-health-precheck manual runs only: upgrade a node that is not
#                          healthy right now (it would otherwise need_operator)
#
# Exit codes:
#   0  ok, up to date, pending (auto off / outside window) or dry-run passed
#   1  failed (unexpected error, download error); nothing was changed, or an
#      automatic rollback ran (see state file)
#   2  usage error
#   3  another deploy.sh run holds the lock
#   4  signature / manifest verification failed
#   5  refused by policy (downgrade, min_from_version, max_jump) -> needs_operator
#   6  pre-flight failed (node unhealthy, disk, docker, permissions) -> needs_operator
#   7  upgrade failed and was rolled back successfully -> rolled_back
#   8  rollback failed or a migration failed -> needs_operator (act now)
#
# Environment overrides (rarely needed): EQEMU_DIR (default /opt/eqemu),
# UPDATER_CONF, STATE_DIR, UPDATER_HOME (default ~/eqemu-updater),
# BACKUP_DIR, COSIGN_IMAGE, JQ_IMAGE, BUSYBOX_IMAGE.
# ──────────────────────────────────────────────
set -euo pipefail
umask 022

# ── Constants ──
readonly REPO_SLUG="straps-eq/eqemulator-loginserver"
readonly RELEASE_GIT_URL="https://github.com/${REPO_SLUG}.git"
readonly RELEASE_BASE_URL="https://github.com/${REPO_SLUG}/releases"
readonly IMAGE_PREFIX="ghcr.io/straps-eq/eqemu-"
readonly CERT_IDENTITY_RE='^https://github\.com/straps-eq/eqemulator-loginserver/\.github/workflows/release\.yml@refs/tags/v.*$'
readonly CERT_OIDC_ISSUER="https://token.actions.githubusercontent.com"
readonly SERVICES=(web loginserver upgrade-agent)
readonly PIN_BEGIN="# >>> eqemu-updater pins (managed by scripts/deploy.sh from versions.env; do not edit) >>>"
readonly PIN_END="# <<< eqemu-updater pins <<<"
readonly PIN_KEYS=(EQEMU_VERSION EQEMU_SCHEMA_VERSION WEB_IMAGE LOGINSERVER_IMAGE UPGRADE_AGENT_IMAGE)
# Never written by the tracked-file swap (operator data, secrets, local state).
readonly PROTECTED_RE='^(\.env($|\.backup|\.local|\.production)|versions\.env($|\.previous)|updater\.conf|loginserver/login\.json$|uploads/|mariadb/data/|backups/|state/|certbot/|logs/|nginx/conf\.d/default\.conf$|docker-compose\.override\.ya?ml$|\.git/|\.deploy-stage/)'

# Helper images, pinned by digest, pulled anonymously.
COSIGN_IMAGE="${COSIGN_IMAGE:-gcr.io/projectsigstore/cosign:v2.4.1@sha256:b03690aa52bfe94054187142fba24dc54137650682810633901767d8a3e15b31}"
JQ_IMAGE="${JQ_IMAGE:-ghcr.io/jqlang/jq:1.7.1@sha256:096b83865ad59b5b02841f103f83f45c51318394331bf1995e187ea3be937432}"
BUSYBOX_IMAGE="${BUSYBOX_IMAGE:-busybox:1.36.1@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662}"

# Default to the checkout this script lives in, so running another clone's
# deploy.sh can never act on /opt/eqemu by accident. Preflight also checks that
# the running stack was started from this directory.
EQEMU_DIR="${EQEMU_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
UPDATER_CONF="${UPDATER_CONF:-$EQEMU_DIR/updater.conf}"
STATE_DIR="${STATE_DIR:-$EQEMU_DIR/state}"
UPDATER_HOME="${UPDATER_HOME:-$HOME/eqemu-updater}"
STATUS_FILE="$STATE_DIR/updater-status.json"
HIGHEST_FILE="$STATE_DIR/updater-highest-version"
BLOCKED_FILE="$STATE_DIR/updater-blocked-version"
VERSIONS_FILE="$EQEMU_DIR/versions.env"
VERSIONS_PREV="$EQEMU_DIR/versions.env.previous"
LOCK_FILE="$EQEMU_DIR/.upgrade.lock"
SNAP_ROOT="$UPDATER_HOME/snapshots"

E_OK=0; E_FAIL=1; E_USAGE=2; E_LOCKED=3; E_VERIFY=4; E_POLICY=5; E_PREFLIGHT=6
E_ROLLED_BACK=7; E_NEEDS_OPERATOR=8

# ── Run state ──
MODE=""; REQ_VERSION=""; OPT_NOW=0; OPT_DOWNGRADE=0; DRY_RUN=0; SKIP_PRECHECK=0; OPT_TEST_ROLLBACK=0
TMP=""; STAGE=""; SNAP=""
FINALIZED=0; CHANGED=0; ROLLING_BACK=0
CONFIG_SWAPPED=0; NGINX_CHANGED=0; RESTARTED=0
CUR_VERSION=""; CUR_SOURCE=""; FIRST_RUN=0; PREV_COMMIT=""; PREV_HEAD_REF=""
TAG_COMMIT=""; RESTART_SINCE=""
ST_VERSION=""; ST_PREV_VERSION=""; ST_PENDING=""; ST_SCHEMA=""
HEALTH_ERR=""; MIG_ERR=""; BACKUP_DIR="${BACKUP_DIR:-}"
# Manifest fields (set by load_manifest)
M_VERSION=""; M_CHANNEL=""; M_RELEASED_AT=""; M_COMPOSE_REF=""; M_COMPOSE_COMMIT=""
M_MIN_FROM=""; M_SCHEMA_VERSION=""; M_NOTES_URL=""; M_IMG_WEB=""; M_IMG_LS=""; M_IMG_AGENT=""
M_MIGRATIONS=(); M_ENV_KEYS=()
# Policy (updater.conf)
CF_CHANNEL="stable"; CF_AUTO="false"; CF_WINDOW="03:00-05:00"; CF_MAX_JUMP="minor"
CF_FOLLOW_MASTER="true"; CF_WEBHOOK=""; CF_BACKUP_DIR=""; CF_KEEP_BACKUPS="5"
CF_COMPOSE_FILE=""; CF_SOAK="120"; CF_UDP_PROBE="false"
CF_HEARTBEAT_RE='\[startup\] ✓|\[federation\] auto-sync started'
readonly FORBIDDEN_LOG_RE='Access denied for user|ER_ACCESS_DENIED_ERROR'

# ══════════════════════════════════════════════
# Small helpers
# ══════════════════════════════════════════════
log()  { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] $*"; }
warn() { log "WARNING: $*"; }
plan() { log "PLAN: $*"; }
now_iso() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

usage() { sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit "$E_USAGE"; }

is_semver() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

# ver_cmp A B -> prints -1, 0 or 1
ver_cmp() {
  local -a a b
  local i
  IFS=. read -r -a a <<<"$1"
  IFS=. read -r -a b <<<"$2"
  for i in 0 1 2; do
    if ((10#${a[i]} > 10#${b[i]})); then echo 1; return; fi
    if ((10#${a[i]} < 10#${b[i]})); then echo -1; return; fi
  done
  echo 0
}
ver_lt() { [ "$(ver_cmp "$1" "$2")" = "-1" ]; }
ver_gt() { [ "$(ver_cmp "$1" "$2")" = "1" ]; }
ver_max() { if ver_gt "$1" "$2"; then echo "$1"; else echo "$2"; fi; }

# jq on the host if installed, else the pinned jq image. Input always on stdin.
jqx() {
  if command -v jq >/dev/null 2>&1; then
    jq "$@"
  else
    docker run --rm -i --network none "$JQ_IMAGE" "$@"
  fi
}

http_get() { # URL OUTFILE
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --proto '=https' --retry 3 --retry-delay 2 -m 60 -o "$2" "$1"
  else
    wget -q -T 60 -t 3 -O "$2" "$1"
  fi
}

# KEY=VALUE reader for env-style files (never sourced). Last value wins.
kv_get() { # FILE KEY
  [ -f "$1" ] || return 0
  local v
  v="$(sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" | tail -n 1)"
  v="${v%$'\r'}"
  v="${v%"${v##*[![:space:]]}"}"
  if [[ "$v" =~ ^\"(.*)\"$ ]] || [[ "$v" =~ ^\'(.*)\'$ ]]; then v="${BASH_REMATCH[1]}"; fi
  printf '%s' "$v"
}

# Atomic install of SRC as DEST (same directory temp + rename). Keeps SRC's mode.
install_file() { # SRC DEST
  local dest="$2" tmp
  mkdir -p "$(dirname "$dest")"
  tmp="$(dirname "$dest")/.$(basename "$dest").deploy-tmp.$$"
  cp -P --preserve=mode "$1" "$tmp"
  mv -f "$tmp" "$dest"
}

compose() {
  (cd "$EQEMU_DIR" && docker compose --project-directory "$EQEMU_DIR" "$@")
}

db_exec() { # SQL on stdin, root password read inside the container (never on the host)
  # shellcheck disable=SC2016 # expanded inside the container
  docker exec -i eqemu-mariadb sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb --batch --skip-column-names -uroot "$MARIADB_DATABASE"'
}
db_query() { printf '%s\n' "$1" | db_exec; }

container_running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || echo false)" = "true" ]; }
restart_count() { docker inspect -f '{{.RestartCount}}' "$1" 2>/dev/null || echo "?"; }

notify() { # MESSAGE — optional Discord webhook; URL never printed or put on argv
  [ -n "$CF_WEBHOOK" ] && [ "$DRY_RUN" = 0 ] || return 0
  local body
  body="$(jqx -n --arg c "[$(hostname)] $1" '{content: $c}' </dev/null)" || return 0
  if command -v curl >/dev/null 2>&1; then
    printf 'url = "%s"\n' "$CF_WEBHOOK" | curl -fsS -m 10 -K - -H 'Content-Type: application/json' \
      -d "$body" -o /dev/null 2>/dev/null || warn "Discord notification failed"
  fi
}

# ══════════════════════════════════════════════
# Status file (state/updater-status.json) — exact schema, read by web
# ══════════════════════════════════════════════
status_get() { # FIELD from the existing status file
  [ -s "$STATUS_FILE" ] || return 0
  jqx -r --arg k "$1" '.[$k] // empty | tostring' <"$STATUS_FILE" 2>/dev/null || true
}

running_image_ref() { # SERVICE -> repo@sha256 of the running container, best effort
  local c="eqemu-$1" ref id rd
  ref="$(docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null || true)"
  [ -n "$ref" ] || { echo ""; return 0; }
  if [[ "$ref" == *@sha256:* ]]; then echo "${ref#*@sha256:}" | grep -qE '^[0-9a-f]{64}$' && { echo "$ref" | sed -E 's/:[^/@]+@/@/'; return 0; }; fi
  id="$(docker inspect -f '{{.Image}}' "$c" 2>/dev/null || true)"
  rd="$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$id" 2>/dev/null | grep "^${IMAGE_PREFIX}$1@" | head -n 1 || true)"
  echo "${rd:-$ref}"
}

current_schema_version() {
  local s
  s="$(db_query "SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1" 2>/dev/null | head -n 1 || true)"
  s="${s%.sql}"
  echo "${s:-${ST_SCHEMA:-$(status_get schema_version)}}"
}

write_status() { # RESULT [ERROR]
  local result="$1" err="${2:-}"
  if [ "$DRY_RUN" = 1 ]; then
    log "dry-run: would write $STATUS_FILE (last_result=$result${err:+, last_error=$err})"
    return 0
  fi
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  if [ ! -w "$STATE_DIR" ]; then
    warn "cannot write $STATE_DIR (fix: sudo chown $(id -un) $STATE_DIR)"
    return 0
  fi
  local version prev schema w l a tmp
  version="${ST_VERSION:-$CUR_VERSION}"
  version="${version:-$(status_get version)}"
  prev="${ST_PREV_VERSION:-$(status_get previous_version)}"
  schema="$(current_schema_version)"
  w="$(running_image_ref web)"; l="$(running_image_ref loginserver)"; a="$(running_image_ref upgrade-agent)"
  tmp="$STATE_DIR/.updater-status.json.tmp.$$"
  if ! jqx -n \
    --arg version "$version" --arg previous_version "$prev" --arg channel "$CF_CHANNEL" \
    --argjson auto "$([ "$CF_AUTO" = true ] && echo true || echo false)" \
    --arg last_check_at "$(now_iso)" --arg last_result "$result" --arg last_error "$err" \
    --arg pending_version "$ST_PENDING" --arg web "$w" --arg loginserver "$l" --arg agent "$a" \
    --arg schema_version "$schema" --arg updated_at "$(now_iso)" '
    def n: if . == "" then null else . end;
    { version: ($version|n), previous_version: ($previous_version|n), channel: $channel,
      auto: $auto, last_check_at: $last_check_at, last_result: $last_result,
      last_error: ($last_error|n), pending_version: ($pending_version|n),
      images: { web: ($web|n), loginserver: ($loginserver|n), "upgrade-agent": ($agent|n) },
      schema_version: ($schema_version|n), updated_at: $updated_at }' </dev/null >"$tmp"; then
    warn "could not write $STATUS_FILE"
    rm -f "$tmp"
    return 0
  fi
  chmod 644 "$tmp"
  mv -f "$tmp" "$STATUS_FILE"
}

# finish RESULT EXIT_CODE [MESSAGE]
finish() {
  local result="$1" code="$2" msg="${3:-}" err="" same=0
  FINALIZED=1
  if [ "$code" = 0 ]; then log "$result${msg:+: $msg}"; else log "RESULT $result (exit $code)${msg:+: $msg}"; err="$msg"; fi
  # The timer repeats every 15 min: only notify when the outcome changes.
  if [ "$MODE" = auto ] && [ "$(status_get last_result)" = "$result" ] && [ "$(status_get last_error)" = "$err" ]; then same=1; fi
  write_status "$result" "$err"
  if [ "$same" = 0 ] && [ "$DRY_RUN" = 0 ]; then
    case "$result" in
      ok) if [ -n "$ST_PREV_VERSION" ]; then notify "installed ${ST_VERSION} (was ${ST_PREV_VERSION})${M_NOTES_URL:+ - $M_NOTES_URL}"; fi ;;
      rolled_back|needs_operator|failed) notify "$result: $msg" ;;
    esac
  fi
  exit "$code"
}

# Leave last_result/last_error as they were (pending update, nothing done) and exit 0.
report_pending() { # MESSAGE [ERROR_OVERRIDE]
  local prev_res prev_err
  FINALIZED=1
  log "$1"
  prev_res="$(status_get last_result | grep -E '^(ok|up_to_date|failed|rolled_back|needs_operator)$' || true)"
  prev_err="${2:-$(status_get last_error)}"
  ST_VERSION="$CUR_VERSION"
  write_status "${prev_res:-up_to_date}" "$prev_err"
  exit "$E_OK"
}

on_exit() {
  local rc=$?
  set +e
  if [ "$rc" != 0 ] && [ "$FINALIZED" = 0 ]; then
    FINALIZED=1
    if [ "$CHANGED" = 1 ] && [ "$ROLLING_BACK" = 0 ]; then
      log "unexpected error (exit $rc) after changes started: rolling back"
      if rollback_changes "unexpected error (exit $rc)"; then
        write_status rolled_back "unexpected error (exit $rc); rolled back"
        notify "rolled_back: unexpected error (exit $rc)"
        rc=$E_ROLLED_BACK
      else
        write_status needs_operator "unexpected error (exit $rc) and rollback failed"
        notify "needs_operator: unexpected error (exit $rc) and rollback failed"
        rc=$E_NEEDS_OPERATOR
      fi
    elif [ "$rc" != "$E_LOCKED" ] && [ "$rc" != "$E_USAGE" ]; then
      write_status failed "unexpected error (exit $rc)"
    fi
  fi
  [ -n "$STAGE" ] && rm -rf "$STAGE"
  [ -n "$TMP" ] && rm -rf "$TMP"
  exit "$rc"
}

# ══════════════════════════════════════════════
# Configuration
# ══════════════════════════════════════════════
load_conf() {
  if [ -f "$UPDATER_CONF" ]; then
    local v k
    for k in channel auto window max_jump follow_master discord_webhook backup_dir keep_backups \
             compose_file soak_seconds udp_probe heartbeat_pattern; do
      v="$(kv_get "$UPDATER_CONF" "$k")"
      [ -n "$v" ] || continue
      case "$k" in
        channel) CF_CHANNEL="$v" ;; auto) CF_AUTO="$v" ;; window) CF_WINDOW="$v" ;;
        max_jump) CF_MAX_JUMP="$v" ;; follow_master) CF_FOLLOW_MASTER="$v" ;;
        discord_webhook) CF_WEBHOOK="$v" ;; backup_dir) CF_BACKUP_DIR="$v" ;;
        keep_backups) CF_KEEP_BACKUPS="$v" ;; compose_file) CF_COMPOSE_FILE="$v" ;;
        soak_seconds) CF_SOAK="$v" ;; udp_probe) CF_UDP_PROBE="$v" ;;
        heartbeat_pattern) CF_HEARTBEAT_RE="$v" ;;
      esac
    done
    if [ -n "$CF_WEBHOOK" ] && [ "$(stat -c %a "$UPDATER_CONF")" != 600 ]; then
      warn "$UPDATER_CONF holds a webhook URL: chmod 600 it"
    fi
  else
    log "no $UPDATER_CONF: using defaults (channel=stable auto=false window=$CF_WINDOW max_jump=minor)"
  fi
  case "$CF_CHANNEL" in stable) ;; *) echo "updater.conf: channel=$CF_CHANNEL is not supported (stable only)" >&2; exit "$E_USAGE" ;; esac
  case "$CF_AUTO" in true|false) ;; *) echo "updater.conf: auto must be true or false" >&2; exit "$E_USAGE" ;; esac
  case "$CF_MAX_JUMP" in patch|minor|major) ;; *) echo "updater.conf: max_jump must be patch, minor or major" >&2; exit "$E_USAGE" ;; esac
  [[ "$CF_SOAK" =~ ^[0-9]+$ ]] || CF_SOAK=120
  [[ "$CF_KEEP_BACKUPS" =~ ^[0-9]+$ ]] || CF_KEEP_BACKUPS=5
  BACKUP_DIR="${BACKUP_DIR:-${CF_BACKUP_DIR:-$HOME/eqemu-backups/pre-upgrade}}"
  if [ -n "$CF_COMPOSE_FILE" ]; then export COMPOSE_FILE="$CF_COMPOSE_FILE"; fi
}

# Docker: keep the daemon endpoint of the current context, but use an empty
# client config so every pull is anonymous (a stale `docker login ghcr.io`
# would otherwise turn public pulls into "denied").
setup_docker_env() {
  if [ -z "${DOCKER_HOST:-}" ]; then
    local h
    h="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
    [ -n "$h" ] && export DOCKER_HOST="$h"
  fi
  local user_cfg="${DOCKER_CONFIG:-$HOME/.docker}"
  if [ -f "$user_cfg/config.json" ] && grep -q 'ghcr\.io' "$user_cfg/config.json"; then
    warn "$user_cfg/config.json has a ghcr.io entry. The release images are public; run 'docker logout ghcr.io' (deploy.sh pulls anonymously and ignores it)."
  fi
  mkdir -p "$TMP/docker-config"
  if [ -d "$user_cfg/cli-plugins" ]; then ln -s "$user_cfg/cli-plugins" "$TMP/docker-config/cli-plugins"; fi
  export DOCKER_CONFIG="$TMP/docker-config"
  # Pins must come from .env / versions.env only, never from the caller's shell.
  unset "${PIN_KEYS[@]}"
}

# ══════════════════════════════════════════════
# Current version
# ══════════════════════════════════════════════
detect_current() {
  local v=""
  if [ -n "${EQEMU_CURRENT_VERSION:-}" ]; then
    v="${EQEMU_CURRENT_VERSION#v}"; CUR_SOURCE="EQEMU_CURRENT_VERSION"
    [ -f "$VERSIONS_FILE" ] || FIRST_RUN=1
  elif [ -f "$VERSIONS_FILE" ]; then
    v="$(kv_get "$VERSIONS_FILE" EQEMU_VERSION)"; CUR_SOURCE="versions.env"
  else
    FIRST_RUN=1
  fi
  if ! is_semver "$v"; then
    v="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' eqemu-web 2>/dev/null || true)"
    v="${v#v}"; CUR_SOURCE="eqemu-web image label"
  fi
  if ! is_semver "$v"; then
    v="$(db_query "SELECT software_version FROM federation_nodes WHERE is_self=1 LIMIT 1" 2>/dev/null || true)"
    v="${v#v}"; CUR_SOURCE="federation_nodes self row"
  fi
  if ! is_semver "$v"; then
    v="$(git -C "$EQEMU_DIR" describe --tags --exact-match HEAD 2>/dev/null || true)"
    v="${v#v}"; CUR_SOURCE="git tag at HEAD"
  fi
  if ! is_semver "$v"; then
    v="$(git -C "$EQEMU_DIR" describe --tags --abbrev=0 HEAD 2>/dev/null || true)"
    v="${v#v}"; CUR_SOURCE="nearest git tag (approximate)"
  fi
  is_semver "$v" || { CUR_VERSION=""; CUR_SOURCE="unknown"; return 0; }
  CUR_VERSION="$v"
  PREV_COMMIT="$(git -C "$EQEMU_DIR" rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null || true)"
  PREV_HEAD_REF="$(git -C "$EQEMU_DIR" symbolic-ref -q HEAD 2>/dev/null || true)"
}

# ══════════════════════════════════════════════
# Manifest: fetch + verify + parse
# ══════════════════════════════════════════════
cosign_run() { # cosign args... (files under $TMP/m are mounted at /m)
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp --tmpfs /tmp \
    -v "$TMP/m:/m:ro" "$COSIGN_IMAGE" "$@"
}

fetch_manifest() { # VERSION|latest -> $TMP/m/release.json (verified)
  local which="$1" base
  mkdir -p "$TMP/m"; rm -f "$TMP/m/release.json" "$TMP/m/release.json.bundle"
  if [ "$which" = latest ]; then base="$RELEASE_BASE_URL/latest/download"; else base="$RELEASE_BASE_URL/download/v$which"; fi
  log "fetching release.json ($which)"
  if ! http_get "$base/release.json" "$TMP/m/release.json" || ! http_get "$base/release.json.bundle" "$TMP/m/release.json.bundle"; then
    return 10
  fi
  log "verifying release.json signature (cosign keyless, release.yml identity)"
  if ! cosign_run verify-blob --bundle /m/release.json.bundle \
        --certificate-identity-regexp "$CERT_IDENTITY_RE" \
        --certificate-oidc-issuer "$CERT_OIDC_ISSUER" /m/release.json >"$TMP/cosign.log" 2>&1; then
    sed 's/^/  cosign: /' "$TMP/cosign.log" | tail -n 5
    return 11
  fi
  return 0
}

load_manifest() { # parses the verified $TMP/m/release.json into M_* and validates every field
  local out
  out="$(jqx -r '
    def s: if type == "string" then . else error("expected string") end;
    @sh "M_VERSION=\(.version|s)",
    @sh "M_CHANNEL=\(.channel|s)",
    @sh "M_RELEASED_AT=\(.released_at|s)",
    @sh "M_COMPOSE_REF=\(.compose_ref|s)",
    @sh "M_COMPOSE_COMMIT=\(.compose_commit|s)",
    @sh "M_MIN_FROM=\(.min_from_version|s)",
    @sh "M_SCHEMA_VERSION=\(.schema_version // "" |s)",
    @sh "M_NOTES_URL=\(.notes_url // "" |s)",
    @sh "M_IMG_WEB=\(.images.web|s)",
    @sh "M_IMG_LS=\(.images.loginserver|s)",
    @sh "M_IMG_AGENT=\(.images["upgrade-agent"]|s)",
    "M_MIGRATIONS=(\([.migrations[]|s|@sh]|join(" ")))",
    "M_ENV_KEYS=(\([(.env_keys_added // [])[]|s|@sh]|join(" ")))"
  ' <"$TMP/m/release.json")" || { log "release.json is malformed"; return 1; }
  eval "$out"
  local bad=""
  is_semver "$M_VERSION" || bad="version"
  is_semver "$M_MIN_FROM" || bad="$bad min_from_version"
  [ "$M_COMPOSE_REF" = "v$M_VERSION" ] || bad="$bad compose_ref"
  [[ "$M_COMPOSE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || bad="$bad compose_commit"
  [[ "$M_SCHEMA_VERSION" =~ ^[A-Za-z0-9._-]*$ ]] || bad="$bad schema_version"
  [[ "$M_IMG_WEB" =~ ^ghcr\.io/straps-eq/eqemu-web@sha256:[0-9a-f]{64}$ ]] || bad="$bad images.web"
  [[ "$M_IMG_LS" =~ ^ghcr\.io/straps-eq/eqemu-loginserver@sha256:[0-9a-f]{64}$ ]] || bad="$bad images.loginserver"
  [[ "$M_IMG_AGENT" =~ ^ghcr\.io/straps-eq/eqemu-upgrade-agent@sha256:[0-9a-f]{64}$ ]] || bad="$bad images.upgrade-agent"
  local f
  for f in "${M_MIGRATIONS[@]}"; do [[ "$f" =~ ^[A-Za-z0-9._-]+\.sql$ ]] || bad="$bad migrations($f)"; done
  for f in "${M_ENV_KEYS[@]}"; do [[ "$f" =~ ^[A-Z][A-Z0-9_]*(=[^$'\n']*)?$ ]] || bad="$bad env_keys_added"; done
  if [ -n "$bad" ]; then log "release.json has invalid fields:$bad"; return 1; fi
  if [ "$M_CHANNEL" != "$CF_CHANNEL" ]; then log "release.json channel '$M_CHANNEL' != node channel '$CF_CHANNEL'"; return 1; fi
  return 0
}

get_verified_manifest() { # VERSION|latest ; exits on failure
  local rc=0
  fetch_manifest "$1" || rc=$?
  case "$rc" in
    0) ;;
    10) finish failed "$E_FAIL" "could not download release.json for $1 from GitHub Releases" ;;
    *) finish failed "$E_VERIFY" "signature verification of release.json ($1) FAILED; refusing to continue" ;;
  esac
  load_manifest || finish failed "$E_VERIFY" "release.json ($1) failed validation"
  if [ "$1" != latest ] && [ "$M_VERSION" != "$1" ]; then
    finish failed "$E_VERIFY" "release.json for v$1 claims version $M_VERSION"
  fi
  log "release.json verified: $M_VERSION ($M_CHANNEL, released $M_RELEASED_AT, commit ${M_COMPOSE_COMMIT:0:12})"
}

# ══════════════════════════════════════════════
# Policy
# ══════════════════════════════════════════════
in_window() { # SPEC like "03:00-05:00" or "Tue,Thu 03:00-05:00" (UTC)
  local spec="$1" days="" range
  if [[ "$spec" == *" "* ]]; then days="${spec%% *}"; range="${spec##* }"; else range="$spec"; fi
  [[ "$range" =~ ^([0-2][0-9]):([0-5][0-9])-([0-2][0-9]):([0-5][0-9])$ ]] || { warn "bad window '$spec'"; return 1; }
  local s=$((10#${BASH_REMATCH[1]} * 60 + 10#${BASH_REMATCH[2]}))
  local e=$((10#${BASH_REMATCH[3]} * 60 + 10#${BASH_REMATCH[4]}))
  local h m today yday n
  h="$(date -u +%H)"; m="$(date -u +%M)"; n=$((10#$h * 60 + 10#$m))
  today="$(date -u +%a)"; yday="$(date -u -d yesterday +%a 2>/dev/null || echo "$today")"
  local day_ok_today=1 day_ok_yday=1
  if [ -n "$days" ]; then
    [[ ",$days," == *",$today,"* ]] || day_ok_today=0
    [[ ",$days," == *",$yday,"* ]] || day_ok_yday=0
  fi
  if ((s <= e)); then
    ((n >= s && n < e && day_ok_today))
  else # crosses midnight: the part after midnight belongs to yesterday's window
    ((n >= s && day_ok_today)) || ((n < e && day_ok_yday))
  fi
}

jump_allowed() { # FROM TO
  local fa fb ta tb
  IFS=. read -r fa fb _ <<<"$1"; IFS=. read -r ta tb _ <<<"$2"
  case "$CF_MAX_JUMP" in
    major) return 0 ;;
    minor) [ "$fa" = "$ta" ] ;;
    patch) [ "$fa" = "$ta" ] && [ "$fb" = "$tb" ] ;;
  esac
}

master_desired_version() {
  [ "$CF_FOLLOW_MASTER" = true ] || return 0
  local j v
  j="$(docker exec eqemu-web wget -qO- -T 5 http://127.0.0.1:3000/api/updater/desired 2>/dev/null || true)"
  [ -n "$j" ] || return 0
  v="$(printf '%s' "$j" | jqx -r '.desired_version_stable // empty' 2>/dev/null || true)"
  v="${v#v}"
  is_semver "$v" && echo "$v"
  return 0
}

# ══════════════════════════════════════════════
# Health
# ══════════════════════════════════════════════
web_health() { # -> 0 when /api/health says ok (and schema matches if both sides report one)
  container_running eqemu-web || { HEALTH_ERR="eqemu-web not running"; return 1; }
  local j st sv
  j="$(docker exec eqemu-web wget -qO- -T 5 http://127.0.0.1:3000/api/health 2>/dev/null || true)"
  [ -n "$j" ] || { HEALTH_ERR="web /api/health unreachable"; return 1; }
  st="$(printf '%s' "$j" | jqx -r '.status // empty' 2>/dev/null || true)"
  [ "$st" = ok ] || { HEALTH_ERR="web /api/health status=${st:-?}"; return 1; }
  if [ -n "${1:-}" ]; then
    sv="$(printf '%s' "$j" | jqx -r '.schema_version // empty' 2>/dev/null || true)"
    if [ -n "$sv" ] && [ "$sv" != "$1" ]; then HEALTH_ERR="web reports schema $sv, expected $1"; return 1; fi
  fi
  return 0
}

configured_udp_ports() {
  local p=""
  if [ -r "$EQEMU_DIR/loginserver/login.json" ]; then
    p="$(jqx -r '.client_configuration // {} | to_entries[] | select(.key|endswith("_port")) | .value | tostring' \
          <"$EQEMU_DIR/loginserver/login.json" 2>/dev/null | grep -E '^[0-9]+$' | grep -v '^0$' | sort -u | tr '\n' ' ' || true)"
  fi
  echo "${p:-5998 5999 15900 15901}"
}

# /proc/net/udp{,6} on stdin -> space separated list of bound local ports
parse_udp_ports() {
  local h
  awk '$2 ~ /:/ { n = split($2, a, ":"); if (a[n] ~ /^[0-9A-Fa-f]+$/) print a[n] }' \
    | while read -r h; do echo $((16#$h)); done | sort -un | tr '\n' ' '
}

loginserver_health() {
  container_running eqemu-loginserver || { HEALTH_ERR="eqemu-loginserver not running"; return 1; }
  local bound port missing=""
  bound="$(docker exec eqemu-loginserver cat /proc/net/udp /proc/net/udp6 2>/dev/null | parse_udp_ports)" || true
  for port in $(configured_udp_ports); do
    [[ " $bound " == *" $port "* ]] || missing="$missing $port"
  done
  [ -z "$missing" ] || { HEALTH_ERR="loginserver UDP port(s) not bound:$missing"; return 1; }
  if [ "$CF_UDP_PROBE" = true ]; then
    # OP_SessionRequest: 00 01 | protocol 3 | connect code | max packet 512 -> expect 00 02 (OP_SessionResponse)
    local reply
    reply="$(docker run --rm --network host "$BUSYBOX_IMAGE" sh -c \
      "printf '\000\001\000\000\000\003\021\042\063\104\000\000\002\000' | nc -u -w 3 127.0.0.1 5999 | head -c 2 | od -An -tx1" 2>/dev/null | tr -d ' \n' || true)"
    [ "$reply" = "0002" ] || { HEALTH_ERR="UDP probe on 5999 got no OP_SessionResponse (${reply:-none})"; return 1; }
  fi
  return 0
}

node_health() { HEALTH_ERR=""; web_health "${1:-}" && loginserver_health; }

wait_web() { # TIMEOUT EXPECTED_SCHEMA
  local end=$((SECONDS + $1))
  while ((SECONDS < end)); do
    HEALTH_ERR=""
    web_health "$2" && return 0
    sleep 5
  done
  return 1
}

heartbeat_check() { # web log since restart must show the heartbeat pattern and no DB auth errors
  local end=$((SECONDS + 90)) logs started
  started="$(docker inspect -f '{{.State.StartedAt}}' eqemu-web 2>/dev/null || true)"
  if [[ "${started:0:19}" < "${RESTART_SINCE:0:19}" ]]; then
    log "gate: eqemu-web was not recreated (unchanged), skipping the heartbeat log check"
    return 0
  fi
  while ((SECONDS < end)); do
    logs="$(docker logs --since "$RESTART_SINCE" eqemu-web 2>&1 || true)"
    if printf '%s' "$logs" | grep -qE "$FORBIDDEN_LOG_RE"; then HEALTH_ERR="web log shows database access errors"; return 1; fi
    printf '%s' "$logs" | grep -qE "$CF_HEARTBEAT_RE" && return 0
    sleep 5
  done
  HEALTH_ERR="web log never showed /$CF_HEARTBEAT_RE/ after the restart"
  return 1
}

nginx_reload() {
  container_running eqemu-nginx || { HEALTH_ERR="eqemu-nginx not running"; return 1; }
  docker exec eqemu-nginx nginx -t >/dev/null 2>&1 || { HEALTH_ERR="nginx -t failed"; return 1; }
  docker exec eqemu-nginx nginx -s reload >/dev/null 2>&1 || { HEALTH_ERR="nginx reload failed"; return 1; }
}

run_gates() { # SOAK_SECONDS EXPECTED_SCHEMA -> 0 ok; HEALTH_ERR on failure
  local soak="$1" schema="$2"
  HEALTH_ERR=""
  log "gate: web /api/health"
  wait_web 150 "$schema" || return 1
  log "gate: nginx config test + reload"
  nginx_reload || return 1
  log "gate: loginserver running, UDP ports $(configured_udp_ports)bound"
  local end=$((SECONDS + 60))
  until loginserver_health; do ((SECONDS < end)) || return 1; sleep 5; done
  log "gate: heartbeat log line"
  heartbeat_check || return 1
  # --test-rollback: fail here, after the new version is up, to exercise the
  # automatic rollback. Never applies to the rollback's own gates.
  if [ "$OPT_TEST_ROLLBACK" = 1 ] && [ "$ROLLING_BACK" = 0 ]; then
    HEALTH_ERR="forced gate failure (--test-rollback)"
    return 1
  fi
  local rw rl
  rw="$(restart_count eqemu-web)"; rl="$(restart_count eqemu-loginserver)"
  log "gate: soak ${soak}s"
  end=$((SECONDS + soak))
  while ((SECONDS < end)); do
    sleep 15
    node_health "$schema" || return 1
    [ "$(restart_count eqemu-web)" = "$rw" ] || { HEALTH_ERR="eqemu-web restarted during soak"; return 1; }
    [ "$(restart_count eqemu-loginserver)" = "$rl" ] || { HEALTH_ERR="eqemu-loginserver restarted during soak"; return 1; }
  done
  return 0
}

# ══════════════════════════════════════════════
# Pre-flight
# ══════════════════════════════════════════════
preflight_tools() {
  local c missing=""
  for c in docker git flock awk sed grep gzip tar sha256sum df cmp; do command -v "$c" >/dev/null 2>&1 || missing="$missing $c"; done
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || missing="$missing curl"
  [ -z "$missing" ] || { echo "missing tools:$missing" >&2; exit "$E_PREFLIGHT"; }
}

preflight() { # needs manifest loaded
  local errs=()
  docker info >/dev/null 2>&1 || errs+=("docker daemon not reachable (is $(id -un) in the docker group?)")
  docker compose version >/dev/null 2>&1 || errs+=("docker compose v2 not available")
  git -C "$EQEMU_DIR" rev-parse --git-dir >/dev/null 2>&1 || errs+=("$EQEMU_DIR is not a git checkout (see UPGRADING.md, first run)")
  [ -f "$EQEMU_DIR/.env" ] || errs+=("$EQEMU_DIR/.env missing")
  [ -w "$EQEMU_DIR/.env" ] && [ -w "$EQEMU_DIR" ] || errs+=("$EQEMU_DIR or its .env is not writable by $(id -un)")
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  [ -w "$STATE_DIR" ] || errs+=("$STATE_DIR not writable (sudo chown $(id -un) $STATE_DIR)")
  mkdir -p "$BACKUP_DIR" 2>/dev/null || true
  [ -w "$BACKUP_DIR" ] || errs+=("backup dir $BACKUP_DIR not writable")
  if mkdir -p "$SNAP_ROOT" 2>/dev/null; then chmod 700 "$UPDATER_HOME" 2>/dev/null || true; fi
  [ -w "$SNAP_ROOT" ] || errs+=("$SNAP_ROOT not writable")
  # The running stack must belong to this checkout, or a deploy from another
  # clone would migrate the live database and then collide on container names.
  local wd
  wd="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' eqemu-web 2>/dev/null || true)"
  if [ -n "$wd" ] && [ "$(cd "$wd" 2>/dev/null && pwd -P)" != "$(cd "$EQEMU_DIR" && pwd -P)" ]; then
    errs+=("the running stack was started from $wd, not $EQEMU_DIR (run that checkout's scripts/deploy.sh, or set EQEMU_DIR)")
  fi
  if [ "${#errs[@]}" -gt 0 ]; then
    local e; for e in "${errs[@]}"; do log "pre-flight: $e"; done
    finish needs_operator "$E_PREFLIGHT" "pre-flight: ${errs[0]}"
  fi

  # Disk: 2x the current eqemu image size on the docker root, 2x the DB on the backup dir.
  local img_bytes=0 b id root free_docker free_backup db_bytes
  for b in "${SERVICES[@]}"; do
    id="$(docker inspect -f '{{.Image}}' "eqemu-$b" 2>/dev/null || true)"
    if [ -n "$id" ]; then img_bytes=$((img_bytes + $(docker image inspect -f '{{.Size}}' "$id" 2>/dev/null || echo 0))); fi
  done
  root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  free_docker="$(df -PB1 "$root" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
  [ -n "$free_docker" ] || free_docker="$(df -PB1 / | awk 'NR==2 {print $4}')"
  db_bytes="$(db_query "SELECT COALESCE(SUM(data_length+index_length),0) FROM information_schema.TABLES WHERE table_schema=DATABASE()" 2>/dev/null | head -n 1 || echo "")"
  [[ "$db_bytes" =~ ^[0-9]+$ ]] || finish needs_operator "$E_PREFLIGHT" "pre-flight: database not reachable via eqemu-mariadb"
  free_backup="$(df -PB1 "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
  local need_docker=$((2 * img_bytes)); ((need_docker > 1073741824)) || need_docker=1073741824
  ((free_docker >= need_docker)) || finish needs_operator "$E_PREFLIGHT" "pre-flight: only $((free_docker / 1048576)) MiB free for images, need $((need_docker / 1048576)) MiB"
  ((free_backup >= 2 * db_bytes + 104857600)) || finish needs_operator "$E_PREFLIGHT" "pre-flight: not enough space in $BACKUP_DIR for the DB dump"
  log "pre-flight: disk ok (images $((free_docker / 1048576)) MiB free, backups $((free_backup / 1048576)) MiB free, DB $((db_bytes / 1048576)) MiB)"

  # Registry reachable anonymously (empty DOCKER_CONFIG is already in effect).
  if docker manifest inspect "$M_IMG_WEB" >/dev/null 2>&1 || docker buildx imagetools inspect "$M_IMG_WEB" >/dev/null 2>&1; then
    log "pre-flight: ghcr.io reachable anonymously"
  else
    finish needs_operator "$E_PREFLIGHT" "pre-flight: anonymous pull test of $M_IMG_WEB failed (network/registry)"
  fi

  # schema_migrations readable (or absent: bootstrapped later).
  db_query "SELECT 1" >/dev/null 2>&1 || finish needs_operator "$E_PREFLIGHT" "pre-flight: cannot run SQL in eqemu-mariadb"

  # Never upgrade a sick node automatically.
  if [ "$SKIP_PRECHECK" = 1 ]; then
    warn "--skip-health-precheck: not checking node health before the upgrade"
  elif node_health ""; then
    log "pre-flight: node healthy (web ok, loginserver ports bound)"
  else
    finish needs_operator "$E_PREFLIGHT" "node is not healthy before the upgrade: $HEALTH_ERR"
  fi
}

# ══════════════════════════════════════════════
# Staging: fetch the tag, extract it, validate compose
# ══════════════════════════════════════════════
stage_release() {
  local tag="v$M_VERSION" local_commit
  log "fetching $tag from $RELEASE_GIT_URL"
  if ! git -C "$EQEMU_DIR" fetch -q --no-tags "$RELEASE_GIT_URL" "refs/tags/$tag:refs/tags/$tag" 2>"$TMP/git.err"; then
    sed 's/^/  git: /' "$TMP/git.err" | tail -n 3
    finish failed "$E_VERIFY" "could not fetch tag $tag (a local tag with different content would also fail here)"
  fi
  local_commit="$(git -C "$EQEMU_DIR" rev-parse "$tag^{commit}")"
  if [ "$local_commit" != "$M_COMPOSE_COMMIT" ]; then
    finish failed "$E_VERIFY" "tag $tag is $local_commit but the signed manifest says $M_COMPOSE_COMMIT"
  fi
  TAG_COMMIT="$local_commit"

  STAGE="$EQEMU_DIR/.deploy-stage"
  rm -rf "$STAGE"; mkdir -m 700 "$STAGE"; mkdir "$STAGE/tree"
  git -C "$EQEMU_DIR" archive --format=tar "$TAG_COMMIT" | tar -x -C "$STAGE/tree"

  local f
  for f in "${M_MIGRATIONS[@]}"; do
    [ -f "$STAGE/tree/web/migrations/$f" ] || finish failed "$E_VERIFY" "migration $f listed in release.json is missing from $tag"
  done

  # Validate the release's compose with this node's .env + the new pins (+ local override).
  write_versions_file "$STAGE/versions.env.new"
  (umask 077; render_env_with_pins "$EQEMU_DIR/.env" "$STAGE/versions.env.new" >"$STAGE/tree/.env")
  for f in docker-compose.override.yml docker-compose.override.yaml; do
    if [ -f "$EQEMU_DIR/$f" ]; then cp -p "$EQEMU_DIR/$f" "$STAGE/tree/$f"; fi
  done
  if ! (cd "$STAGE/tree" && docker compose --project-directory "$STAGE/tree" config -q) 2>"$TMP/compose.err"; then
    sed 's/^/  compose: /' "$TMP/compose.err" | tail -n 5
    finish failed "$E_FAIL" "docker compose config fails for $tag with this node's .env; nothing was changed"
  fi
  log "staged $tag: docker compose config ok"

  # Files to swap: everything tracked in the tag except operator-owned paths.
  git -C "$EQEMU_DIR" ls-tree -r --name-only "$TAG_COMMIT" | grep -Ev "$PROTECTED_RE" >"$STAGE/target.list" || true
  : >"$STAGE/delete.list"
  if [ -n "$PREV_COMMIT" ]; then
    git -C "$EQEMU_DIR" diff --no-renames --name-only --diff-filter=D "$PREV_COMMIT" "$TAG_COMMIT" \
      | grep -Ev "$PROTECTED_RE" >"$STAGE/delete.list" || true
  fi
  # Tracked placeholders inside operator-owned paths (e.g. state/.gitkeep) are
  # created when missing, so the checkout stays clean, but never overwritten.
  git -C "$EQEMU_DIR" ls-tree -r --name-only "$TAG_COMMIT" | grep -E "$PROTECTED_RE"     | grep -Ev '^(\.env|loginserver/login\.json$|nginx/conf\.d/default\.conf$|\.git/)'     | while IFS= read -r f; do
        [ -e "$EQEMU_DIR/$f" ] || [ -L "$EQEMU_DIR/$f" ] || echo "$f"
      done >>"$STAGE/target.list" || true
  : >"$STAGE/changed.list"
  while IFS= read -r f; do
    if [ ! -e "$EQEMU_DIR/$f" ] && [ ! -L "$EQEMU_DIR/$f" ]; then echo "$f" >>"$STAGE/changed.list"
    elif ! cmp -s "$STAGE/tree/$f" "$EQEMU_DIR/$f" || [ "$(stat -c %a "$STAGE/tree/$f")" != "$(stat -c %a "$EQEMU_DIR/$f")" ]; then
      echo "$f" >>"$STAGE/changed.list"
    fi
  done <"$STAGE/target.list"
  # Writability: parent directories must be writable by us (files are replaced by rename).
  local d unwritable=""
  while IFS= read -r f; do
    d="$(dirname "$EQEMU_DIR/$f")"
    while [ ! -d "$d" ]; do d="$(dirname "$d")"; done
    [ -w "$d" ] || unwritable="$unwritable ${d#"$EQEMU_DIR"/}"
  done < <(cat "$STAGE/changed.list" "$STAGE/delete.list")
  if [ -n "$unwritable" ]; then
    finish needs_operator "$E_PREFLIGHT" "not writable by $(id -un):$(echo "$unwritable" | tr ' ' '\n' | sort -u | tr '\n' ' ')(sudo chown -R $(id -un) $EQEMU_DIR)"
  fi
  local modified
  modified="$(git -C "$EQEMU_DIR" status --porcelain --untracked-files=no 2>/dev/null | awk '{print $2}' | grep -Ev "$PROTECTED_RE" | tr '\n' ' ' || true)"
  [ -z "$modified" ] || warn "locally modified tracked files will be replaced (copies kept in the snapshot): $modified"
  log "config: $(wc -l <"$STAGE/changed.list") file(s) to update, $(wc -l <"$STAGE/delete.list") to remove"
}

# ══════════════════════════════════════════════
# versions.env and the .env pin block
# ══════════════════════════════════════════════
write_versions_file() { # OUT — from the loaded manifest
  cat >"$1" <<EOF
# Written by scripts/deploy.sh from the signed release.json of v$M_VERSION
# on $(now_iso). Do not edit; see UPGRADING.md.
EQEMU_VERSION=$M_VERSION
EQEMU_SCHEMA_VERSION=$M_SCHEMA_VERSION
WEB_IMAGE=$M_IMG_WEB
LOGINSERVER_IMAGE=$M_IMG_LS
UPGRADE_AGENT_IMAGE=$M_IMG_AGENT
EOF
}

# ENV_FILE VERSIONS_FILE -> stdout: ENV_FILE without its pin block, plus a new
# pin block built from VERSIONS_FILE.
render_env_with_pins() {
  local k v
  awk -v b="$PIN_BEGIN" -v e="$PIN_END" '$0 == b {skip=1; next} $0 == e {skip=0; next} !skip' "$1"
  [ -f "$2" ] || return 0
  echo "$PIN_BEGIN"
  for k in "${PIN_KEYS[@]}"; do
    v="$(kv_get "$2" "$k")"
    [ -n "$v" ] && echo "$k=$v"
  done
  echo "$PIN_END"
}

apply_pins() { # VERSIONS_FILE -> versions.env + .env pin block (atomic, mode preserved)
  local src="$1" tmp="$EQEMU_DIR/.env.deploy-tmp.$$"
  if [ "$src" != "$VERSIONS_FILE" ]; then install_file "$src" "$VERSIONS_FILE"; fi
  (umask 077; cp -p "$EQEMU_DIR/.env" "$tmp"; render_env_with_pins "$EQEMU_DIR/.env" "$VERSIONS_FILE" >"$tmp")
  mv -f "$tmp" "$EQEMU_DIR/.env"
}

backfill_env() {
  local e k v added=0
  for e in "${M_ENV_KEYS[@]}"; do
    k="${e%%=*}"; if [[ "$e" == *=* ]]; then v="${e#*=}"; else v=""; fi
    [[ " ${PIN_KEYS[*]} " == *" $k "* ]] && continue
    grep -qE "^[[:space:]]*${k}[[:space:]]*=" "$EQEMU_DIR/.env" && continue
    if [ "$DRY_RUN" = 1 ]; then plan "append $k= to .env"; continue; fi
    [ "$added" = 1 ] || printf '\n# Added by scripts/deploy.sh for v%s (%s)\n' "$M_VERSION" "$(now_iso)" >>"$EQEMU_DIR/.env"
    printf '%s=%s\n' "$k" "$v" >>"$EQEMU_DIR/.env"
    added=1
    log ".env: added $k (default: ${v:-empty})"
  done
}

# ══════════════════════════════════════════════
# Snapshot / config swap / nginx
# ══════════════════════════════════════════════
take_snapshot() {
  local ts; ts="$(date -u +%Y%m%dT%H%M%SZ)"
  SNAP="$SNAP_ROOT/$ts-${CUR_VERSION}-to-${M_VERSION}"
  mkdir -p "$SNAP_ROOT"
  mkdir -m 700 "$SNAP"
  ln -sfn "$SNAP" "$SNAP_ROOT/last"

  # 1. DB dump (consistent InnoDB snapshot, root password read inside the container).
  local dump
  dump="$BACKUP_DIR/pre-upgrade-${CUR_VERSION}-to-${M_VERSION}-$ts.sql.gz"
  log "snapshot: database dump -> $dump"
  if ! (umask 077
        # shellcheck disable=SC2016 # expanded inside the container
        docker exec eqemu-mariadb sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb-dump -uroot \
          --single-transaction --quick --routines --events --triggers --databases "$MARIADB_DATABASE"' | gzip >"$dump") \
     || ! gunzip -c "$dump" | tail -n 1 | grep -q 'Dump completed'; then
    rm -f "$dump"
    finish failed "$E_FAIL" "pre-upgrade dump failed or is incomplete; nothing was changed"
  fi
  # shellcheck disable=SC2012 # names are ours, no odd characters
  ls -1t "$BACKUP_DIR"/pre-upgrade-*.sql.gz 2>/dev/null | tail -n +$((CF_KEEP_BACKUPS + 1)) | xargs -r rm -f || true

  # 2. Running images -> :previous (kept by housekeeping), versions.env -> versions.env.previous.
  local s id
  for s in "${SERVICES[@]}"; do
    id="$(docker inspect -f '{{.Image}}' "eqemu-$s" 2>/dev/null || true)"
    if [ -n "$id" ]; then docker tag "$id" "${IMAGE_PREFIX}$s:previous"; else warn "eqemu-$s not running; no :previous image for it"; fi
  done
  if [ -f "$VERSIONS_FILE" ]; then
    cp -p "$VERSIONS_FILE" "$VERSIONS_PREV"
  else
    cat >"$VERSIONS_PREV" <<EOF
# Synthesised by scripts/deploy.sh on $(now_iso): first managed upgrade, the
# node ran unpinned images before. Rollback uses the local :previous tags.
EQEMU_VERSION=$CUR_VERSION
WEB_IMAGE=${IMAGE_PREFIX}web:previous
LOGINSERVER_IMAGE=${IMAGE_PREFIX}loginserver:previous
UPGRADE_AGENT_IMAGE=${IMAGE_PREFIX}upgrade-agent:previous
EOF
  fi
  cp -p "$VERSIONS_PREV" "$SNAP/versions.env.previous"
  (umask 077; cp -p "$EQEMU_DIR/.env" "$SNAP/env.before")
  {
    echo "CUR_VERSION=$CUR_VERSION"; echo "TARGET_VERSION=$M_VERSION"
    echo "PREV_COMMIT=$PREV_COMMIT"; echo "PREV_HEAD_REF=$PREV_HEAD_REF"
    echo "SCHEMA_VERSION=$M_SCHEMA_VERSION"
    echo "DUMP=$dump"
  } >"$SNAP/meta"
}

swap_config() {
  local f
  # Keep the current copies of everything we replace or remove, and remember what is new.
  : >"$SNAP/created.list"
  : >"$SNAP/replaced.list"
  while IFS= read -r f; do
    if [ -e "$EQEMU_DIR/$f" ] || [ -L "$EQEMU_DIR/$f" ]; then echo "$f" >>"$SNAP/replaced.list"; else echo "$f" >>"$SNAP/created.list"; fi
  done < <(cat "$STAGE/changed.list" "$STAGE/delete.list")
  if [ -s "$SNAP/replaced.list" ]; then
    tar -C "$EQEMU_DIR" -cf "$SNAP/config.tar" -T "$SNAP/replaced.list"
  fi
  CONFIG_SWAPPED=1
  while IFS= read -r f; do install_file "$STAGE/tree/$f" "$EQEMU_DIR/$f"; done <"$STAGE/changed.list"
  while IFS= read -r f; do rm -f "$EQEMU_DIR/$f"; done <"$STAGE/delete.list"
  # Point git at the tag without touching the work tree (HEAD detached at vX.Y.Z).
  git -C "$EQEMU_DIR" update-ref --no-deref HEAD "$TAG_COMMIT"
  git -C "$EQEMU_DIR" reset -q
  log "config: tracked files now match v$M_VERSION"
}

restore_config() { # from $SNAP (used by rollback)
  local f
  if [ -f "$SNAP/created.list" ]; then
    while IFS= read -r f; do if [ -n "$f" ]; then rm -f "$EQEMU_DIR/$f"; fi; done <"$SNAP/created.list"
  fi
  if [ -f "$SNAP/config.tar" ]; then
    rm -rf "$SNAP/restore"; mkdir -p "$SNAP/restore"
    tar -C "$SNAP/restore" -xf "$SNAP/config.tar"
    while IFS= read -r f; do install_file "$SNAP/restore/$f" "$EQEMU_DIR/$f"; done <"$SNAP/replaced.list"
    rm -rf "$SNAP/restore"
  fi
  local pc pr
  pc="$(kv_get "$SNAP/meta" PREV_COMMIT)"; pr="$(kv_get "$SNAP/meta" PREV_HEAD_REF)"
  if [ -n "$pr" ]; then
    git -C "$EQEMU_DIR" symbolic-ref HEAD "$pr" && git -C "$EQEMU_DIR" reset -q
  elif [ -n "$pc" ]; then
    git -C "$EQEMU_DIR" update-ref --no-deref HEAD "$pc" && git -C "$EQEMU_DIR" reset -q
  fi
}

render_nginx() {
  local tmpl="$EQEMU_DIR/nginx/default.conf.template" conf="$EQEMU_DIR/nginx/conf.d/default.conf" domain
  local changed=1
  if [ -n "$PREV_COMMIT" ] && [ -f "$conf" ] && git -C "$EQEMU_DIR" diff --quiet "$PREV_COMMIT" "$TAG_COMMIT" -- nginx/default.conf.template 2>/dev/null; then
    changed=0
  fi
  if [ "$changed" = 0 ]; then log "nginx: template unchanged, keeping nginx/conf.d/default.conf"; return 0; fi
  domain="$(kv_get "$EQEMU_DIR/.env" DOMAIN)"
  [[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || { log "nginx: DOMAIN in .env is missing or invalid"; return 1; }
  if [ "$DRY_RUN" = 1 ]; then plan "re-render nginx/conf.d/default.conf from the template for $domain"; return 0; fi
  # Same substitution setup.sh applies to its nginx template: placeholder -> DOMAIN.
  sed "s/__DOMAIN__/${domain}/g" "$tmpl" >"$STAGE/default.conf"
  chmod 644 "$STAGE/default.conf"
  if [ -f "$conf" ] && cmp -s "$conf" "$STAGE/default.conf"; then log "nginx: rendered config identical"; return 0; fi
  if [ -f "$conf" ]; then
    cp -p "$conf" "$SNAP/nginx-default.conf"
    cp -p "$conf" "$conf.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  NGINX_CHANGED=1
  install_file "$STAGE/default.conf" "$conf"
  log "nginx: re-rendered nginx/conf.d/default.conf for $domain (backup kept)"
}

# ══════════════════════════════════════════════
# Migrations (schema_migrations: filename, checksum, applied_at)
# ══════════════════════════════════════════════
# "sha256  filename" lines on stdin -> INSERTs marking them applied (only
# well-formed names and checksums; existing rows keep their applied_at).
bootstrap_sql() {
  awk '$2 ~ /^[A-Za-z0-9._-]+\.sql$/ && $1 ~ /^[0-9a-f]{64}$/ {
    printf "INSERT INTO schema_migrations (filename, checksum) VALUES (\047%s\047, \047%s\047) ON DUPLICATE KEY UPDATE checksum = COALESCE(checksum, VALUES(checksum));\n", $2, $1 }'
}

migration_verify_queries() { # FILE (in the staged tag) -> its "-- verify: <SQL>" lines
  local p="$STAGE/tree/web/migrations/$1"
  [ -f "$p" ] || return 0
  sed -n 's/^--[[:space:]]*verify:[[:space:]]*//p' "$p"
}

# Nodes from before 1.7 have no reliable record of which migrations ran: the old
# agent applied them and ignored errors. A migration of the running version is
# only marked applied if every "-- verify:" query in it returns a non-zero value.
# Files without a verify line are trusted and logged. Anything left unproven is
# applied by the normal loop, which stops on the first error. Rows that already
# exist in schema_migrations are kept as they are.
bootstrap_migrations() { # HAS_TABLE HAS_SUM; sets BOOT_APPLIED for --dry-run
  local has_table="$1" has_sum="$2" cur_list="" existing="" f sum q v ok rows="" marked=0 trusted=0
  local left=()
  cur_list="$(docker exec eqemu-web sh -c 'cd /app/migrations 2>/dev/null && sha256sum -- *.sql' 2>/dev/null || true)"
  if [ -z "$cur_list" ] && [ -n "$PREV_COMMIT" ]; then
    while IFS= read -r f; do
      cur_list+="$(git -C "$EQEMU_DIR" show "$PREV_COMMIT:web/migrations/$f" | sha256sum | cut -d' ' -f1)  $f"$'\n'
    done < <(git -C "$EQEMU_DIR" ls-tree --name-only "$PREV_COMMIT" web/migrations/ 2>/dev/null | sed 's|^web/migrations/||' | grep '\.sql$')
  fi
  [ -n "$cur_list" ] || { MIG_ERR="cannot list the migrations of the running version to bootstrap schema_migrations"; return 1; }

  if [ "$has_table" = 1 ]; then
    existing="$(db_query "SELECT filename FROM schema_migrations")" \
      || { MIG_ERR="cannot read existing schema_migrations rows"; return 1; }
  fi

  while read -r sum f; do
    [[ "$f" =~ ^[A-Za-z0-9._-]+\.sql$ && "$sum" =~ ^[0-9a-f]{64}$ ]] || continue
    if [ -n "$existing" ] && printf '%s\n' "$existing" | grep -qxF -- "$f"; then continue; fi
    ok=1 q=""
    while IFS= read -r q; do
      [ -n "$q" ] || continue
      v="$(db_query "$q")" || { MIG_ERR="verify query for $f failed"; return 1; }
      case "$v" in '' | 0 | NULL) ok=0 ;; esac
    done < <(migration_verify_queries "$f")
    if [ "$ok" = 0 ]; then left+=("$f"); continue; fi
    # Record the checksum of the release's copy when it has one, so a file that
    # only gained a verify line is not reported as edited.
    [ -f "$STAGE/tree/web/migrations/$f" ] && sum="$(sha256sum "$STAGE/tree/web/migrations/$f" | cut -d' ' -f1)"
    rows+="$sum  $f"$'\n'
    marked=$((marked + 1))
    [ -n "$(migration_verify_queries "$f")" ] || trusted=$((trusted + 1))
  done <<<"$cur_list"

  log "migrations: bootstrapping schema_migrations from $CUR_VERSION: $marked marked applied ($trusted without a verify check), ${#left[@]} left to apply${left[*]:+: ${left[*]}}"
  if [ "$DRY_RUN" = 1 ]; then
    plan "create/extend schema_migrations and mark $marked migration(s) of $CUR_VERSION as applied"
    BOOT_APPLIED="$(printf '%s\n' "$existing" | awk 'NF {print $1"\t"}')"$'\n'"$(printf '%s' "$rows" | awk 'NF {print $2"\t"$1}')"
    return 0
  fi
  {
    echo "CREATE TABLE IF NOT EXISTS schema_migrations (filename VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NULL, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP);"
    if [ "$has_table" = 1 ] && [ "$has_sum" = 0 ]; then
      echo "ALTER TABLE schema_migrations ADD COLUMN checksum CHAR(64) NULL AFTER filename;"
    fi
    printf '%s' "$rows" | bootstrap_sql
  } | db_exec || { MIG_ERR="bootstrapping schema_migrations failed"; return 1; }
}

migrate() { # applies M_MIGRATIONS from the staged tag; returns non-zero on the first error
  # Runs inside `if !`, where set -e is off: every database read is checked so a
  # failed probe can never be mistaken for "nothing applied yet".
  local has_table has_sum
  BOOT_APPLIED=""
  has_table="$(db_query "SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema=DATABASE() AND table_name='schema_migrations'")" \
    || { MIG_ERR="cannot query information_schema for schema_migrations"; return 1; }
  has_sum="$(db_query "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE table_schema=DATABASE() AND table_name='schema_migrations' AND column_name='checksum'")" \
    || { MIG_ERR="cannot query information_schema for schema_migrations.checksum"; return 1; }
  case "$has_table:$has_sum" in
    0:0 | 1:0 | 1:1) ;;
    *) MIG_ERR="unexpected schema_migrations probe result [$has_table/$has_sum]"; return 1 ;;
  esac
  if [ "$has_table" = 0 ] || [ "$has_sum" = 0 ]; then
    bootstrap_migrations "$has_table" "$has_sum" || return 1
  fi

  local applied f sum rec n=0
  if [ "$DRY_RUN" = 1 ] && [ "$has_sum" = 0 ]; then
    applied="$BOOT_APPLIED"
  else
    applied="$(db_query "SELECT filename, IFNULL(checksum,'') FROM schema_migrations")" \
      || { MIG_ERR="cannot read schema_migrations"; return 1; }
  fi
  for f in "${M_MIGRATIONS[@]}"; do
    sum="$(sha256sum "$STAGE/tree/web/migrations/$f" | cut -d' ' -f1)"
    rec="$(printf '%s\n' "$applied" | awk -F'\t' -v f="$f" '$1 == f {print ($2 == "" ? "-" : $2); exit}')"
    if [ -n "$rec" ]; then
      if [ "$rec" = "-" ]; then
        [ "$DRY_RUN" = 1 ] || db_query "UPDATE schema_migrations SET checksum='$sum' WHERE filename='$f' AND checksum IS NULL" \
          || { MIG_ERR="cannot record checksum for $f"; return 1; }
      elif [ "$rec" != "$sum" ]; then
        warn "migration $f was applied with checksum ${rec:0:12}, release has ${sum:0:12} (edited after release?) — not re-applied"
      fi
      continue
    fi
    if [ "$DRY_RUN" = 1 ]; then plan "apply migration $f"; n=$((n + 1)); continue; fi
    log "migrations: applying $f"
    if ! db_exec <"$STAGE/tree/web/migrations/$f" >"$TMP/mig.out" 2>&1; then
      sed 's/^/  sql: /' "$TMP/mig.out" | tail -n 5
      MIG_ERR="migration $f failed"
      return 1
    fi
    db_query "INSERT INTO schema_migrations (filename, checksum) VALUES ('$f', '$sum')" \
      || { MIG_ERR="migration $f applied but could not be recorded in schema_migrations"; return 1; }
    n=$((n + 1))
  done
  if [ "$DRY_RUN" = 1 ]; then log "migrations: $n would be applied"; else log "migrations: $n applied"; fi
  ST_SCHEMA="$M_SCHEMA_VERSION"
  return 0
}

# ══════════════════════════════════════════════
# Restart / rollback
# ══════════════════════════════════════════════
compose_up_ordered() { # everything except loginserver, then loginserver
  local svcs=() s
  while IFS= read -r s; do [ "$s" = loginserver ] || svcs+=("$s"); done < <(compose config --services)
  compose up -d --remove-orphans "${svcs[@]}"
  compose up -d loginserver
}

pull_and_verify_images() {
  local ref rev ver
  for ref in "$M_IMG_WEB" "$M_IMG_LS" "$M_IMG_AGENT"; do
    log "verifying signature of $ref"
    if ! cosign_run verify --certificate-identity-regexp "$CERT_IDENTITY_RE" \
          --certificate-oidc-issuer "$CERT_OIDC_ISSUER" "$ref" >/dev/null 2>"$TMP/cosign.log"; then
      sed 's/^/  cosign: /' "$TMP/cosign.log" | tail -n 5
      finish failed "$E_VERIFY" "image signature verification FAILED for $ref"
    fi
    if [ "$DRY_RUN" = 1 ]; then plan "pull $ref"; continue; fi
    docker pull -q "$ref" >/dev/null || finish failed "$E_FAIL" "pull of $ref failed; nothing was changed"
    rev="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref" 2>/dev/null || true)"
    ver="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$ref" 2>/dev/null || true)"
    if [ -n "$rev" ] && [ "$rev" != "$M_COMPOSE_COMMIT" ]; then finish failed "$E_VERIFY" "$ref was built from $rev, manifest says $M_COMPOSE_COMMIT"; fi
    if [ -n "$ver" ] && [ "$ver" != "$M_VERSION" ]; then finish failed "$E_VERIFY" "$ref is labelled $ver, manifest says $M_VERSION"; fi
  done
  # Other images the release's compose uses (mariadb, nginx, ...): fetch only if missing, anonymously.
  if [ "$DRY_RUN" = 0 ]; then
    local img
    while IFS= read -r img; do
      [ -n "$img" ] || continue
      docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img" >/dev/null || finish failed "$E_FAIL" "pull of $img failed"
    done < <(cd "$STAGE/tree" || exit 0; docker compose --project-directory "$STAGE/tree" config --images 2>/dev/null | grep -v "^${IMAGE_PREFIX}" || true)
  fi
}

# Restore versions.env.previous (falling back to :previous tags for any digest
# no longer present locally), tracked files and nginx config.
rollback_changes() { # REASON -> 0 if the node is back and healthy
  ROLLING_BACK=1
  set +e
  log "ROLLBACK: $1"
  if [ -z "$SNAP" ] || [ ! -d "$SNAP" ]; then log "rollback: no snapshot"; return 1; fi
  local prevv="$SNAP/versions.env.previous" k v s
  if [ -f "$prevv" ]; then
    cp -p "$prevv" "$SNAP/versions.env.rollback"
    for s in "${SERVICES[@]}"; do
      k="$(echo "$s" | tr 'a-z-' 'A-Z_')_IMAGE"
      v="$(kv_get "$prevv" "$k")"
      if [ -n "$v" ] && ! docker image inspect "$v" >/dev/null 2>&1; then
        warn "rollback: $v not present locally, using ${IMAGE_PREFIX}$s:previous"
        sed -i "s|^$k=.*|$k=${IMAGE_PREFIX}$s:previous|" "$SNAP/versions.env.rollback"
      fi
    done
    apply_pins "$SNAP/versions.env.rollback"
  fi
  if [ "$CONFIG_SWAPPED" = 1 ] || [ "$MODE" = rollback ]; then restore_config; fi
  if [ -f "$SNAP/nginx-default.conf" ] && { [ "$NGINX_CHANGED" = 1 ] || [ "$MODE" = rollback ]; }; then
    install_file "$SNAP/nginx-default.conf" "$EQEMU_DIR/nginx/conf.d/default.conf"
  fi
  ST_VERSION="$(kv_get "$SNAP/meta" CUR_VERSION)"
  # A restored pre-1.7 compose file hardcodes :latest and ignores the pins, so
  # point :latest at the :previous images as well. Pinned compose files are
  # unaffected by this.
  for s in "${SERVICES[@]}"; do
    if docker image inspect "${IMAGE_PREFIX}$s:previous" >/dev/null 2>&1; then
      docker tag "${IMAGE_PREFIX}$s:previous" "${IMAGE_PREFIX}$s:latest" || warn "rollback: could not tag $s:previous as :latest"
    fi
  done
  if [ "$RESTARTED" = 1 ] || [ "$MODE" = rollback ]; then
    RESTART_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    compose_up_ordered || { log "rollback: compose up failed"; return 1; }
    run_gates 60 "" || { log "rollback: gates failed: $HEALTH_ERR"; return 1; }
  fi
  log "rollback complete: node is back on ${ST_VERSION:-the previous version}"
  return 0
}

# ══════════════════════════════════════════════
# Modes
# ══════════════════════════════════════════════
do_rollback_mode() {
  local last="$SNAP_ROOT/last"
  if [ ! -L "$last" ] || [ ! -d "$last" ]; then finish needs_operator "$E_PREFLIGHT" "no snapshot found in $SNAP_ROOT"; fi
  SNAP="$(readlink -f "$last")"
  local from to
  from="$(kv_get "$SNAP/meta" TARGET_VERSION)"; to="$(kv_get "$SNAP/meta" CUR_VERSION)"
  log "rollback: snapshot $SNAP ($from -> back to $to)"
  if [ "$DRY_RUN" = 1 ]; then
    plan "restore versions.env from $SNAP/versions.env.previous and the .env pin block"
    [ -f "$SNAP/config.tar" ] && plan "restore $(wc -l <"$SNAP/replaced.list") tracked file(s), remove $(wc -l <"$SNAP/created.list") new file(s)"
    [ -f "$SNAP/nginx-default.conf" ] && plan "restore nginx/conf.d/default.conf"
    plan "docker compose up -d --remove-orphans (loginserver last), then health gates"
    finish ok "$E_OK" "dry-run complete"
  fi
  CHANGED=1; ST_PREV_VERSION="$from"
  if rollback_changes "requested by operator"; then
    echo "$from" >"$BLOCKED_FILE"
    finish rolled_back "$E_OK" "rolled back from $from to $to on request"
  fi
  finish needs_operator "$E_NEEDS_OPERATOR" "manual rollback failed: $HEALTH_ERR"
}

main() {
  # ── Arguments ──
  while [ $# -gt 0 ]; do
    case "$1" in
      --auto) MODE=auto ;;
      --rollback) MODE=rollback ;;
      --now) OPT_NOW=1 ;;
      --allow-downgrade) OPT_DOWNGRADE=1 ;;
      --test-rollback) OPT_TEST_ROLLBACK=1 ;;
      --dry-run) DRY_RUN=1 ;;
      --skip-health-precheck) SKIP_PRECHECK=1 ;;
      -h|--help) usage ;;
      -*) echo "unknown option $1" >&2; usage ;;
      *) [ -z "$REQ_VERSION" ] || usage; REQ_VERSION="${1#v}"; MODE="${MODE:-manual}" ;;
    esac
    shift
  done
  [ -n "$MODE" ] || usage
  if [ "$MODE" = manual ]; then is_semver "$REQ_VERSION" || { echo "version must be X.Y.Z" >&2; exit "$E_USAGE"; }; fi
  if [ "$MODE" != manual ] && [ -n "$REQ_VERSION" ]; then usage; fi
  if [ "$MODE" = auto ] && [ "$SKIP_PRECHECK" = 1 ]; then echo "--skip-health-precheck is for manual runs" >&2; exit "$E_USAGE"; fi
  if [ "$MODE" != manual ] && [ "$OPT_TEST_ROLLBACK" = 1 ]; then echo "--test-rollback is for manual runs" >&2; exit "$E_USAGE"; fi
  if [ "$(id -u)" = 0 ]; then echo "run deploy.sh as the operator user (docker group), not root" >&2; exit "$E_USAGE"; fi

  preflight_tools
  [ -d "$EQEMU_DIR" ] || { echo "$EQEMU_DIR does not exist (set EQEMU_DIR)" >&2; exit "$E_USAGE"; }
  TMP="$(mktemp -d)"; chmod 700 "$TMP"
  trap on_exit EXIT
  load_conf

  # ── Lock (one run at a time; the timer simply skips a busy slot) ──
  exec 9>>"$LOCK_FILE" || { echo "cannot open $LOCK_FILE" >&2; exit "$E_PREFLIGHT"; }
  if ! flock -n 9; then FINALIZED=1; log "another deploy.sh holds $LOCK_FILE; exiting"; exit "$E_LOCKED"; fi

  setup_docker_env
  [ "$DRY_RUN" = 1 ] && log "DRY RUN: checks only, nothing will be changed"
  detect_current
  log "node: $EQEMU_DIR, running ${CUR_VERSION:-unknown} (from $CUR_SOURCE), channel=$CF_CHANNEL auto=$CF_AUTO window=\"$CF_WINDOW\" max_jump=$CF_MAX_JUMP"

  if [ "$MODE" = rollback ]; then do_rollback_mode; fi
  [ -n "$CUR_VERSION" ] || finish needs_operator "$E_PREFLIGHT" "cannot determine the running version (no versions.env, no image label, no git tag)"

  # ── 1a. Decide the target from signed manifests ──
  local target
  if [ "$MODE" = auto ]; then
    get_verified_manifest latest
    local latest="$M_VERSION" desired=""
    desired="$(master_desired_version)"
    target="$latest"
    if [ -n "$desired" ]; then
      log "master publishes desired_version_stable=$desired (advisory; signed latest is $latest)"
      ver_lt "$desired" "$latest" && target="$desired"
    fi
    if ! ver_gt "$target" "$CUR_VERSION"; then
      ST_PENDING=""
      finish up_to_date "$E_OK" "running $CUR_VERSION, target $target"
    fi
    [ "$target" = "$latest" ] || get_verified_manifest "$target"
    ST_PENDING="$target"
    if [ "$FIRST_RUN" = 1 ]; then
      finish needs_operator "$E_POLICY" "$target available, but this node has no versions.env yet: run 'scripts/deploy.sh $target' by hand once (UPGRADING.md)"
    fi
    if [ -f "$BLOCKED_FILE" ] && [ "$(tr -d '[:space:]' <"$BLOCKED_FILE")" = "$target" ]; then
      report_pending "$target failed or was rolled back on this node before; not retrying automatically (run 'scripts/deploy.sh $target' by hand)"
    fi
    if [ "$CF_AUTO" != true ]; then
      report_pending "update $CUR_VERSION -> $target available; auto=false, not installing"
    fi
    if ! jump_allowed "$CUR_VERSION" "$target"; then
      finish needs_operator "$E_POLICY" "$CUR_VERSION -> $target exceeds max_jump=$CF_MAX_JUMP; upgrade by hand"
    fi
    if [ "$OPT_NOW" = 0 ] && ! in_window "$CF_WINDOW"; then
      report_pending "update $CUR_VERSION -> $target pending; outside window \"$CF_WINDOW\" UTC"
    fi
  else
    target="$REQ_VERSION"
    get_verified_manifest "$target"
    ST_PENDING="$target"
    jump_allowed "$CUR_VERSION" "$target" || warn "$CUR_VERSION -> $target exceeds max_jump=$CF_MAX_JUMP (manual run: continuing)"
  fi

  # ── 1b. Version policy ──
  local highest=""
  [ -f "$HIGHEST_FILE" ] && highest="$(tr -d '[:space:]' <"$HIGHEST_FILE")"
  is_semver "$highest" || highest="$CUR_VERSION"
  if [ "$target" = "$CUR_VERSION" ] && [ "$FIRST_RUN" = 0 ] && [ "$MODE" = manual ]; then
    log "re-installing $target (same version): config, migrations and images are re-checked"
  fi
  if ver_lt "$target" "$CUR_VERSION" || ver_lt "$target" "$highest"; then
    if [ "$OPT_DOWNGRADE" = 0 ]; then
      finish needs_operator "$E_POLICY" "$target is below the running ($CUR_VERSION) or highest installed ($highest) version; use --allow-downgrade"
    fi
    warn "downgrade to $target allowed by --allow-downgrade (the database stays migrated)"
  fi
  if ver_lt "$CUR_VERSION" "$M_MIN_FROM"; then
    finish needs_operator "$E_POLICY" "$target requires at least $M_MIN_FROM; this node runs $CUR_VERSION. Upgrade to an intermediate release first."
  fi

  # ── 1c. Pre-flight + staging (all checks; nothing changed yet) ──
  preflight
  stage_release

  if [ "$DRY_RUN" = 1 ]; then
    plan "upgrade $CUR_VERSION -> $target (commit ${TAG_COMMIT:0:12}, first managed run: $([ "$FIRST_RUN" = 1 ] && echo yes || echo no))"
    plan "dump database to $BACKUP_DIR/pre-upgrade-$CUR_VERSION-to-$target-<ts>.sql.gz; tag running images :previous; save versions.env.previous"
    pull_and_verify_images
    local f
    while IFS= read -r f; do plan "update $f"; done <"$STAGE/changed.list"
    while IFS= read -r f; do plan "remove $f"; done <"$STAGE/delete.list"
    plan "write versions.env (EQEMU_VERSION=$target) and the .env pin block"
    backfill_env
    render_nginx || finish failed "$E_FAIL" "nginx render check failed"
    MIG_ERR=""
    migrate || finish failed "$E_FAIL" "migration check failed: $MIG_ERR"
    plan "docker compose up -d --remove-orphans (loginserver last); gates: web health, nginx -t, UDP ports, heartbeat log, ${CF_SOAK}s soak; rollback on failure"
    finish ok "$E_OK" "dry-run complete: $CUR_VERSION -> $target would proceed"
  fi

  # ── 2. Snapshot ──
  [ "$MODE" = manual ] && rm -f "$BLOCKED_FILE"
  take_snapshot

  # ── 3. Pull by digest + verify ──
  pull_and_verify_images

  # ── 4. Config migration ──
  CHANGED=1
  notify "upgrading $CUR_VERSION -> $target (loginserver restarts last)"
  swap_config
  local newv="$STAGE/versions.env.new"
  apply_pins "$newv"
  backfill_env
  if ! render_nginx; then
    rollback_changes "nginx render failed" && finish rolled_back "$E_ROLLED_BACK" "nginx render failed; config restored"
    finish needs_operator "$E_NEEDS_OPERATOR" "nginx render failed and restoring the config failed"
  fi

  # ── 5. Migrations ──
  MIG_ERR=""
  if ! migrate; then
    echo "$target" >"$BLOCKED_FILE"
    if rollback_changes "$MIG_ERR"; then
      finish needs_operator "$E_NEEDS_OPERATOR" "$MIG_ERR; old version still running, config restored; schema may be partly changed (dump: $(kv_get "$SNAP/meta" DUMP))"
    fi
    finish needs_operator "$E_NEEDS_OPERATOR" "$MIG_ERR and restoring the config failed"
  fi

  # ── 6. Restart ──
  RESTART_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  RESTARTED=1
  log "restart: docker compose up -d --remove-orphans (loginserver last)"
  compose_up_ordered

  # ── 7. Health gates ──
  if run_gates "$CF_SOAK" "$M_SCHEMA_VERSION"; then
    ST_VERSION="$target"; ST_PENDING=""; ST_PREV_VERSION="$CUR_VERSION"
    ver_max "$highest" "$target" >"$HIGHEST_FILE"
    # After a deliberate downgrade, keep the timer from going straight back up.
    if ver_lt "$target" "$CUR_VERSION"; then echo "$CUR_VERSION" >"$BLOCKED_FILE"; fi
    finish ok "$E_OK" "installed $target (was $CUR_VERSION)"
  fi

  # ── 8. Rollback ──
  local why="$HEALTH_ERR"
  echo "$target" >"$BLOCKED_FILE"
  if rollback_changes "gate failed: $why"; then
    ST_PENDING="$target"
    finish rolled_back "$E_ROLLED_BACK" "upgrade to $target failed ($why); rolled back to $CUR_VERSION"
  fi
  finish needs_operator "$E_NEEDS_OPERATOR" "upgrade to $target failed ($why) and the rollback failed: $HEALTH_ERR"
}

# The whole file is parsed before main runs, so replacing scripts/deploy.sh
# during step 4 (it is a tracked file) cannot affect this run. Sourcing the
# file (tests) defines the functions without running anything.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
  # shellcheck disable=SC2317 # main normally exits itself
  exit $?
fi
