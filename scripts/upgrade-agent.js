#!/usr/bin/env node
// EQEmulator Upgrade Agent — lightweight HTTP API for Docker operations
// Runs inside a node:alpine container with Docker socket access.

const http = require("http");
const { execSync, exec, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.AGENT_PORT || "9090", 10);
const TOKEN = process.env.AGENT_TOKEN || "";
const COMPOSE_DIR = process.env.COMPOSE_DIR || "/host";
const BACKUP_DIR = path.join(COMPOSE_DIR, "backups");
const MIGRATIONS_DIR = "/migrations";
const DB_ROOT_PASSWORD = process.env.DB_ROOT_PASSWORD || "";

if (!TOKEN) {
  console.error("[upgrade-agent] ERROR: AGENT_TOKEN not set");
  process.exit(1);
}

function log(msg) {
  console.log(`[upgrade-agent] ${msg}`);
}

function run(cmd, opts = {}) {
  try {
    const safeCmd = cmd.replace(/-p"[^"]*"/g, '-p"***"');
    log(`  $ ${safeCmd.slice(0, 200)}`);
    return execSync(cmd, { encoding: "utf8", timeout: 300000, ...opts }).trim();
  } catch (err) {
    const msg = err.stderr ? err.stderr.trim() : err.message;
    log(`  ✗ ${msg.replace(/-p"[^"]*"/g, '-p"***"').slice(0, 300)}`);
    return msg;
  }
}

// Variant that throws on failure — use for critical paths where errors must not be swallowed
function runChecked(cmd, opts = {}) {
  const safeCmd = cmd.replace(/-p"[^"]*"/g, '-p"***"');
  log(`  $ ${safeCmd.slice(0, 200)}`);
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 300000, ...opts }).trim();
  } catch (err) {
    const msg = err.stderr ? err.stderr.trim() : err.message;
    log(`  ✗ ${msg.replace(/-p"[^"]*"/g, '-p"***"').slice(0, 300)}`);
    throw new Error(msg);
  }
}

// Variant that returns {ok, output} — use where callers need to distinguish success/failure
function runResult(cmd, opts = {}) {
  const safeCmd = cmd.replace(/-p"[^"]*"/g, '-p"***"');
  log(`  $ ${safeCmd.slice(0, 200)}`);
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: 300000, ...opts }).trim();
    return { ok: true, output: out };
  } catch (err) {
    const msg = err.stderr ? err.stderr.trim() : err.message;
    log(`  ✗ ${msg.replace(/-p"[^"]*"/g, '-p"***"').slice(0, 300)}`);
    return { ok: false, output: msg };
  }
}

// Helper: run docker compose with correct file, env, and project name.
// Project name is derived from the host directory (e.g. /opt/eqemu → "eqemu",
// /opt/eqemulator-loginserver → "eqemulator-loginserver") so containers land
// on the correct Docker network matching the operator's setup.
// Auto-detect HOST_DIR from our own container's mount — the host path mounted
// at /host IS the project directory, regardless of what it's called on the host.
function detectHostDir() {
  if (process.env.HOST_PROJECT_DIR) return process.env.HOST_PROJECT_DIR;
  try {
    const mounts = JSON.parse(execSync(
      "docker inspect --format='{{json .Mounts}}' eqemu-upgrade-agent 2>/dev/null",
      { encoding: "utf8", timeout: 5000 }
    ).trim().replace(/^'|'$/g, ""));
    const hostMount = mounts.find(m => m.Destination === "/host" && m.Type === "bind");
    if (hostMount && hostMount.Source) {
      console.log(`[upgrade-agent] Auto-detected host dir: ${hostMount.Source}`);
      return hostMount.Source;
    }
  } catch (e) { /* fall through */ }
  return "/opt/eqemu";
}
const HOST_DIR = detectHostDir();
const PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME || path.basename(HOST_DIR);
const COMPOSE_FILE = fs.existsSync(`${COMPOSE_DIR}/docker-compose.yml`)
  ? `${COMPOSE_DIR}/docker-compose.yml`
  : fs.existsSync(`${COMPOSE_DIR}/docker-compose.release.yml`)
    ? `${COMPOSE_DIR}/docker-compose.release.yml`
    : null;
if (!COMPOSE_FILE) {
  console.error("[upgrade-agent] ERROR: No docker-compose.yml or docker-compose.release.yml found in " + COMPOSE_DIR);
  process.exit(1);
}
log(`Project: ${PROJECT_NAME} | Host dir: ${HOST_DIR} | Compose: ${path.basename(COMPOSE_FILE)}`);
function compose(args) {
  return run(`docker compose -p "${PROJECT_NAME}" --project-directory "${HOST_DIR}" -f "${COMPOSE_FILE}" --env-file "${COMPOSE_DIR}/.env" ${args} 2>&1`);
}

// ── Safe DB Operations (no shell injection via DB_ROOT_PASSWORD) ──
function mysqlDump(outputFile) {
  const result = spawnSync("docker", [
    "exec", "-e", `MYSQL_PWD=${DB_ROOT_PASSWORD}`,
    "eqemu-mariadb", "mysqldump", "-u", "root", "eqemu_login"
  ], { encoding: "utf8", timeout: 60000, maxBuffer: 100 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "mysqldump failed");
  const output = result.stdout || "";
  if (output.length < 100) throw new Error(`Backup too small (${output.length} bytes)`);
  if (!output.includes("-- Dump completed")) throw new Error("Backup truncated — missing completion marker");
  fs.writeFileSync(outputFile, output);
  return fs.statSync(outputFile).size;
}

function mysqlExec(sqlFile) {
  const sql = fs.readFileSync(sqlFile, "utf8");
  const result = spawnSync("docker", [
    "exec", "-i", "-e", `MYSQL_PWD=${DB_ROOT_PASSWORD}`,
    "eqemu-mariadb", "mysql", "-u", "root", "eqemu_login"
  ], { input: sql, encoding: "utf8", timeout: 300000 });
  return {
    ok: result.status === 0,
    output: ((result.stdout || "") + (result.stderr || "")).trim(),
  };
}

function mysqlExecRaw(sql) {
  const result = spawnSync("docker", [
    "exec", "-i", "-e", `MYSQL_PWD=${DB_ROOT_PASSWORD}`,
    "eqemu-mariadb", "mysql", "-N", "-u", "root", "eqemu_login"
  ], { input: sql, encoding: "utf8", timeout: 10000 });
  return { ok: result.status === 0, output: (result.stdout || "").trim() };
}

// ── Timing-safe token comparison ──
function safeTokenCompare(provided, expected) {
  const a = Buffer.from(provided || "");
  const b = Buffer.from(expected || "");
  if (a.length !== b.length) {
    // Constant-time compare against expected to avoid leaking length
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// ── Container ID validation ──
function isContainerId(str) {
  return /^[a-f0-9]{12,64}$/.test((str || "").trim());
}

// ── Migration tracking ──
const MIGRATION_TABLE = "schema_migrations";
function ensureMigrationTable() {
  const r = mysqlExecRaw(`CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (filename VARCHAR(255) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  return r.ok;
}
function isMigrationApplied(filename) {
  const r = mysqlExecRaw(`SELECT COUNT(*) FROM ${MIGRATION_TABLE} WHERE filename = '${filename.replace(/'/g, "''")}' LIMIT 1`);
  return r.ok && r.output === "1";
}
function recordMigration(filename) {
  mysqlExecRaw(`INSERT IGNORE INTO ${MIGRATION_TABLE} (filename) VALUES ('${filename.replace(/'/g, "''")}')`);
}

// Upgrade state — tracked so the dashboard can poll /upgrade/status
let upgradeState = { running: false, step: "", error: "", result: null };

// ── Upgrade state persistence (survives self-update restarts) ──
const UPGRADE_STATE_FILE = path.join(COMPOSE_DIR, ".upgrade-state.json");
function persistUpgradeState() {
  try { fs.writeFileSync(UPGRADE_STATE_FILE, JSON.stringify(upgradeState)); } catch {}
}
function loadPersistedUpgradeState() {
  try {
    const data = JSON.parse(fs.readFileSync(UPGRADE_STATE_FILE, "utf8"));
    if (data && data.step === "done") {
      upgradeState = data;
      fs.unlinkSync(UPGRADE_STATE_FILE);
      log("Restored upgrade state from previous run");
    }
  } catch {}
}

// ── Concurrency guard ──
let upgradeLock = false;
function acquireUpgradeLock() {
  if (upgradeLock || upgradeState.running) return false;
  upgradeLock = true;
  return true;
}
function releaseUpgradeLock() {
  upgradeLock = false;
}

// ── Backup pruning helper ──
function pruneOldBackups(keepCount = 5) {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("pre-upgrade-")).sort().reverse();
    files.slice(keepCount).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  } catch {}
}

function jsonResponse(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body);
}

// ── Handlers ──

function getStatus(res) {
  log("GET /status");
  const services = {};
  for (const name of ["web", "loginserver", "mariadb", "redis", "nginx"]) {
    const container = `eqemu-${name}`;
    const status = run(`docker inspect --format='{{.State.Status}}' ${container} 2>/dev/null || echo "not found"`);
    const image = run(`docker inspect --format='{{.Config.Image}}' ${container} 2>/dev/null || echo "unknown"`);
    const startedAt = run(`docker inspect --format='{{.State.StartedAt}}' ${container} 2>/dev/null || echo ""`);
    services[name] = { status: status.replace(/'/g, ""), image: image.replace(/'/g, ""), started_at: startedAt.replace(/'/g, "") };
  }
  jsonResponse(res, 200, { services });
}

function getVersion(res) {
  log("GET /version");
  const webDigest = run(`docker inspect --format='{{index .RepoDigests 0}}' $(docker inspect --format='{{.Image}}' eqemu-web 2>/dev/null) 2>/dev/null || echo "unknown"`);
  const lsDigest = run(`docker inspect --format='{{index .RepoDigests 0}}' $(docker inspect --format='{{.Image}}' eqemu-loginserver 2>/dev/null) 2>/dev/null || echo "unknown"`);
  jsonResponse(res, 200, { web_digest: webDigest, loginserver_digest: lsDigest });
}

function doBackup(res) {
  log("POST /backup");
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
  const stamp = new Date().toISOString().replace(/[T:]/g, "-").slice(0, 19);
  const backupFile = path.join(BACKUP_DIR, `pre-upgrade-${stamp}.sql`);
  try {
    const size = mysqlDump(backupFile);
    log(`Backup saved: ${backupFile} (${size} bytes)`);
    pruneOldBackups();
    jsonResponse(res, 200, { ok: true, file: `pre-upgrade-${stamp}.sql`, size });
  } catch (err) {
    try { fs.unlinkSync(backupFile); } catch {}
    jsonResponse(res, 500, { error: "backup failed: " + err.message });
  }
}

function doPull(res) {
  log("POST /pull");
  const output = compose("pull web loginserver");
  log("Pull complete");
  jsonResponse(res, 200, { ok: true, output: output.slice(0, 500) });
}

function doMigrate(res) {
  log("POST /migrate");
  let applied = 0;
  const errors = [];

  // Copy migrations from the new web image
  try {
    const tempContainer = run("docker create ghcr.io/straps-eq/eqemu-web:latest 2>/dev/null").trim();
    if (isContainerId(tempContainer)) {
      run(`docker cp ${tempContainer}:/app/migrations/. ${MIGRATIONS_DIR}/ 2>/dev/null`);
      run(`docker rm ${tempContainer} 2>/dev/null`);
    }
  } catch {}

  try {
    ensureMigrationTable();
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
    for (const fname of files) {
      if (isMigrationApplied(fname)) { log(`  ⊘ ${fname} (already applied)`); continue; }
      const fpath = path.join(MIGRATIONS_DIR, fname);
      const result = mysqlExec(fpath);
      if (!result.ok) {
        const realErrors = result.output.split("\n").filter(l => l && !/Duplicate column|Duplicate key|already exists|Warning/i.test(l)).join("; ");
        if (realErrors) errors.push(`${fname}: ${realErrors}`);
      }
      if (result.ok) {
        recordMigration(fname);
        applied++;
        log(`  ✓ ${fname}`);
      } else {
        log(`  ✗ ${fname}`);
      }
    }
  } catch (err) {
    errors.push(err.message);
  }

  jsonResponse(res, 200, { ok: true, applied, errors: errors.length ? errors : undefined });
}

function doRestart(res, service) {
  log(`POST /restart/${service}`);
  const allowed = ["web", "loginserver", "mariadb", "redis", "nginx", "upgrade-agent"];
  if (!allowed.includes(service)) {
    jsonResponse(res, 400, { error: `invalid service: ${service}` });
    return;
  }
  const output = compose(`up -d --no-deps --force-recreate ${service}`);
  // If we recreated web or loginserver, nginx needs a restart to pick up new container IPs
  if (service === "web" || service === "loginserver") {
    log("Restarting nginx to pick up new container IP");
    run("docker restart eqemu-nginx 2>&1");
  }
  jsonResponse(res, 200, { ok: true, service, output: output.slice(0, 300) });
}

// ── Force Pull & Restart ──
// Lightweight upgrade: pull images, restart web + agent. No backup/migrations.
// Bypasses compose's cached image digest by using direct docker pull + stop/rm.
// Query param ?mode=compose uses compose pull instead of direct docker pull.
function doForcePullRestart(res, mode) {
  const useCompose = mode === "compose";
  log(`POST /force_pull_restart (${useCompose ? "compose" : "direct"} mode)`);

  if (!acquireUpgradeLock()) {
    jsonResponse(res, 409, { error: "Upgrade already in progress", step: upgradeState.step });
    return;
  }

  upgradeState = { running: true, step: "pull", error: "", result: null };
  jsonResponse(res, 202, { ok: true, started: true });

  setImmediate(async () => {
    try {
      const WEB_IMAGE = "ghcr.io/straps-eq/eqemu-web:latest";
      const AGENT_IMAGE = "ghcr.io/straps-eq/eqemu-upgrade-agent:latest";

      // Step 1: Pull images
      upgradeState.step = "pull";
      log("Force pull: Pulling latest images...");
      if (useCompose) {
        const pullResult = runResult(`docker compose -p "${PROJECT_NAME}" --project-directory "${HOST_DIR}" -f "${COMPOSE_FILE}" --env-file "${COMPOSE_DIR}/.env" pull web 2>&1`);
        if (!pullResult.ok) {
          log(`  ✗ Compose pull failed: ${pullResult.output.slice(0, 200)}`);
          upgradeState = { running: false, step: "failed", error: `Pull failed: ${pullResult.output.slice(0, 200)}`, result: null };
          releaseUpgradeLock();
          return;
        }
        log(`  compose pull output: ${(pullResult.output || "").slice(0, 200)}`);
      } else {
        try {
          execSync(`docker pull ${WEB_IMAGE}`, { encoding: "utf8", timeout: 120000 });
        } catch (pullErr) {
          const msg = (pullErr.stderr || pullErr.message || "").trim();
          log(`  ✗ Web image pull failed: ${msg.slice(0, 300)}`);
          upgradeState = { running: false, step: "failed", error: `Pull failed: ${msg.slice(0, 200)}`, result: null };
          releaseUpgradeLock();
          return;
        }
      }
      log("  ✓ Web image pulled");

      // Step 2: Pull loginserver image too
      const LS_IMAGE = "ghcr.io/straps-eq/eqemu-loginserver:latest";
      try {
        if (!useCompose) {
          execSync(`docker pull ${LS_IMAGE}`, { encoding: "utf8", timeout: 120000 });
        }
        log("  ✓ Loginserver image pulled");
      } catch (e) { log(`  ⚠ Loginserver pull skipped: ${e.message}`); }

      // Step 3: Restart web + loginserver
      upgradeState.step = "restart";
      log("Force pull: Restarting web + loginserver...");
      const out = compose("up -d --no-deps --force-recreate web loginserver");
      log(`  compose up output: ${(out || "").slice(0, 200)}`);
      if (out && out.includes("Error")) {
        upgradeState = { running: false, step: "failed", error: `Restart failed: ${out.slice(0, 200)}`, result: null };
        releaseUpgradeLock();
        return;
      }
      // Post-restart health verification
      upgradeState.step = "health_check";
      const fpHealthy = await postRestartHealthCheck();
      if (!fpHealthy) {
        logEvent("error", "agent", "system", "Force pull completed but web health check failed");
      } else {
        logEvent("info", "agent", "system", `Force pull & restart completed (${useCompose ? "compose" : "direct"} mode)`);
      }

      upgradeState = { running: false, step: "done", error: "", result: { mode: useCompose ? "compose" : "direct", healthy: fpHealthy } };
      releaseUpgradeLock();
      persistUpgradeState();

      // Self-update agent (fire and forget — this kills us, restart policy brings back new version)
      try {
        if (!useCompose) {
          execSync(`docker pull ${AGENT_IMAGE}`, { encoding: "utf8", timeout: 120000 });
        }
        log("  ✓ Agent image pulled, self-updating...");
        exec(`docker compose -p "${PROJECT_NAME}" --project-directory "${HOST_DIR}" -f "${COMPOSE_FILE}" --env-file "${COMPOSE_DIR}/.env" up -d --no-deps --force-recreate upgrade-agent 2>&1`, (err) => { if (err) log(`  ⚠ Agent self-update exec error: ${err.message}`); });
      } catch (e) { log(`  ⚠ Agent self-update skipped: ${e.message}`); }
    } catch (err) {
      log(`Force pull restart failed: ${err.message}`);
      upgradeState = { running: false, step: "failed", error: err.message, result: null };
      releaseUpgradeLock();
    }
  });
}

function doUpgrade(res) {
  if (!acquireUpgradeLock()) {
    jsonResponse(res, 409, { error: "Upgrade already in progress", step: upgradeState.step });
    return;
  }

  // Respond immediately — upgrade runs in background
  upgradeState = { running: true, step: "starting", error: "", result: null };
  jsonResponse(res, 202, { ok: true, started: true });

  // Run the actual upgrade asynchronously
  setImmediate(async () => {
    try {
      log("POST /upgrade — starting full upgrade");

      // Step 1: Backup
      upgradeState.step = "backup";
      log("Step 1/6: Backing up database");
      try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
      const stamp = new Date().toISOString().replace(/[T:]/g, "-").slice(0, 19);
      const backupFile = path.join(BACKUP_DIR, `pre-upgrade-${stamp}.sql`);
      let backupSize;
      try {
        backupSize = mysqlDump(backupFile);
      } catch (err) {
        try { fs.unlinkSync(backupFile); } catch {}
        upgradeState = { running: false, step: "failed", error: "backup failed: " + err.message, result: null };
        releaseUpgradeLock();
        return;
      }
      log(`  ✓ Backup saved (${backupSize} bytes)`);

      // Step 2: Pull new images (including upgrade-agent itself)
      upgradeState.step = "pull";
      log("Step 2/6: Pulling new images");
      const pullResult = runResult(`docker compose -p "${PROJECT_NAME}" --project-directory "${HOST_DIR}" -f "${COMPOSE_FILE}" --env-file "${COMPOSE_DIR}/.env" pull web loginserver upgrade-agent 2>&1`);
      if (!pullResult.ok) {
        log(`  ✗ Pull failed: ${pullResult.output.slice(0, 200)}`);
        upgradeState = { running: false, step: "failed", error: `Image pull failed: ${pullResult.output.slice(0, 200)}`, result: null };
        releaseUpgradeLock();
        return;
      }
      log("  ✓ Images pulled");

      // Step 3: Sync config files from new upgrade-agent image
      // ─────────────────────────────────────────────────────────────────
      // This step updates infrastructure configs that ship with each release.
      // It does NOT touch: .env, login.json, game server data, or player data.
      //
      // Files OVERWRITTEN (backup saved as .bak):
      //   - docker-compose.yml  — adds new volume mounts, env vars, build args
      //                           (all site-specific values come from your .env)
      //   - nginx/conf.d/default.conf — rendered from template using your DOMAIN
      //                                  (adds new location blocks, rate limits, etc.)
      //
      // Files NEVER touched:
      //   - .env                — your credentials, domain, API keys
      //   - loginserver/login.json — your loginserver config
      //   - mariadb/data/*      — your database
      //   - uploads/*           — your uploaded banners
      // ─────────────────────────────────────────────────────────────────
      upgradeState.step = "config_sync";
      log("Step 3/6: Syncing config files");
      try {
        const agentImg = "ghcr.io/straps-eq/eqemu-upgrade-agent:latest";
        const tmpCfg = run(`docker create ${agentImg} 2>/dev/null`).trim();
        if (isContainerId(tmpCfg)) {
          // Sync docker-compose.yml (backup existing first)
          try { fs.copyFileSync(`${COMPOSE_DIR}/docker-compose.yml`, `${COMPOSE_DIR}/docker-compose.yml.bak`); } catch {}
          run(`docker cp ${tmpCfg}:/config/docker-compose.yml ${COMPOSE_DIR}/docker-compose.yml 2>/dev/null`);
          log("  ✓ docker-compose.yml updated (old saved as docker-compose.yml.bak)");
          // Sync nginx template — render with DOMAIN from .env
          const domain = run(`grep "^DOMAIN=" ${COMPOSE_DIR}/.env | cut -d= -f2`).trim().replace(/^["']|["']$/g, "");
          if (domain) {
            run(`docker cp ${tmpCfg}:/config/nginx-default.conf.template /tmp/nginx.template 2>/dev/null`);
            try {
              const tmpl = fs.readFileSync("/tmp/nginx.template", "utf8");
              const rendered = tmpl.replace(/__DOMAIN__/g, domain);
              const nginxDir = path.join(COMPOSE_DIR, "nginx", "conf.d");
              fs.mkdirSync(nginxDir, { recursive: true });
              try { fs.copyFileSync(path.join(nginxDir, "default.conf"), path.join(nginxDir, "default.conf.bak")); } catch {}
              fs.writeFileSync(path.join(nginxDir, "default.conf"), rendered);
              log(`  ✓ nginx config updated for ${domain} (old saved as default.conf.bak)`);
            } catch (e) { log(`  ⚠ nginx template render failed: ${e.message}`); }
          }
          run(`docker rm ${tmpCfg} 2>/dev/null`);
        }
      } catch (e) { log(`  ⚠ Config sync skipped: ${e.message}`); }

      // Step 4: Run migrations from new image
      upgradeState.step = "migrate";
      log("Step 4/6: Running migrations");
      let migCount = 0;
      try {
        const tempContainer = run("docker create ghcr.io/straps-eq/eqemu-web:latest 2>/dev/null").trim();
        if (isContainerId(tempContainer)) {
          try { fs.mkdirSync(MIGRATIONS_DIR, { recursive: true }); } catch {}
          run(`docker cp ${tempContainer}:/app/migrations/. ${MIGRATIONS_DIR}/ 2>/dev/null`);
          run(`docker rm ${tempContainer} 2>/dev/null`);
        }
        ensureMigrationTable();
        const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
        for (const fname of files) {
          if (isMigrationApplied(fname)) { log(`  ⊘ ${fname} (already applied)`); continue; }
          const migResult = mysqlExec(path.join(MIGRATIONS_DIR, fname));
          if (!migResult.ok) {
            log(`  ✗ ${fname}: ${migResult.output.slice(0, 200)}`);
          } else {
            recordMigration(fname);
            migCount++;
          }
        }
      } catch (e) { log(`  ⚠ Migration step failed: ${e.message}`); }
      log(`  ✓ ${migCount} migrations applied`);

      // Step 5: Restart services with new images
      upgradeState.step = "restart";
      log("Step 5/6: Restarting services");
      const restartOut = compose("up -d --no-deps --force-recreate web loginserver");
      if (restartOut && restartOut.includes("Error")) {
        upgradeState = { running: false, step: "failed", error: `Restart failed: ${restartOut.slice(0, 200)}`, result: null };
        releaseUpgradeLock();
        return;
      }
      log("  ✓ Services restarted");

      // Step 6: Post-restart health verification
      upgradeState.step = "health_check";
      log("Step 6/6: Health check");
      const upgHealthy = await postRestartHealthCheck();
      if (!upgHealthy) {
        logEvent("error", "agent", "system", "Upgrade completed but web health check failed");
      } else {
        logEvent("info", "agent", "system", "Full upgrade completed successfully");
      }

      pruneOldBackups();

      log("Upgrade complete");
      upgradeState = { running: false, step: "done", error: "", result: { backup: `pre-upgrade-${stamp}.sql`, backup_size: backupSize, migrations: migCount, healthy: upgHealthy } };
      releaseUpgradeLock();
      persistUpgradeState();
    } catch (err) {
      log(`Upgrade failed: ${err.message}`);
      upgradeState = { running: false, step: "failed", error: err.message, result: null };
      releaseUpgradeLock();
    }
  });
}

function getUpgradeStatus(res) {
  jsonResponse(res, 200, upgradeState);
}

// Image-only upgrade: pull + migrate + restart web — NO config sync.
// Safe for peer nodes with custom docker-compose.yml and .env files.
function doImageUpgrade(res) {
  if (!acquireUpgradeLock()) {
    jsonResponse(res, 409, { error: "Upgrade already in progress", step: upgradeState.step });
    return;
  }

  upgradeState = { running: true, step: "starting", error: "", result: null };
  jsonResponse(res, 202, { ok: true, started: true });

  setImmediate(async () => {
    try {
      log("POST /image_upgrade — image-only upgrade (no config sync)");

      // Step 1: Backup
      upgradeState.step = "backup";
      log("Step 1/4: Backing up database");
      try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
      const stamp = new Date().toISOString().replace(/[T:]/g, "-").slice(0, 19);
      const backupFile = path.join(BACKUP_DIR, `pre-upgrade-${stamp}.sql`);
      let backupSize;
      try {
        backupSize = mysqlDump(backupFile);
      } catch (err) {
        try { fs.unlinkSync(backupFile); } catch {}
        upgradeState = { running: false, step: "failed", error: "backup failed: " + err.message, result: null };
        releaseUpgradeLock();
        return;
      }
      log(`  ✓ Backup saved (${backupSize} bytes)`);

      // Step 2: Pull web image (always pull :latest, re-tag if compose uses a pinned version)
      upgradeState.step = "pull";
      log("Step 2/4: Pulling web image");
      const latestImage = "ghcr.io/straps-eq/eqemu-web:latest";
      try {
        execSync(`docker pull ${latestImage}`, { encoding: "utf8", timeout: 120000 });
      } catch (pullErr) {
        const pullMsg = (pullErr.stderr || pullErr.message || "").trim();
        log(`  ✗ Image pull failed: ${pullMsg.slice(0, 300)}`);
        upgradeState = { running: false, step: "failed", error: `Image pull failed (is the GHCR package public?): ${pullMsg.slice(0, 200)}`, result: null };
        releaseUpgradeLock();
        return;
      }
      // Detect what image tag the compose file uses for 'web'
      try {
        const composeImage = run(`docker compose config --format json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const c=JSON.parse(d);const w=c.services&&c.services.web;if(w&&w.image)console.log(w.image);"`).trim();
        if (composeImage && composeImage !== latestImage) {
          run(`docker tag ${latestImage} ${composeImage}`);
          log(`  ✓ Re-tagged ${latestImage} -> ${composeImage}`);
        }
      } catch (e) { log(`  ⚠ Could not detect compose image tag: ${e.message}`); }
      log("  ✓ Web image pulled");

      // Also pull loginserver image
      const lsImage = "ghcr.io/straps-eq/eqemu-loginserver:latest";
      try {
        execSync(`docker pull ${lsImage}`, { encoding: "utf8", timeout: 120000 });
        log("  ✓ Loginserver image pulled");
      } catch (e) { log(`  ⚠ Loginserver pull skipped: ${e.message.slice(0, 200)}`); }

      // Step 3: Run migrations
      upgradeState.step = "migrate";
      log("Step 3/4: Running migrations");
      let migCount = 0;
      try {
        const tempContainer = run("docker create ghcr.io/straps-eq/eqemu-web:latest 2>/dev/null").trim();
        if (isContainerId(tempContainer)) {
          try { fs.mkdirSync(MIGRATIONS_DIR, { recursive: true }); } catch {}
          run(`docker cp ${tempContainer}:/app/migrations/. ${MIGRATIONS_DIR}/ 2>/dev/null`);
          run(`docker rm ${tempContainer} 2>/dev/null`);
        }
        ensureMigrationTable();
        const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
        for (const fname of files) {
          if (isMigrationApplied(fname)) { log(`  ⊘ ${fname} (already applied)`); continue; }
          const migResult = mysqlExec(path.join(MIGRATIONS_DIR, fname));
          if (!migResult.ok) {
            log(`  ✗ ${fname}: ${migResult.output.slice(0, 200)}`);
          } else {
            recordMigration(fname);
            migCount++;
          }
        }
      } catch (e) { log(`  ⚠ Migration step failed: ${e.message}`); }
      log(`  ✓ ${migCount} migrations applied`);

      // Step 4: Restart web + loginserver (preserves their docker-compose, env, other services)
      upgradeState.step = "restart";
      log("Step 4/4: Restarting web + loginserver");
      const restartOut = compose("up -d --no-deps --force-recreate web loginserver");
      log(`  compose output: ${(restartOut || "").slice(0, 300)}`);
      if (restartOut && restartOut.includes("Error")) {
        upgradeState = { running: false, step: "failed", error: `Web restart failed: ${restartOut.slice(0, 200)}`, result: null };
        releaseUpgradeLock();
        return;
      }
      // Post-restart health verification
      upgradeState.step = "health_check";
      const imgHealthy = await postRestartHealthCheck();
      if (!imgHealthy) {
        logEvent("error", "agent", "system", "Image upgrade completed but web health check failed");
      } else {
        logEvent("info", "agent", "system", "Image-only upgrade completed successfully");
      }

      pruneOldBackups();

      log("Image-only upgrade complete");
      upgradeState = { running: false, step: "done", error: "", result: { backup: `pre-upgrade-${stamp}.sql`, backup_size: backupSize, migrations: migCount, healthy: imgHealthy } };
      releaseUpgradeLock();
      persistUpgradeState();

      // Self-update: pull new agent image and recreate (restart: always brings it back)
      try {
        run("docker pull ghcr.io/straps-eq/eqemu-upgrade-agent:latest 2>&1");
        log("  ✓ Upgrade-agent image pulled, self-updating...");
        // This will kill us, but restart policy brings back the new version
        exec(`docker compose -p "${PROJECT_NAME}" --project-directory "${HOST_DIR}" -f "${COMPOSE_FILE}" --env-file "${COMPOSE_DIR}/.env" up -d --no-deps --force-recreate upgrade-agent 2>&1`, (err) => { if (err) log(`  ⚠ Agent self-update exec error: ${err.message}`); });
      } catch (e) { log(`  ⚠ Agent self-update skipped: ${e.message}`); }
    } catch (err) {
      log(`Image upgrade failed: ${err.message}`);
      upgradeState = { running: false, step: "failed", error: err.message, result: null };
      releaseUpgradeLock();
    }
  });
}

// ── Event Ring Buffer ──
// In-memory buffer of structured events for the /logs endpoint.
const EVENT_BUFFER_SIZE = 500;
const eventBuffer = [];
function pushEvent(level, source, category, message) {
  eventBuffer.push({ ts: new Date().toISOString(), level, source, category, message });
  if (eventBuffer.length > EVENT_BUFFER_SIZE) eventBuffer.shift();
}
function logEvent(level, source, category, msg) {
  log(msg);
  pushEvent(level, source, category, msg);
}

// ── Network Connectivity ──
// Ensure all critical containers are on the same Docker network.
// Handles the case where project name differs from original setup.
function ensureNetworkConnectivity() {
  try {
    // Find the network that mariadb is on — that's the authoritative network
    const mariaNetRaw = execSync(
      "docker inspect --format='{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' eqemu-mariadb 2>/dev/null",
      { encoding: "utf8", timeout: 5000 }
    ).trim().replace(/'/g, "");
    if (!mariaNetRaw) return;
    // Could be multiple networks; pick the first one that looks like our internal network
    const nets = mariaNetRaw.split(/\s+/).filter(Boolean);
    const targetNet = nets.find(n => n.includes("internal") || n.includes("eqemu")) || nets[0];
    if (!targetNet) return;

    // Ensure web, nginx, loginserver, redis, upgrade-agent are all on this network
    const containers = ["eqemu-web", "eqemu-nginx", "eqemu-loginserver", "eqemu-redis", "eqemu-upgrade-agent"];
    for (const c of containers) {
      try {
        const cNets = execSync(
          `docker inspect --format='{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' ${c} 2>/dev/null`,
          { encoding: "utf8", timeout: 5000 }
        ).trim().replace(/'/g, "");
        if (!cNets.includes(targetNet)) {
          execSync(`docker network connect ${targetNet} ${c} 2>/dev/null`, { encoding: "utf8", timeout: 10000 });
          logEvent("info", "agent", "network", `Connected ${c} to ${targetNet}`);
        }
      } catch (e) { /* container doesn't exist or already connected */ }
    }
  } catch (e) {
    log(`  ⚠ Network connectivity check failed: ${e.message}`);
  }
}

// ── Post-Restart Health Verification ──
// Polls web container health after restart, restarts nginx, verifies end-to-end.
function waitForWebHealth(timeoutMs = 30000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = 2000;
    function check() {
      if (Date.now() - start >= timeoutMs) {
        resolve({ healthy: false, waitedMs: Date.now() - start });
        return;
      }
      try {
        const status = execSync(
          "docker inspect --format='{{.State.Status}}' eqemu-web 2>/dev/null",
          { encoding: "utf8", timeout: 5000 }
        ).trim().replace(/'/g, "");
        if (status === "running") {
          try {
            execSync(
              'wget -q -O /dev/null --timeout=3 http://eqemu-web:3000/api/status 2>/dev/null',
              { encoding: "utf8", timeout: 8000 }
            );
            resolve({ healthy: true, waitedMs: Date.now() - start });
            return;
          } catch (e) { /* web not ready yet */ }
        }
      } catch (e) { /* container not found yet */ }
      setTimeout(check, interval);
    }
    check();
  });
}

function restartNginxIfExists() {
  try {
    const status = execSync(
      "docker inspect --format='{{.State.Status}}' eqemu-nginx 2>&1",
      { encoding: "utf8", timeout: 5000 }
    ).trim().replace(/'/g, "");
    if (status === "running") {
      execSync("docker restart eqemu-nginx 2>&1", { encoding: "utf8", timeout: 30000 });
      return true;
    }
  } catch (e) { /* no nginx */ }
  return false;
}

// Full post-restart sequence: wait for web, restart nginx, verify
async function postRestartHealthCheck() {
  log("  ↻ Ensuring network connectivity...");
  ensureNetworkConnectivity();
  log("  ↻ Waiting for web to become healthy...");
  const result = await waitForWebHealth(30000);
  if (!result.healthy) {
    logEvent("error", "agent", "health", "Web did not become healthy within 30s after restart");
    return false;
  }
  log(`  ✓ Web healthy after ${result.waitedMs}ms`);

  const nginxRestarted = restartNginxIfExists();
  if (nginxRestarted) {
    log("  ✓ nginx restarted");
  } else {
    log("  ⚠ No nginx container found");
  }
  logEvent("info", "agent", "health", `Post-restart health check passed (${result.waitedMs}ms)`);
  return true;
}

// ── Graceful shutdown flag (declared early — referenced by health monitors) ──
let shuttingDown = false;
const healthIntervals = [];

// ── Web Health Monitor (30s) ──
let lastNginxRestart = 0;
let lastWebRestart = 0;
let webFailCount = 0;
const WEB_HEALTH_INTERVAL = 30 * 1000;
const NGINX_RESTART_COOLDOWN = 2 * 60 * 1000;
const WEB_RESTART_COOLDOWN = 10 * 60 * 1000;

function checkWebHealth() {
  if (shuttingDown || upgradeState.running) return;
  try {
    const status = execSync(
      "docker inspect --format='{{.State.Status}}' eqemu-web 2>/dev/null",
      { encoding: "utf8", timeout: 5000 }
    ).trim().replace(/'/g, "");

    if (status !== "running") {
      webFailCount++;
      if (webFailCount >= 2) {
        logEvent("error", "agent", "health", `Web container status: ${status} (${webFailCount} consecutive failures)`);
      }
    } else {
      // Container is running — try HTTP health check
      try {
        execSync(
          'wget -q -O /dev/null --timeout=5 http://eqemu-web:3000/api/status 2>/dev/null',
          { encoding: "utf8", timeout: 10000 }
        );
        if (webFailCount > 0) {
          logEvent("info", "agent", "health", "Web health recovered");
        }
        webFailCount = 0;
        return;
      } catch (e) {
        webFailCount++;
        if (webFailCount < 2) return; // Allow one transient failure
        logEvent("warn", "agent", "health", `Web HTTP check failed (${webFailCount} consecutive)`);
      }
    }

    // If we get here, web is unhealthy
    const now = Date.now();
    if (webFailCount >= 2 && now - lastNginxRestart > NGINX_RESTART_COOLDOWN) {
      logEvent("warn", "agent", "health", "Restarting nginx due to web health failure");
      try {
        execSync("docker restart eqemu-nginx 2>&1", { encoding: "utf8", timeout: 30000 });
        lastNginxRestart = now;
      } catch (e) { /* no nginx */ }
    }
    if (webFailCount >= 4 && now - lastWebRestart > WEB_RESTART_COOLDOWN) {
      logEvent("error", "agent", "health", "Restarting web container due to persistent health failure");
      compose("up -d --no-deps --force-recreate web");
      lastWebRestart = now;
      // Wait, fix networks, and restart nginx after web comes up
      setTimeout(async () => {
        ensureNetworkConnectivity();
        const h = await waitForWebHealth(20000);
        if (h.healthy) {
          restartNginxIfExists();
          logEvent("info", "agent", "health", "Web recovered after auto-restart");
          webFailCount = 0;
        } else {
          logEvent("error", "agent", "health", "Web still unhealthy after auto-restart");
        }
      }, 5000);
    }
  } catch (err) { /* don't crash agent */ }
}

healthIntervals.push(setInterval(checkWebHealth, WEB_HEALTH_INTERVAL));
log("Web health monitor enabled (30s interval)");

// On startup: fix network splits, then refresh nginx upstreams.
setTimeout(async () => {
  try {
    ensureNetworkConnectivity();
    const webOk = await waitForWebHealth(10000);
    if (webOk.healthy) {
      const restarted = restartNginxIfExists();
      if (restarted) {
        logEvent("info", "agent", "health", "Startup: nginx restarted to refresh upstreams");
      }
    }
  } catch (e) { /* ok */ }
}, 10000);

// ── Loginserver Health Monitor (60s) ──
let lsFailCount = 0;
let lastLsRestart = 0;
const LS_HEALTH_INTERVAL = 60 * 1000;
const LS_RESTART_COOLDOWN = 15 * 60 * 1000;

function checkLoginserverHealth() {
  if (shuttingDown || upgradeState.running) return;
  try {
    const status = execSync(
      "docker inspect --format='{{.State.Status}}' eqemu-loginserver 2>/dev/null",
      { encoding: "utf8", timeout: 5000 }
    ).trim().replace(/'/g, "");

    if (status === "running") {
      if (lsFailCount > 0) {
        logEvent("info", "agent", "health", "Loginserver health recovered");
      }
      lsFailCount = 0;
      return;
    }

    lsFailCount++;
    logEvent("warn", "agent", "health", `Loginserver status: ${status} (${lsFailCount} consecutive failures)`);

    if (lsFailCount >= 3) {
      const now = Date.now();
      if (now - lastLsRestart > LS_RESTART_COOLDOWN) {
        logEvent("error", "agent", "health", "Restarting loginserver due to persistent health failure");
        compose("up -d --no-deps --force-recreate loginserver");
        lastLsRestart = now;
        lsFailCount = 0;
      }
    }
  } catch (err) { /* don't crash agent */ }
}

healthIntervals.push(setInterval(checkLoginserverHealth, LS_HEALTH_INTERVAL));
log("Loginserver health monitor enabled (60s interval)");

// ── Docker Log Parser (15s) ──
// Tails recent docker logs from loginserver + web, extracts meaningful events.
let lastLogParse = Date.now();

function parseContainerLogs() {
  if (shuttingDown) return;
  const sinceSec = Math.min(30, Math.ceil((Date.now() - lastLogParse) / 1000) + 5);
  lastLogParse = Date.now();

  // Parse loginserver logs
  try {
    const lsLogs = execSync(
      `docker logs eqemu-loginserver --since ${sinceSec}s 2>&1 | tail -200`,
      { encoding: "utf8", timeout: 10000 }
    );
    for (const line of lsLogs.split("\n")) {
      if (!line.trim()) continue;

      // Successful login
      const loginMatch = line.match(/DoSuccessfulLogin Successful login for user id \[(\d+)\] account name \[([^\]]+)\]/);
      if (loginMatch) {
        pushEvent("info", "loginserver", "auth", `Login: ${loginMatch[2]} (id ${loginMatch[1]})`);
        continue;
      }
      // Failed login — detected via explicit external auth failure below
      // External auth failure
      const extFail = line.match(/External authentication failed for user \[([^\]]+)\]/);
      if (extFail) {
        pushEvent("warn", "loginserver", "auth", `LSPX auth failed: ${extFail[1]}`);
        continue;
      }
      // Federation play success
      const fedPlayOk = line.match(/auth forwarded successfully for account \[([^\]]+)\]/);
      if (fedPlayOk) {
        pushEvent("info", "loginserver", "federation", `Federation play OK: ${fedPlayOk[1]}`);
        continue;
      }
      // Federation play failure
      const fedPlayFail = line.match(/Federation play: forward failed status \[(\d+)\]/);
      if (fedPlayFail) {
        pushEvent("error", "loginserver", "federation", `Federation play failed: HTTP ${fedPlayFail[1]}`);
        continue;
      }
      // Federation server not found
      if (line.includes("not found as federated server")) {
        const srvMatch = line.match(/server \[(\d+)\]/);
        pushEvent("error", "loginserver", "federation", `Federated server not found: ${srvMatch ? srvMatch[1] : "unknown"}`);
        continue;
      }
      // World server connect/disconnect
      if (line.includes("World server") && line.includes("connected")) {
        pushEvent("info", "loginserver", "system", line.trim().slice(0, 200));
        continue;
      }
      // Any Error level from loginserver
      if (line.includes("|   Error    |") || line.includes("| Error |")) {
        // Skip ones we already handled
        if (!line.includes("federated server") && !line.includes("forward failed")) {
          const msg = line.replace(/^.*\|[^|]+\|\s*/, "").trim();
          if (msg.length > 5) pushEvent("error", "loginserver", "system", msg.slice(0, 200));
        }
      }
    }
  } catch (e) { /* loginserver container may not exist */ }

  // Parse web logs
  try {
    const webLogs = execSync(
      `docker logs eqemu-web --since ${sinceSec}s 2>&1 | tail -200`,
      { encoding: "utf8", timeout: 10000 }
    );
    for (const line of webLogs.split("\n")) {
      if (!line.trim()) continue;

      // Federation sync results
      const syncMatch = line.match(/\[federation\] auto-sync: (\d+) peers?, (\d+) changes?/);
      if (syncMatch) {
        const changes = parseInt(syncMatch[2]);
        if (changes > 0) {
          pushEvent("info", "web", "federation", `Sync: ${syncMatch[1]} peers, ${changes} changes`);
        }
        continue;
      }
      // Sync data applied
      const syncData = line.match(/\[sync_data\] Applied (\d+) changes from node (\d+)/);
      if (syncData) {
        pushEvent("info", "web", "federation", `Applied ${syncData[1]} changes from node ${syncData[2]}`);
        continue;
      }
      // Heartbeat failure
      if (line.includes("heartbeat failed")) {
        pushEvent("warn", "web", "federation", line.trim().slice(0, 200));
        continue;
      }
      // Federation play forward
      if (line.includes("[federation-play]") && line.includes("Auth forwarded successfully")) {
        const nameMatch = line.match(/for (\S+)/);
        pushEvent("info", "web", "federation", `Play forwarded: ${nameMatch ? nameMatch[1] : "unknown"}`);
        continue;
      }
      // Federation play error
      if (line.includes("[federation-play]") && (line.includes("404") || line.includes("error") || line.includes("failed"))) {
        pushEvent("error", "web", "federation", line.replace(/.*\[federation-play\]\s*/, "").trim().slice(0, 200));
        continue;
      }
      // Housekeeping
      if (line.includes("[housekeeping]")) {
        pushEvent("info", "web", "system", line.replace(/.*\[housekeeping\]\s*/, "").trim().slice(0, 200));
        continue;
      }
      // Any explicit error/warn from web
      if (/\b(Error|ERROR|error:)\b/.test(line) && !line.includes("[federation-play]") && !line.includes("heartbeat") && !line.includes("0 errors") && !line.includes("ErrorBoundary")) {
        // Avoid noise: skip routine Next.js compilation messages
        if (line.includes("Compiling") || line.includes("compiled") || line.includes("webpack")) continue;
        pushEvent("warn", "web", "system", line.trim().slice(0, 200));
      }
    }
  } catch (e) { /* web container may not exist */ }
}

healthIntervals.push(setInterval(parseContainerLogs, 15000));
// Initial parse after a short delay (let containers stabilize)
setTimeout(parseContainerLogs, 5000);
log("Log parser enabled (15s interval)");

// ── Health & Logs Endpoints ──
function getHealth(res) {
  const services = {};
  for (const name of ["web", "loginserver", "nginx", "mariadb"]) {
    try {
      const status = execSync(
        `docker inspect --format='{{.State.Status}}' eqemu-${name} 2>/dev/null`,
        { encoding: "utf8", timeout: 5000 }
      ).trim().replace(/'/g, "");
      services[name] = { healthy: status === "running", status };
    } catch (e) {
      services[name] = { healthy: false, status: "not found" };
    }
  }
  // Web HTTP check
  if (services.web.healthy) {
    try {
      execSync(
        'wget -q -O /dev/null --timeout=3 http://eqemu-web:3000/api/status 2>/dev/null',
        { encoding: "utf8", timeout: 8000 }
      );
      services.web.http_ok = true;
    } catch (e) {
      services.web.http_ok = false;
    }
  }
  jsonResponse(res, 200, {
    services,
    last_web_restart: lastWebRestart ? new Date(lastWebRestart).toISOString() : null,
    last_ls_restart: lastLsRestart ? new Date(lastLsRestart).toISOString() : null,
    last_nginx_restart: lastNginxRestart ? new Date(lastNginxRestart).toISOString() : null,
    web_fail_count: webFailCount,
    ls_fail_count: lsFailCount,
  });
}

function getLogs(res, urlStr) {
  const params = new URL(urlStr, "http://localhost").searchParams;
  const level = params.get("level") || "";
  const source = params.get("source") || "";
  const category = params.get("category") || "";
  const limit = Math.min(parseInt(params.get("limit") || "200", 10), 500);
  const since = params.get("since") || "";

  let filtered = eventBuffer;
  if (level) filtered = filtered.filter(e => e.level === level);
  if (source) filtered = filtered.filter(e => e.source === source);
  if (category) filtered = filtered.filter(e => e.category === category);
  if (since) {
    const sinceTs = new Date(since).getTime() || parseInt(since, 10);
    if (sinceTs) filtered = filtered.filter(e => new Date(e.ts).getTime() > sinceTs);
  }

  // Return most recent first, limited
  const events = filtered.slice(-limit).reverse();

  // Summary stats (last hour)
  const oneHourAgo = Date.now() - 3600000;
  const recentEvents = eventBuffer.filter(e => new Date(e.ts).getTime() > oneHourAgo);
  const summary = {
    total: recentEvents.length,
    errors: recentEvents.filter(e => e.level === "error").length,
    warnings: recentEvents.filter(e => e.level === "warn").length,
  };

  jsonResponse(res, 200, { events, summary, buffer_size: eventBuffer.length });
}

// ── LSPX Watchdog ──
// Monitors loginserver logs for stale LSPX proxy connections.
// If all recent LSPX attempts failed (≥3 attempts, 0 successes in last window),
// the loginserver likely has a stale connection to login.eqemulator.net and needs a restart.

const LSPX_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const LSPX_MIN_UNIQUE_FAILURES = 5; // At least 5 distinct users must fail
let lspxLastRestart = 0;
const LSPX_RESTART_COOLDOWN = 15 * 60 * 1000; // Don't restart more than once per 15 min

function checkLspxHealth() {
  if (shuttingDown) return;
  try {
    const logs = run("docker logs eqemu-loginserver --since 10m 2>&1 | tail -500");
    if (!logs) return;

    const lines = logs.split("\n");
    const failedUsers = new Set();
    let lspxSuccesses = 0;
    let localSuccesses = 0;

    for (const line of lines) {
      // Track unique users whose LSPX proxy failed
      const failMatch = line.match(/External authentication failed for user \[([^\]]+)\]/);
      if (failMatch) {
        failedUsers.add(failMatch[1].toLowerCase());
      }
      // Track LSPX successes (account created via proxy)
      if (line.includes("LSPX") && (line.includes("success") || line.includes("account created"))) {
        lspxSuccesses++;
      }
      // Track normal successful logins (proves loginserver is healthy, just LSPX is stale)
      if (line.includes("Successful login [true]")) {
        localSuccesses++;
      }
    }

    // Only restart if:
    // 1. Multiple distinct users failed LSPX (not just one person with a bad password)
    // 2. Zero LSPX successes (every proxy attempt failed)
    // 3. Local logins are working (loginserver itself is healthy)
    if (failedUsers.size >= LSPX_MIN_UNIQUE_FAILURES && lspxSuccesses === 0 && localSuccesses > 0) {
      const now = Date.now();
      if (now - lspxLastRestart < LSPX_RESTART_COOLDOWN) {
        log(`LSPX watchdog: ${failedUsers.size} unique users failed but restart cooldown active`);
        return;
      }
      log(`LSPX watchdog: ${failedUsers.size} unique users failed LSPX proxy (0 successes, ${localSuccesses} local OK) — restarting loginserver`);
      run(`docker restart eqemu-loginserver 2>&1`);
      lspxLastRestart = now;
      log("LSPX watchdog: loginserver restarted");
    }
  } catch (err) {
    // Don't crash the agent on watchdog errors
  }
}

healthIntervals.push(setInterval(checkLspxHealth, LSPX_CHECK_INTERVAL));
log("LSPX watchdog enabled (check every 5m, restart on ≥5 unique user failures)");

// ── Container Logs (on-demand) ──
const ALLOWED_CONTAINERS = new Set(["web", "loginserver", "mariadb", "redis", "nginx", "upgrade-agent", "prometheus", "certbot"]);

function getContainerLogs(res, urlStr) {
  const params = new URL(urlStr, "http://localhost").searchParams;
  const service = params.get("service") || "loginserver";
  const tail = Math.min(Math.max(parseInt(params.get("tail") || "200", 10), 10), 2000);
  const since = params.get("since") || "";

  if (!ALLOWED_CONTAINERS.has(service)) {
    return jsonResponse(res, 400, { error: `Invalid service: ${service}. Allowed: ${[...ALLOWED_CONTAINERS].join(", ")}` });
  }

  const container = `eqemu-${service}`;
  log(`GET /container-logs?service=${service}&tail=${tail}`);

  let cmd = `docker logs --tail ${tail} --timestamps ${container} 2>&1`;
  if (since) {
    // Validate since looks like a duration (e.g. "1h", "30m") or ISO timestamp
    if (/^[0-9]+[smh]$/.test(since) || /^\d{4}-\d{2}-\d{2}/.test(since)) {
      cmd = `docker logs --since ${since} --tail ${tail} --timestamps ${container} 2>&1`;
    }
  }

  try {
    const output = execSync(cmd, { encoding: "utf8", timeout: 15000, maxBuffer: 5 * 1024 * 1024 }).trim();
    const lines = output.split("\n").filter(Boolean);
    jsonResponse(res, 200, { service, container, lines, count: lines.length, tail });
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message || "").trim();
    // execSync throws on non-zero exit but docker logs outputs to stderr for container logs
    // Try to use whatever output we got
    if (err.stdout) {
      const lines = err.stdout.trim().split("\n").filter(Boolean);
      jsonResponse(res, 200, { service, container, lines, count: lines.length, tail });
    } else {
      jsonResponse(res, 500, { error: `Failed to get logs for ${container}: ${msg.slice(0, 200)}` });
    }
  }
}

// ── HTTP Server ──
const server = http.createServer((req, res) => {
  // Auth check
  const auth = req.headers.authorization || "";
  if (!safeTokenCompare(auth, `Bearer ${TOKEN}`)) {
    jsonResponse(res, 401, { error: "unauthorized" });
    return;
  }

  const url = req.url || "/";
  const method = req.method || "GET";

  if (method === "GET" && url === "/status") return getStatus(res);
  if (method === "GET" && url === "/version") return getVersion(res);
  if (method === "GET" && url === "/health") return getHealth(res);
  if (method === "GET" && url.startsWith("/logs")) return getLogs(res, url);
  if (method === "GET" && url === "/upgrade/status") return getUpgradeStatus(res);
  if (method === "POST" && url === "/backup") return doBackup(res);
  if (method === "POST" && url === "/pull") return doPull(res);
  if (method === "POST" && url === "/migrate") return doMigrate(res);
  if (method === "POST" && url === "/upgrade") return doUpgrade(res);
  if (method === "POST" && url === "/image_upgrade") return doImageUpgrade(res);
  if (method === "POST" && url.startsWith("/force_pull_restart")) {
    const mode = url.includes("mode=compose") ? "compose" : "direct";
    return doForcePullRestart(res, mode);
  }
  if (method === "POST" && url.startsWith("/restart/")) {
    const svc = url.replace("/restart/", "");
    return doRestart(res, svc);
  }

  if (method === "GET" && url.startsWith("/container-logs")) return getContainerLogs(res, url);

  jsonResponse(res, 404, { error: "not found" });
});

// ── Graceful Shutdown ──
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Received ${signal}, shutting down...`);
  healthIntervals.forEach(id => clearInterval(id));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Load persisted upgrade state from previous run (e.g. after self-update)
loadPersistedUpgradeState();

server.listen(PORT, "0.0.0.0", () => {
  log(`Listening on port ${PORT} (token length: ${TOKEN.length})`);
});
