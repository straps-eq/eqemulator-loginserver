# Upgrading a node

From v1.7.0 every node upgrades itself with `scripts/deploy.sh`, a host script
run by the operator (you), not by the federation master. It installs only
releases whose manifest and images are signed by this repository's release
workflow, takes a database dump first, and rolls back on its own if the node
is not healthy afterwards.

- **Manual:** `scripts/deploy.sh 1.7.2` whenever you choose.
- **Automatic (opt-in):** a cron entry runs `scripts/deploy.sh --auto` every
  15 minutes. It installs new stable releases only if you set `auto=true`,
  only inside your maintenance window, and never across a major version.

Paths below assume the checkout lives in `/opt/eqemu` and the operator user
(for example `straps`) is in the `docker` group. Nothing here needs root or
sudo after the one-time ownership fix.

---

## 1. One-time setup

```bash
cd /opt/eqemu

# 1. Images are public. A stale `docker login ghcr.io` turns pulls into "denied".
docker logout ghcr.io

# 2. Policy file (yours; nothing remote can change it).
cp scripts/deploy/updater.conf.example updater.conf
chmod 600 updater.conf
$EDITOR updater.conf          # channel=stable, auto=false, window, max_jump

# 3. State directory the web app reads (read-only) at /host-state.
mkdir -p state

# 4. Check everything without changing anything.
scripts/deploy.sh 1.7.2 --dry-run

# 5. Timer (user crontab; add --systemd for a systemd --user timer instead).
scripts/deploy/install-timer.sh
```

With `auto=false` (the default) the timer only checks: it records the pending
version in `state/updater-status.json`, which the dashboard shows, and you
upgrade by hand. Set `auto=true` to let it install within the window.

`updater.conf` keys (see the example file for all of them):

| Key | Default | Meaning |
|---|---|---|
| `channel` | `stable` | Release channel. Only `stable` exists today. |
| `auto` | `false` | `true` lets the timer install releases. |
| `window` | `03:00-05:00` | UTC window for automatic installs, optionally with days: `Tue,Thu 03:00-05:00`. |
| `max_jump` | `minor` | Largest automatic jump: `patch`, `minor` (same major) or `major`. Manual runs only warn. |
| `follow_master` | `true` | Also consider the master's advisory desired version (never above the signed latest). |
| `discord_webhook` | — | Post results to Discord. Keep the file `chmod 600`. |
| `backup_dir` | `~/eqemu-backups/pre-upgrade` | Where pre-upgrade dumps go (`/opt/eqemu/backups` is often root-owned). |
| `compose_file` | compose default | Set to `docker-compose.release.yml` if you run that file. |

---

## 2. Manual upgrade

```bash
cd /opt/eqemu
scripts/deploy.sh 1.7.2 --dry-run   # prints the plan, changes nothing
scripts/deploy.sh 1.7.2
```

What it does, in order (stops at the first problem):

1. **Pre-flight.** Takes a lock (`/opt/eqemu/.upgrade.lock`). Downloads
   `release.json` and `release.json.bundle` from the GitHub Release and
   verifies the cosign signature: the certificate must be issued by GitHub
   Actions to `.github/workflows/release.yml` on a `v*` tag of
   `straps-eq/eqemulator-loginserver`. Checks the version policy (no
   downgrade without `--allow-downgrade`, `min_from_version`, `max_jump`),
   disk space, docker, an anonymous registry pull test, database access, and
   that the node is healthy *before* it starts. A sick node is reported as
   `needs_operator` and left alone.
2. **Snapshot.** `mariadb-dump --single-transaction` to
   `~/eqemu-backups/pre-upgrade/pre-upgrade-<from>-to-<to>-<ts>.sql.gz` (last 5
   kept), tags the running images `ghcr.io/straps-eq/eqemu-*:previous`, copies
   `versions.env` to `versions.env.previous`, and stores the files it is about
   to replace under `~/eqemu-updater/snapshots/`.
3. **Pull by digest** (anonymously) and verify each image's signature.
4. **Config.** Fetches the tag from GitHub, checks it is the exact commit the
   signed manifest names, extracts it into a staging directory, validates
   `docker compose config` there with your `.env`, then replaces the tracked
   files in `/opt/eqemu`. Never touched: `.env` (except below), `loginserver/login.json`,
   `uploads/`, `mariadb/data/`, `backups/`, `state/`, `certbot/`, `updater.conf`,
   `docker-compose.override.yml`. New `.env` keys the release needs are
   appended (never overwritten). `nginx/conf.d/default.conf` is re-rendered
   from `nginx/default.conf.template` with your `DOMAIN` only if the template
   changed; the old file is kept as `default.conf.bak-<ts>`.
5. **Migrations.** Applies the release's `web/migrations/*.sql` that are not in
   `schema_migrations` (filename, checksum, applied_at), stopping at the first
   error.
6. **Restart.** `docker compose up -d --remove-orphans`, loginserver last.
7. **Health gates.** Web `/api/health` ok, `nginx -t` + reload, loginserver
   running with every UDP port from `login.json` bound, the web log shows its
   startup line and no database access errors, then a 120 s soak with no
   restarts.
8. **Rollback** if any gate fails: previous `versions.env`, previous images,
   previous tracked files and nginx config, restart, gates again. The
   database stays migrated (migrations are additive by policy).
9. **Report** to `state/updater-status.json` (and Discord if configured).

Exit codes: `0` ok / up to date / pending, `1` failed (nothing changed),
`2` usage, `3` another run in progress, `4` signature or manifest check
failed, `5` refused by policy, `6` pre-flight failed, `7` rolled back,
`8` rollback or migration failed — look at the node now.

The script is safe to re-run. Running it again for the version you are on
re-checks config, migrations and images and changes nothing if all match.

---

## 3. Rolling back

- **Automatic:** see step 8. The failed version is remembered and the timer
  will not retry it; a newer release or a manual run clears that.
- **Undo the last upgrade:** `scripts/deploy.sh --rollback` (add `--dry-run`
  to see what it would restore). Works for the first managed upgrade too,
  using the `:previous` images.
- **Test the automatic rollback:** `scripts/deploy.sh <version> --test-rollback`
  installs the release, then fails the health gates on purpose, so you can watch
  the automatic rollback put the previous version back. Manual runs only.
- **Go to an older signed release:** `scripts/deploy.sh 1.7.0 --allow-downgrade`.
  The timer will not move you back up to the version you left until a newer
  release appears or you upgrade by hand.
- **Database:** rollbacks never touch the database. If a migration must be
  undone, restore the pre-upgrade dump by hand:

  ```bash
  gunzip -c ~/eqemu-backups/pre-upgrade/pre-upgrade-<from>-to-<to>-<ts>.sql.gz \
    | docker exec -i eqemu-mariadb sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot'
  ```

---

## 4. Files

| Path | Written by | Purpose |
|---|---|---|
| `versions.env` | deploy.sh | The installed release: `EQEMU_VERSION`, `EQEMU_SCHEMA_VERSION`, `WEB_IMAGE`, `LOGINSERVER_IMAGE`, `UPGRADE_AGENT_IMAGE` (`ghcr.io/...@sha256:...`). Do not edit. |
| `.env` pin block | deploy.sh | The same keys, mirrored between `# >>> eqemu-updater pins` markers at the end of `.env`. |
| `versions.env.previous` | deploy.sh | What ran before the last upgrade (rollback source). |
| `state/updater-status.json` | deploy.sh | Status for the dashboard (schema below). Mounted read-only into web at `/host-state`. |
| `state/updater-highest-version`, `state/updater-blocked-version` | deploy.sh | Downgrade protection and "do not retry" marker. |
| `updater.conf` | you | Policy. |
| `~/eqemu-updater/updater.log` | timer | Log of `--auto` runs (rotated at 5 MiB). |
| `~/eqemu-updater/snapshots/` | deploy.sh | Replaced files, previous versions.env, `.env` copy (mode 700). |
| `~/eqemu-backups/pre-upgrade/` | deploy.sh | Pre-upgrade database dumps. |

**Why the pins are mirrored into `.env`.** `docker-compose.yml` reads
`image: ${WEB_IMAGE:-ghcr.io/straps-eq/eqemu-web:latest}` (same for
loginserver and upgrade-agent). Compose only reads `.env` by default, and so do
`setup.sh`, the legacy upgrade agent and anyone typing `docker compose up -d`.
If the pins lived only in `versions.env` (passed with `--env-file`), any of
those would silently put the node back on `:latest`. So `versions.env` is the
canonical record and deploy.sh keeps an identical, clearly marked block in
`.env`; it rewrites only that block (atomically, keeping the file mode) and
otherwise only ever appends new keys. Without the block (a node that never ran
deploy.sh) the `:latest` defaults keep the old behaviour.

Local compose changes belong in `docker-compose.override.yml` (picked up by
compose and by deploy.sh's validation); tracked files are replaced on every
upgrade (modified copies are kept in the snapshot and listed in the log).

`state/updater-status.json`:

```json
{
  "version": "1.7.0",
  "previous_version": "1.6.2",
  "channel": "stable",
  "auto": false,
  "last_check_at": "2026-10-20T03:15:02Z",
  "last_result": "ok",
  "last_error": null,
  "pending_version": null,
  "images": {
    "web": "ghcr.io/straps-eq/eqemu-web@sha256:…",
    "loginserver": "ghcr.io/straps-eq/eqemu-loginserver@sha256:…",
    "upgrade-agent": "ghcr.io/straps-eq/eqemu-upgrade-agent@sha256:…"
  },
  "schema_version": "011_unique_account_name_source",
  "updated_at": "2026-10-20T03:17:41Z"
}
```

`last_result` is one of `ok`, `up_to_date`, `failed` (nothing changed),
`rolled_back`, `needs_operator`. A pending update that is not installed (auto
off, outside the window, previously failed) keeps the previous `last_result`
and sets `pending_version`.

---

## 5. What the federation master can and cannot do

| Can | Cannot |
|---|---|
| Publish an advisory desired version; the timer picks it up only if it is signed, not above the latest stable release, and allowed by your `updater.conf`. | Run anything on your node, restart services, or push images, compose files or `.env`. |
| See the version, image digests, schema version and updater status your node reports. | Change your channel, window, `auto` or `max_jump`. |
| Ask you to upgrade. | Name an image digest (only the signed manifest does) or bypass signature checks. |

Owning the GHCR namespace is not enough to get code onto a node either: every
image is checked against the release workflow's signature before it is used.

---

## 6. Moving an existing 1.5.x / 1.6.x node onto deploy.sh (first run)

The first run is always manual. The timer refuses to make a node's first
managed upgrade (`needs_operator`) so that you are watching.

```bash
cd /opt/eqemu

# 0. Healthy now? deploy.sh will not upgrade a sick node.
scripts/validate.sh </dev/null

#    If the web app logs "Access denied for user 'eqemu_web'", .env and the
#    database disagree on passwords (usually .env was regenerated, e.g. by
#    setup.sh --reset, and the containers were later recreated). Check the data
#    is there, then set both application users to the passwords in the current .env:
set -a; . ./.env; set +a
docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" eqemu-mariadb   mariadb -uroot -N -e "SELECT COUNT(*) FROM eqemu_login.login_accounts"
#    (root also denied? the matching passwords are in .env.backup.<timestamp>.
#     A count near zero means the data was re-initialised: stop and restore.)
docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" eqemu-mariadb mariadb -uroot -e "
  ALTER USER 'eqemu_web'@'%' IDENTIFIED BY '$DB_WEB_PASSWORD';
  ALTER USER 'eqemu_ls'@'%'  IDENTIFIED BY '$DB_PASSWORD';
  FLUSH PRIVILEGES;"
docker restart eqemu-web eqemu-loginserver

# 1. The old agent ran as root and may have left root-owned files in the
#    checkout. List them (data dirs excluded) and give them back to yourself:
sudo find /opt/eqemu -path /opt/eqemu/mariadb/data -prune -o -path /opt/eqemu/certbot -prune \
     -o -path /opt/eqemu/backups -prune -o -user root -print
sudo chown "$(id -un)": <the files listed>     # never chown mariadb/data
mkdir -p state

# 2. Anonymous pulls only.
docker logout ghcr.io

# 3. Get the new scripts from the release tag (the rest of the checkout is
#    updated by deploy.sh itself).
git fetch https://github.com/straps-eq/eqemulator-loginserver.git "refs/tags/v1.7.2:refs/tags/v1.7.2"
git checkout v1.7.2 -- scripts/deploy.sh scripts/deploy/

# 4. Policy, dry run, upgrade.
cp scripts/deploy/updater.conf.example updater.conf && chmod 600 updater.conf
scripts/deploy.sh 1.7.2 --dry-run
scripts/deploy.sh 1.7.2

# 5. Timer.
scripts/deploy/install-timer.sh
```

On that first run deploy.sh:

- works out the running version from the web image label, else the git tag;
- writes `versions.env.previous` pointing at the `:previous` tags of the images
  that were running, so `--rollback` works even though they were unpinned;
- creates or extends `schema_migrations` (adds the `checksum` column) and
  marks every migration the *running* version shipped as already applied,
  because `setup.sh`, the old agent or the README loop applied them without
  (complete) tracking. Only migrations new in the target release are run;
- replaces tracked files that the old agent or a manual edit changed (the
  originals are in the snapshot and named in the log), and re-renders nginx
  from the template if it changed since your version.

If `/opt/eqemu` is not a git clone (copied files), clone the repository next
to it, move `.env`, `loginserver/login.json`, `uploads/`, `mariadb/data/`,
`certbot/` and `backups/` across with the stack stopped, and start from step 0.

After the move, stop using the dashboard's **Upgrade** button for this node;
with the pins in `.env`, the legacy agent's image swap no longer changes which
images run.

---

## 7. Troubleshooting

| Message | Fix |
|---|---|
| `needs_operator: node is not healthy before the upgrade` | Fix the node first (`scripts/validate.sh`, `docker logs eqemu-web`). Manual runs can add `--skip-health-precheck` if you know what you are doing. |
| `... is not writable by <user>` | Root-owned files in the checkout, see section 6 step 1. |
| `signature verification ... FAILED` | Do not work around it. Report it to the maintainers. |
| `anonymous pull test ... failed` | Network or GHCR outage; check `~/.docker/config.json` has no `ghcr.io` entry. |
| `exceeds max_jump` | Upgrade by hand (`scripts/deploy.sh <version>`), or raise `max_jump`. |
| `requires at least X` | Install an intermediate release first. |
| exit 8 | Read the end of the log: the node may be on the old version with a partly applied migration. The dump path is in the message. |

Logs: manual runs print to the terminal; timer runs go to
`~/eqemu-updater/updater.log`.

---

## For developers

- `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`
  builds from source into local `eqemu-*:dev` images (never over the
  `ghcr.io` names).
- Releases: bump `web/package.json`, tag `vX.Y.Z`. `release.yml` refuses a tag
  that does not match. It pushes `:X.Y.Z`, `:X.Y` (and, for legacy nodes only,
  `:vX.Y.Z` and `:latest`), signs every image and the manifest, and attaches
  `release.json` + `release.json.bundle`. `MIN_FROM_VERSION` lives in
  `.github/release-policy.env`.
- Migrations must be additive (expand/contract) and idempotent: rollback does
  not undo them.
- `scripts/deploy/test-deploy.sh` runs the offline unit tests; CI also runs
  shellcheck and compose checks (`.github/workflows/deploy-scripts.yml`).
