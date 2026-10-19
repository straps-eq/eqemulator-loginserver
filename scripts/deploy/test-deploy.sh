#!/bin/bash
# shellcheck source-path=SCRIPTDIR
# shellcheck disable=SC2016,SC2034,SC2317 # globals are read by the sourced functions; date() is called indirectly
# ──────────────────────────────────────────────
# Offline unit tests for scripts/deploy.sh (no docker, no network).
# Sources deploy.sh (which then defines functions only) and checks the pure
# parts: version maths, policy, window, env pin block, manifest validation,
# protected paths, /proc/net/udp parsing, migration bootstrap SQL.
#
#   scripts/deploy/test-deploy.sh      # exit 0 = all passed
# Manifest tests need jq on the host and are skipped without it.
# ──────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/deploy.sh
. "$HERE/../deploy.sh"
set +e

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); }
bad()  { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }
eq()   { if [ "$1" = "$2" ]; then ok; else bad "$3: got '$1', want '$2'"; fi; }
yes()  { if "$@"; then ok; else bad "expected success: $*"; fi; }
no()   { if "$@"; then bad "expected failure: $*"; else ok; fi; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# ── versions ──
eq "$(ver_cmp 1.6.2 1.7.0)" -1 "ver_cmp 1.6.2 1.7.0"
eq "$(ver_cmp 1.10.0 1.9.9)" 1 "ver_cmp 1.10.0 1.9.9"
eq "$(ver_cmp 2.0.0 2.0.0)" 0 "ver_cmp equal"
eq "$(ver_cmp 1.08.0 1.8.0)" 0 "ver_cmp leading zero"
eq "$(ver_max 1.7.0 1.6.9)" 1.7.0 "ver_max"
yes is_semver 1.7.0; no is_semver v1.7.0; no is_semver 1.7; no is_semver "1.7.0-rc1"

CF_MAX_JUMP="minor"; yes jump_allowed 1.6.2 1.9.0; no jump_allowed 1.6.2 2.0.0
CF_MAX_JUMP="patch"; yes jump_allowed 1.6.2 1.6.9; no jump_allowed 1.6.2 1.7.0
CF_MAX_JUMP="major"; yes jump_allowed 1.6.2 3.0.0

# ── window (date is faked) ──
FAKE_HM="0400"; FAKE_DAY="Tue"; FAKE_YDAY="Mon"
date() {
  case "$*" in
    "-u +%H") echo "${FAKE_HM:0:2}" ;;
    "-u +%M") echo "${FAKE_HM:2:2}" ;;
    "-u +%a") echo "$FAKE_DAY" ;;
    "-u -d yesterday +%a") echo "$FAKE_YDAY" ;;
    *) command date "$@" ;;
  esac
}
yes in_window "03:00-05:00"
FAKE_HM="0500"; no in_window "03:00-05:00"
FAKE_HM="0259"; no in_window "03:00-05:00"
FAKE_HM="0400"; yes in_window "Tue,Thu 03:00-05:00"; no in_window "Wed 03:00-05:00"
FAKE_HM="2330"; yes in_window "23:00-01:00"
FAKE_HM="0030"; yes in_window "23:00-01:00"; yes in_window "Mon 23:00-01:00"; no in_window "Tue 23:00-01:00"
no in_window "garbage" >/dev/null
unset -f date

# ── kv_get ──
printf 'A=1\nB="two words"\r\nC='"'"'x'"'"'\n  D = spaced \nA=last\n' >"$T/kv"
eq "$(kv_get "$T/kv" A)" last "kv_get last wins"
eq "$(kv_get "$T/kv" B)" "two words" "kv_get quotes+CRLF"
eq "$(kv_get "$T/kv" C)" x "kv_get single quotes"
eq "$(kv_get "$T/kv" D)" spaced "kv_get spaces"
eq "$(kv_get "$T/kv" NOPE)" "" "kv_get missing"

# ── .env pin block ──
printf 'DOMAIN=example.org\nSECRET=s3cr3t\n' >"$T/env"
printf 'EQEMU_VERSION=1.7.0\nWEB_IMAGE=ghcr.io/straps-eq/eqemu-web@sha256:%064d\nIGNORED=1\n' 0 >"$T/v1"
render_env_with_pins "$T/env" "$T/v1" >"$T/env2"
render_env_with_pins "$T/env2" "$T/v1" >"$T/env3"
yes cmp -s "$T/env2" "$T/env3"
eq "$(grep -c "^$PIN_BEGIN\$" "$T/env3")" 1 "one pin block"
eq "$(kv_get "$T/env3" SECRET)" s3cr3t "other keys kept"
eq "$(grep -c IGNORED "$T/env3")" 0 "only pin keys copied"
printf 'EQEMU_VERSION=1.6.2\n' >"$T/v2"
render_env_with_pins "$T/env3" "$T/v2" >"$T/env4"
eq "$(kv_get "$T/env4" EQEMU_VERSION)" 1.6.2 "pin replaced"
eq "$(grep -c WEB_IMAGE "$T/env4")" 0 "stale pin removed"
render_env_with_pins "$T/env4" "$T/missing" >"$T/env5"
eq "$(grep -c eqemu-updater "$T/env5")" 0 "no versions file -> no block"

# ── protected paths ──
for p in .env .env.backup.123 .env.local loginserver/login.json uploads/x.png mariadb/data/ibdata1 backups/a.sql \
         state/updater-status.json versions.env versions.env.previous updater.conf certbot/conf/x \
         nginx/conf.d/default.conf docker-compose.override.yml; do
  if echo "$p" | grep -Eq "$PROTECTED_RE"; then ok; else bad "should be protected: $p"; fi
done
for p in docker-compose.yml docker-compose.release.yml scripts/deploy.sh nginx/default.conf.template \
         nginx/conf.d/default.conf.example loginserver/login.json.example .env.example web/migrations/001_x.sql; do
  if echo "$p" | grep -Eq "$PROTECTED_RE"; then bad "should be swapped: $p"; else ok; fi
done

# ── /proc/net/udp parsing ──
cat >"$T/udp" <<'EOF'
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
  1: 00000000:176E 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 1 2 0000000000000000 0
  2: 00000000:176F 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 1 2 0000000000000000 0
  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
  3: 00000000000000000000000000000000:3E2C 00000000000000000000000000000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 1 2 0000000000000000 0
EOF
eq "$(parse_udp_ports <"$T/udp")" "5998 5999 15916 " "udp ports"

# ── configured UDP ports (needs jq) ──
if command -v jq >/dev/null; then
  EQEMU_DIR_SAVED="$EQEMU_DIR"; EQEMU_DIR="$T/node"; mkdir -p "$T/node/loginserver"
  printf '{"client_configuration":{"titanium_port":5998,"titanium_opcodes":"a.conf","sod_port":5999,"tob_port":15900,"tob_opcodes":"t.conf","live_port":15901,"live_opcodes":""}}' \
    >"$T/node/loginserver/login.json"
  eq "$(configured_udp_ports)" "15900 5998 5999 " "empty live_opcodes skips live_port"
  sed -i 's/"live_opcodes":""/"live_opcodes":"data\/l.conf"/' "$T/node/loginserver/login.json"
  eq "$(configured_udp_ports)" "15900 15901 5998 5999 " "live_opcodes set keeps live_port"
  EQEMU_DIR="$EQEMU_DIR_SAVED"
fi

# ── migration bootstrap SQL ──
printf '%064d  001_a.sql\nzzz  002_b.sql\n%064d  ../evil.sql\n' 1 2 >"$T/sums"
out="$(bootstrap_sql <"$T/sums")"
eq "$(printf '%s\n' "$out" | grep -c INSERT)" 1 "bootstrap only well-formed rows"
case "$out" in *"'001_a.sql'"*) ok ;; *) bad "bootstrap row for 001_a.sql: $out" ;; esac

# ── manifest validation (needs jq) ──
if command -v jq >/dev/null 2>&1; then
  TMP="$T"; mkdir -p "$T/m"; CF_CHANNEL=stable
  d="$(printf '%064d' 7 | tr 0 a)"
  good() {
    jq -n --arg d "$d" '{version:"1.7.0",channel:"stable",released_at:"2026-10-20T00:00:00Z",
      images:{web:("ghcr.io/straps-eq/eqemu-web@sha256:"+$d),loginserver:("ghcr.io/straps-eq/eqemu-loginserver@sha256:"+$d),"upgrade-agent":("ghcr.io/straps-eq/eqemu-upgrade-agent@sha256:"+$d)},
      compose_ref:"v1.7.0",compose_commit:"0123456789abcdef0123456789abcdef01234567",min_from_version:"1.5.0",
      env_keys_added:["NEW_KEY","OTHER=default value"],migrations:["001_federation_tables.sql","012_x.sql"],
      schema_version:"012_x",notes_url:"https://example.invalid/n"}'
  }
  good >"$T/m/release.json"
  if load_manifest; then
    ok
    eq "$M_VERSION" 1.7.0 "manifest version"
    eq "${#M_MIGRATIONS[@]}" 2 "manifest migrations"
    eq "${M_ENV_KEYS[1]}" "OTHER=default value" "manifest env key with default"
    eq "$M_IMG_LS" "ghcr.io/straps-eq/eqemu-loginserver@sha256:$d" "manifest loginserver ref"
  else
    bad "valid manifest rejected"
  fi
  for mut in '.images.web = "ghcr.io/evil/eqemu-web@sha256:'"$d"'"' \
             '.images.web = "ghcr.io/straps-eq/eqemu-web:latest"' \
             '.compose_ref = "v1.6.0"' '.version = "1.7"' '.channel = "canary"' \
             '.migrations = ["../../etc/passwd"]' '.env_keys_added = ["lower=x"]' \
             '.compose_commit = "main"' '.min_from_version = 1' '.version = "1.7.0$(id)"'; do
    good | jq "$mut" >"$T/m/release.json"
    if load_manifest >/dev/null 2>&1; then bad "manifest accepted after: $mut"; else ok; fi
  done
else
  echo "skip: manifest tests (no jq)"
fi

echo "deploy.sh tests: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
