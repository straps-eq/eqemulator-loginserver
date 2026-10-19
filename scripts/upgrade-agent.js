#!/usr/bin/env node
// EQEmulator Upgrade Agent — lightweight HTTP API for Docker operations
// Runs inside a node:alpine container with Docker socket access.
//
// Legacy (1.5.x / 1.6.x) control path. Configuration (docker-compose.yml,
// nginx) is NOT managed here: it comes from the git tag via scripts/deploy.sh,
// which also updates this agent. The agent only pulls exactly the image
// references the host compose file names, keeps the running images as
// <repo>:previous for POST /rollback, and fails loudly.

const http = require("http");
const { execSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = parseInt(process.env.AGENT_PORT || "9090", 10);
const TOKEN = process.env.AGENT_TOKEN || "";
const COMPOSE_DIR = process.env.COMPOSE_DIR || "/host";
const BACKUP_DIR = path.join(COMPOSE_DIR, "backups");
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || "/migrations";
const DB_ROOT_PASSWORD = process.env.DB_ROOT_PASSWORD || "";

if (!TOKEN) {
  console.error("[upgrade-agent] ERROR: AGENT_TOKEN not set");
  process.exit(1);
}

// Strip anything that looks like a credential before it reaches the log.
function redact(s) {
  let out = String(s);
  for (const secret of [TOKEN, DB_ROOT_PASSWORD]) {
    if (secret && secret.length >= 4) out = out.split(secret).join("***");
  }
  return out
    .replace(/-p"[^"]*"/g, '-p"***"')
    .replace(/\b(MYSQL_PWD|[A-Z_]*(?:PASSWORD|TOKEN|SECRET))=("[^"]*"|'[^']*'|\S+)/g, "$1=***")
    .replace(/(Bearer\s+)\S+/gi, "$1***");
}

function log(msg) {
  console.log(`[upgrade-agent] ${redact(msg)}`);
}

function run(cmd, opts = {}) {
  try {
    log(`  $ ${cmd.slice(0, 200)}`);
    return execSync(cmd, { encoding: "utf8", timeout: 300000, ...opts }).trim();
  } catch (err) {
    const msg = err.stderr ? err.stderr.trim() : err.message;
    log(`  ✗ ${msg.slice(0, 300)}`);
    return msg;
  }
}

// Variant that throws on failure — use for critical paths where errors must not be swallowed
function runChecked(cmd, opts = {}) {
  log(`  $ ${cmd.slice(0, 200)}`);
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 300000, ...opts }).trim();
  } catch (err) {
    const msg = err.stderr ? err.stderr.trim() : err.message;
    log(`  ✗ ${msg.slice(0, 300)}`);
    throw new Error(redact(msg));
  }
}

// Variant that returns {ok, output} — use where callers need to distinguish success/failure
function runResult(cmd, opts = {}) {
  log(`  $ ${cmd.slice(0, 200)}`);
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: 300000, ...opts }).trim();
    return { ok: true, output: out };
  } catch (err) {
    const msg = ((err.stdout || "") + (err.stderr || "")).trim() || err.message;
    log(`  ✗ ${msg.slice(0, 300)}`);
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
function composeBase() {
  return `docker compose -p "${PROJECT_NAME}" --project-directory "${HOST_DIR}" -f "${COMPOSE_FILE}" --env-file "${COMPOSE_DIR}/.env"`;
}
function compose(args) {
  return run(`${composeBase()} ${args} 2>&1`);
}
function composeResult(args, opts = {}) {
  return runResult(`${composeBase()} ${args} 2>&1`, opts);
}

// ── Safe DB Operations ──
// The root password is passed through the environment (`docker exec -e MYSQL_PWD`
// with no value inherits it), never on any command line, so it does not show
// up in `ps` on the host or in our logs.
function mysqlEnv() {
  return { ...process.env, MYSQL_PWD: DB_ROOT_PASSWORD };
}

function mysqlDump(outputFile) {
  const result = spawnSync("docker", [
    "exec", "-e", "MYSQL_PWD",
    "eqemu-mariadb", "mysqldump", "-u", "root", "eqemu_login"
  ], { encoding: "utf8", timeout: 60000, maxBuffer: 100 * 1024 * 1024, env: mysqlEnv() });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(redact(result.stderr || "mysqldump failed"));
  const output = result.stdout || "";
  if (output.length < 100) throw new Error(`Backup too small (${output.length} bytes)`);
  if (!output.includes("-- Dump completed")) throw new Error("Backup truncated — missing completion marker");
  fs.writeFileSync(outputFile, output);
  return fs.statSync(outputFile).size;
}

function mysqlExec(sqlFile) {
  const sql = fs.readFileSync(sqlFile, "utf8");
  const result = spawnSync("docker", [
    "exec", "-i", "-e", "MYSQL_PWD",
    "eqemu-mariadb", "mysql", "-u", "root", "eqemu_login"
  ], { input: sql, encoding: "utf8", timeout: 300000, env: mysqlEnv() });
  return {
    ok: result.status === 0,
    output: redact(((result.stdout || "") + (result.stderr || "") + (result.error ? result.error.message : "")).trim()),
  };
}

function mysqlExecRaw(sql) {
  const result = spawnSync("docker", [
    "exec", "-i", "-e", "MYSQL_PWD",
    "eqemu-mariadb", "mysql", "-N", "-u", "root", "eqemu_login"
  ], { input: sql, encoding: "utf8", timeout: 10000, env: mysqlEnv() });
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
  return mysqlExecRaw(`INSERT IGNORE INTO ${MIGRATION_TABLE} (filename) VALUES ('${filename.replace(/'/g, "''")}')`).ok;
}

// Upgrade state — tracked so the dashboard can poll /upgrade/status
let upgradeState = { running: false, step: "", error: "", result: null };

// ── Upgrade state persistence (survives agent restarts, e.g. by deploy.sh) ──
const UPGRADE_STATE_FILE = path.join(COMPOSE_DIR, ".upgrade-state.json");
function persistUpgradeState() {
  try { fs.writeFileSync(UPGRADE_STATE_FILE, JSON.stringify(upgradeState)); } catch {}
}
function loadPersistedUpgradeState() {
  try {
    const data = JSON.parse(fs.readFileSync(UPGRADE_STATE_FILE, "utf8"));
    if (data && (data.step === "done" || data.step === "failed")) {
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

// ── Image references ──
// Services whose images the agent manages. The agent never invents a tag: it
// pulls exactly what the host compose file names for each service.
const IMAGE_SERVICES = ["web", "loginserver", "upgrade-agent"];
// Services an upgrade/rollback recreates. The agent never recreates itself;
// it is updated by scripts/deploy.sh.
const UPGRADE_SERVICES = ["web", "loginserver"];
const ROLLBACK_STATE_FILE = path.join(COMPOSE_DIR, ".rollback-state.json");

// Split "registry/ns/name:tag@sha256:..." into { repo, tag, digest }.
function parseImageRef(ref) {
  let rest = String(ref || "").trim();
  let digest = "";
  const at = rest.indexOf("@");
  if (at !== -1) { digest = rest.slice(at + 1); rest = rest.slice(0, at); }
  let tag = "";
  const slash = rest.lastIndexOf("/");
  const colon = rest.lastIndexOf(":");
  if (colon > slash) { tag = rest.slice(colon + 1); rest = rest.slice(0, colon); }
  if (!tag && !digest) tag = "latest";
  return { repo: rest, tag, digest };
}

function isSafeImageRef(ref) {
  return /^[A-Za-z0-9][A-Za-z0-9._\-/:@]*$/.test(ref || "") && !/^sha256:/.test(ref);
}

function inspectContainer(container, format) {
  const r = spawnSync("docker", ["inspect", "--format", format, container], { encoding: "utf8", timeout: 10000 });
  if (r.error || r.status !== 0) return "";
  return (r.stdout || "").trim().replace(/^'|'$/g, "");
}

// Resolve the image reference each service uses, from `docker compose config`
// (env-interpolated). Falls back to the running container's configured image.
// The config output contains resolved environment values (passwords), so it is
// parsed in memory and never logged.
function resolveServiceImages(services = IMAGE_SERVICES) {
  let cfg = null;
  try {
    const out = execSync(`${composeBase()} config --format json`, {
      encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 20 * 1024 * 1024,
    });
    cfg = JSON.parse(out);
  } catch (e) {
    log("  ⚠ 'docker compose config' failed; falling back to the running containers' image references");
  }
  const images = {};
  for (const svc of services) {
    let ref = cfg && cfg.services && cfg.services[svc] && cfg.services[svc].image;
    if (!ref) ref = inspectContainer(`eqemu-${svc}`, "{{.Config.Image}}");
    if (!ref || !isSafeImageRef(ref)) {
      throw new Error(`Cannot determine the image reference for service '${svc}' from ${path.basename(COMPOSE_FILE)}`);
    }
    images[svc] = ref;
  }
  return images;
}

// Warn if a docker client config visible to the agent holds a ghcr.io login.
// A stale saved PAT makes pulls of the public images fail with "denied".
// (Mount the host's ~/.docker read-only and set HOST_DOCKER_CONFIG to check it.)
function warnIfGhcrLogin() {
  const dirs = [process.env.HOST_DOCKER_CONFIG, process.env.DOCKER_CONFIG, path.join(os.homedir(), ".docker")].filter(Boolean);
  for (const dir of [...new Set(dirs)]) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
      const keys = [...Object.keys(cfg.auths || {}), ...Object.keys(cfg.credHelpers || {})];
      if (keys.some(k => k.includes("ghcr.io"))) {
        logEvent("warn", "agent", "system",
          `Docker config ${path.join(dir, "config.json")} has a saved ghcr.io login. Images are public; it is ignored for pulls. Run 'docker logout ghcr.io' on the host.`);
      }
    } catch { /* no config or unreadable — nothing to warn about */ }
  }
}

// Run a docker CLI command with a fresh, empty DOCKER_CONFIG so a stale saved
// registry login on the host can never turn an anonymous public pull into "denied".
function dockerAnonymous(args, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-docker-config-"));
  try {
    return spawnSync(args[0], args.slice(1), {
      encoding: "utf8", timeout: 300000, ...opts, env: { ...process.env, DOCKER_CONFIG: dir },
    });
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function pullImage(ref) {
  log(`  $ docker pull ${ref}   (empty DOCKER_CONFIG)`);
  const r = dockerAnonymous(["docker", "pull", ref]);
  if (r.error || r.status !== 0) {
    const msg = redact(((r.stderr || "") || (r.error ? r.error.message : "") || "unknown error").trim());
    log(`  ✗ Pull failed for ${ref}: ${msg.slice(0, 300)}`);
    throw new Error(`Image pull failed for ${ref}: ${msg.slice(0, 200)}`);
  }
  log(`  ✓ Pulled ${ref}`);
}

function composePull(services) {
  log(`  $ docker compose pull ${services.join(" ")}   (empty DOCKER_CONFIG)`);
  const args = ["docker", "compose", "-p", PROJECT_NAME, "--project-directory", HOST_DIR, "-f", COMPOSE_FILE,
    "--env-file", `${COMPOSE_DIR}/.env`, "pull", ...services];
  const r = dockerAnonymous(args);
  if (r.error || r.status !== 0) {
    const msg = redact(((r.stdout || "") + (r.stderr || "") || (r.error ? r.error.message : "")).trim());
    throw new Error(`Compose pull failed: ${msg.slice(0, 200)}`);
  }
  log(`  ✓ Compose pulled ${services.join(", ")}`);
}

// Pull exactly the reference each service uses — :latest only if compose says :latest.
function pullServiceImages(images, services, useCompose = false) {
  warnIfGhcrLogin();
  if (useCompose) return composePull(services);
  for (const svc of services) pullImage(images[svc]);
}

// Tag the image every running service uses as <repo>:previous so POST /rollback
// can return to it. Called before anything is pulled or changed.
function tagPreviousImages(images, services = IMAGE_SERVICES) {
  const state = { tagged_at: new Date().toISOString(), services: {} };
  for (const svc of services) {
    const container = `eqemu-${svc}`;
    const imageId = inspectContainer(container, "{{.Image}}");
    if (!imageId) {
      log(`  ⊘ ${container} not found — nothing to keep as :previous`);
      continue;
    }
    const { repo } = parseImageRef(images[svc]);
    const prevRef = `${repo}:previous`;
    log(`  $ docker tag ${imageId.slice(0, 19)} ${prevRef}`);
    const r = spawnSync("docker", ["tag", imageId, prevRef], { encoding: "utf8", timeout: 30000 });
    if (r.error || r.status !== 0) {
      throw new Error(`Could not tag ${container} image as ${prevRef}: ${((r.stderr || "") || (r.error ? r.error.message : "")).trim().slice(0, 200)}`);
    }
    log(`  ✓ ${container} (${imageId.slice(7, 19)}) kept as ${prevRef}`);
    state.services[svc] = { ref: images[svc], previous: prevRef, image_id: imageId };
  }
  try { fs.writeFileSync(ROLLBACK_STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) {
    log(`  ⚠ Could not write ${ROLLBACK_STATE_FILE}: ${e.message}`);
  }
  return state;
}

// ── Migrations ──
// MariaDB error codes that mean "this object already exists". They are the
// ONLY tolerated migration failures, and only when they come from the LAST
// statement of the file: the mysql client stops at the first error, so every
// earlier statement has already succeeded and the failing one is a no-op
// (e.g. 011's ADD UNIQUE INDEX on a DB that already has uq_name_source).
// Anything else — including the same codes on an earlier statement, which
// would leave the rest of the file unapplied — aborts the upgrade.
const IDEMPOTENT_NOOP_ERRORS = {
  1050: "table already exists",
  1060: "duplicate column name",
  1061: "duplicate key name",
  1826: "duplicate foreign key constraint name",
};

// Line numbers (1-based) at which each SQL statement starts, skipping comments
// and string literals. Good enough for our migration files (no DELIMITER).
function statementStartLines(sql) {
  const starts = [];
  let line = 1, inStmt = false, i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    if (c === "\n") { line++; i++; continue; }
    if ((c === "-" && d === "-" && /\s/.test(sql[i + 2] || " ")) || c === "#") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) { if (sql[i] === "\n") line++; i++; }
      i += 2;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (!inStmt && c !== ";") { starts.push(line); inStmt = true; }
    if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < n && sql[i] !== c) { if (sql[i] === "\\") i++; else if (sql[i] === "\n") line++; i++; }
      i++;
      continue;
    }
    if (c === ";") inStmt = false;
    i++;
  }
  return starts;
}

// Returns a reason string if the failure is a documented idempotent no-op, else "".
function idempotentNoopReason(sql, output) {
  const errs = [...String(output).matchAll(/ERROR (\d+) \([0-9A-Z]+\) at line (\d+)/g)];
  if (errs.length !== 1) return "";
  const code = parseInt(errs[0][1], 10);
  const line = parseInt(errs[0][2], 10);
  if (!IDEMPOTENT_NOOP_ERRORS[code]) return "";
  const starts = statementStartLines(sql);
  if (!starts.length || line < starts[starts.length - 1]) return "";
  return `${IDEMPOTENT_NOOP_ERRORS[code]} (MariaDB ${code}) on the last statement`;
}

function firstErrorLine(output) {
  const lines = String(output || "").split("\n").map(l => l.trim()).filter(Boolean);
  return (lines.find(l => /^ERROR\b/.test(l)) || lines[0] || "unknown error").slice(0, 300);
}

// Copy /app/migrations out of the given web image. Throws on any failure: a
// stale migrations directory must never be mistaken for the new release's.
function extractMigrations(webImage) {
  try { fs.mkdirSync(MIGRATIONS_DIR, { recursive: true }); } catch {}
  log(`  $ docker create ${webImage}`);
  const created = spawnSync("docker", ["create", webImage], { encoding: "utf8", timeout: 60000 });
  const cid = (created.stdout || "").trim();
  if (created.status !== 0 || !isContainerId(cid)) {
    throw new Error(`Could not create a container from ${webImage} to read migrations: ${((created.stderr || "") || "no container id").trim().slice(0, 200)}`);
  }
  try {
    const cp = spawnSync("docker", ["cp", `${cid}:/app/migrations/.`, `${MIGRATIONS_DIR}/`], { encoding: "utf8", timeout: 60000 });
    if (cp.status !== 0) throw new Error(`Could not copy migrations from ${webImage}: ${(cp.stderr || "").trim().slice(0, 200)}`);
  } finally {
    spawnSync("docker", ["rm", cid], { encoding: "utf8", timeout: 30000 });
  }
}

// Apply every unapplied migration in order. Throws on the first real failure.
function applyMigrations(webImage) {
  extractMigrations(webImage);
  if (!ensureMigrationTable()) throw new Error(`Could not create/read ${MIGRATION_TABLE} table`);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
  let applied = 0;
  const noops = [];
  for (const fname of files) {
    if (isMigrationApplied(fname)) { log(`  ⊘ ${fname} (already applied)`); continue; }
    const fpath = path.join(MIGRATIONS_DIR, fname);
    const result = mysqlExec(fpath);
    if (!result.ok) {
      const reason = idempotentNoopReason(fs.readFileSync(fpath, "utf8"), result.output);
      if (!reason) {
        log(`  ✗ ${fname}: ${result.output.slice(0, 300)}`);
        const err = new Error(`Migration ${fname} failed: ${firstErrorLine(result.output)}`);
        err.applied = applied;
        throw err;
      }
      logEvent("warn", "agent", "system", `Migration ${fname}: ${reason} — already applied, recording as done`);
      noops.push(fname);
    } else {
      applied++;
      log(`  ✓ ${fname}`);
    }
    if (!recordMigration(fname)) {
      const err = new Error(`Migration ${fname} ran but could not be recorded in ${MIGRATION_TABLE}`);
      err.applied = applied;
      throw err;
    }
  }
  return { applied, noops };
}

// Final post-restart verdict for an upgrade/rollback.
function finishWithHealth(kind, healthy, result) {
  if (healthy) {
    logEvent("info", "agent", "system", `${kind} completed successfully`);
    upgradeState = { running: false, step: "done", error: "", result: { ...result, healthy: true } };
  } else {
    const hint = kind === "Rollback"
      ? "Manual intervention needed (scripts/deploy.sh <previous version>)."
      : "POST /rollback restores the previous images.";
    const error = `${kind} applied but the post-restart health check failed. ${hint}`;
    logEvent("error", "agent", "system", error);
    upgradeState = { running: false, step: "failed", error, result: { ...result, healthy: false } };
  }
  releaseUpgradeLock();
  persistUpgradeState();
}

function failUpgrade(kind, message, result = null) {
  logEvent("error", "agent", "system", `${kind} failed: ${message}`);
  upgradeState = { running: false, step: "failed", error: message, result };
  releaseUpgradeLock();
  persistUpgradeState();
}

function doPull(res) {
  log("POST /pull");
  try {
    const images = resolveServiceImages(UPGRADE_SERVICES);
    pullServiceImages(images, UPGRADE_SERVICES);
    log("Pull complete");
    jsonResponse(res, 200, { ok: true, output: UPGRADE_SERVICES.map(s => `pulled ${images[s]}`).join("\n") });
  } catch (err) {
    jsonResponse(res, 500, { ok: false, error: err.message });
  }
}

function doMigrate(res) {
  log("POST /migrate");
  try {
    const images = resolveServiceImages(["web"]);
    const { applied, noops } = applyMigrations(images.web);
    jsonResponse(res, 200, { ok: true, applied, noops: noops.length ? noops : undefined });
  } catch (err) {
    log(`Migrate failed: ${err.message}`);
    // 200 + ok:false keeps the shape the dashboard already parses ({applied, errors}).
    jsonResponse(res, 200, { ok: false, applied: err.applied || 0, errors: [err.message], error: err.message });
  }
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

function recreateFailed(r) {
  return !r.ok || /\bError\b/.test(r.output || "");
}

// ── Shared upgrade pipeline ──
// backup? → tag :previous → pull exact refs → migrate? → recreate web+loginserver → health gate
async function runUpgradePipeline({ kind, backup, migrate, useCompose = false }) {
  const total = 4 + (backup ? 1 : 0) + (migrate ? 1 : 0);
  let n = 0;
  const step = (name, label) => { upgradeState.step = name; n++; log(`Step ${n}/${total}: ${label}`); };
  const result = {};

  if (backup) {
    step("backup", "Backing up database");
    try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
    const stamp = new Date().toISOString().replace(/[T:]/g, "-").slice(0, 19);
    const backupFile = path.join(BACKUP_DIR, `pre-upgrade-${stamp}.sql`);
    try {
      result.backup_size = mysqlDump(backupFile);
      result.backup = `pre-upgrade-${stamp}.sql`;
    } catch (err) {
      try { fs.unlinkSync(backupFile); } catch {}
      return failUpgrade(kind, "backup failed: " + err.message);
    }
    log(`  ✓ Backup saved (${result.backup_size} bytes)`);
  }

  let images;
  try {
    images = resolveServiceImages(IMAGE_SERVICES);
    for (const svc of IMAGE_SERVICES) log(`  ${svc}: ${images[svc]}`);
  } catch (err) {
    return failUpgrade(kind, err.message, result);
  }
  result.images = { web: images.web, loginserver: images.loginserver };

  step("tag_previous", "Keeping running images as :previous");
  try {
    tagPreviousImages(images, IMAGE_SERVICES);
  } catch (err) {
    return failUpgrade(kind, `${err.message} — aborted before any change (rollback would not be possible)`, result);
  }

  step("pull", `Pulling ${UPGRADE_SERVICES.map(s => images[s]).join(", ")}`);
  try {
    pullServiceImages(images, UPGRADE_SERVICES, useCompose);
  } catch (err) {
    return failUpgrade(kind, `${err.message} (nothing was restarted)`, result);
  }

  if (migrate) {
    step("migrate", "Running migrations");
    try {
      const m = applyMigrations(images.web);
      result.migrations = m.applied;
      if (m.noops.length) result.migration_noops = m.noops;
      log(`  ✓ ${m.applied} migrations applied`);
    } catch (err) {
      result.migrations = err.applied || 0;
      const where = result.backup ? ` Backup: ${result.backup}.` : "";
      return failUpgrade(kind, `${err.message}. Aborted: services were NOT restarted; the database may be partially migrated.${where}`, result);
    }
  }

  step("restart", "Recreating web + loginserver");
  const restart = composeResult("up -d --no-deps --force-recreate web loginserver");
  log(`  compose output: ${(restart.output || "").slice(0, 300)}`);
  if (recreateFailed(restart)) {
    return failUpgrade(kind, `Restart failed: ${(restart.output || "").slice(0, 200)}. POST /rollback restores the previous images.`, result);
  }
  log("  ✓ Services recreated");

  step("health_check", "Health check");
  const healthy = await postRestartHealthCheck();
  if (backup) pruneOldBackups();
  log("  ℹ upgrade-agent is not self-updated; it is updated by scripts/deploy.sh");
  finishWithHealth(kind, healthy, result);
}

// A node whose compose pins images by digest is managed by scripts/deploy.sh.
// Upgrading it here would re-tag :previous and overwrite deploy.sh's rollback
// target, so refuse with a pointer instead (same rule as /rollback).
function digestPinnedServices() {
  try {
    const images = resolveServiceImages(UPGRADE_SERVICES);
    return UPGRADE_SERVICES.filter((svc) => parseImageRef(images[svc]).digest);
  } catch {
    return [];
  }
}

function startPipeline(res, opts) {
  const pinned = digestPinnedServices();
  if (pinned.length > 0) {
    const msg = `${pinned.join(", ")} pinned by digest; this node is managed by scripts/deploy.sh — run "scripts/deploy.sh <version>" on the host instead`;
    log(`  ✗ ${opts.kind} refused: ${msg}`);
    jsonResponse(res, 409, { error: msg });
    return;
  }
  if (!acquireUpgradeLock()) {
    jsonResponse(res, 409, { error: "Upgrade already in progress", step: upgradeState.step });
    return;
  }
  upgradeState = { running: true, step: "starting", error: "", result: null };
  jsonResponse(res, 202, { ok: true, started: true });
  setImmediate(async () => {
    try {
      await runUpgradePipeline(opts);
    } catch (err) {
      failUpgrade(opts.kind, err.message);
    }
  });
}

// ── Force Pull & Restart ──
// Lightweight upgrade: keep :previous, pull images, recreate web + loginserver.
// No backup/migrations. ?mode=compose uses `compose pull` instead of `docker pull`.
function doForcePullRestart(res, mode) {
  const useCompose = mode === "compose";
  log(`POST /force_pull_restart (${useCompose ? "compose" : "direct"} mode)`);
  startPipeline(res, { kind: "Force pull & restart", backup: false, migrate: false, useCompose });
}

// Full upgrade. This used to also overwrite the host docker-compose.yml and
// nginx config from files baked into the agent image; it no longer does.
// Configuration comes from the git tag via scripts/deploy.sh.
function doUpgrade(res) {
  log("POST /upgrade — full upgrade (backup, pull, migrate, restart)");
  log("  ℹ Config files (docker-compose.yml, nginx) are not synced by the agent; use scripts/deploy.sh <version>");
  startPipeline(res, { kind: "Upgrade", backup: true, migrate: true });
}

function getUpgradeStatus(res) {
  jsonResponse(res, 200, upgradeState);
}

// Image-only upgrade: backup + pull + migrate + restart web/loginserver.
function doImageUpgrade(res) {
  log("POST /image_upgrade — image-only upgrade");
  startPipeline(res, { kind: "Image upgrade", backup: true, migrate: true });
}

// ── Rollback ──
// Re-point web + loginserver to <repo>:previous and recreate them. For a tag
// reference (e.g. :latest or :v1.6.2) the compose reference is re-tagged to the
// :previous image, so compose (and the health monitor's recreates) keep using
// it. A digest reference cannot be re-pointed; roll that back with deploy.sh.
// The database is NOT rolled back; the pre-upgrade backup is in backups/.
function doRollback(res) {
  log("POST /rollback");
  if (!acquireUpgradeLock()) {
    jsonResponse(res, 409, { error: "Upgrade already in progress", step: upgradeState.step });
    return;
  }
  const plan = [];
  try {
    const images = resolveServiceImages(UPGRADE_SERVICES);
    for (const svc of UPGRADE_SERVICES) {
      const { repo, tag, digest } = parseImageRef(images[svc]);
      if (digest) throw new Error(`${svc} is pinned by digest (${images[svc]}); roll back with scripts/deploy.sh <previous version>`);
      const prev = `${repo}:previous`;
      const r = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", prev], { encoding: "utf8", timeout: 10000 });
      if (r.error || r.status !== 0) throw new Error(`No ${prev} image on this host — nothing to roll back to`);
      plan.push({ svc, prev, target: `${repo}:${tag}`, prevId: (r.stdout || "").trim() });
    }
  } catch (err) {
    releaseUpgradeLock();
    log(`  ✗ Rollback refused: ${err.message}`);
    jsonResponse(res, 409, { error: err.message });
    return;
  }

  upgradeState = { running: true, step: "rollback", error: "", result: null };
  jsonResponse(res, 202, { ok: true, started: true, plan: plan.map(p => ({ service: p.svc, target: p.target, from: p.prev })) });

  setImmediate(async () => {
    try {
      log(`Rollback: ${plan.map(p => `${p.svc} ${p.target} -> ${p.prev} (${p.prevId.slice(7, 19)})`).join(", ")}`);
      for (const p of plan) {
        log(`  $ docker tag ${p.prev} ${p.target}`);
        const r = spawnSync("docker", ["tag", p.prev, p.target], { encoding: "utf8", timeout: 30000 });
        if (r.error || r.status !== 0) {
          return failUpgrade("Rollback", `docker tag ${p.prev} ${p.target} failed: ${(r.stderr || "").trim().slice(0, 200)}`);
        }
        log(`  ✓ ${p.target} now points at ${p.prev}`);
      }
      upgradeState.step = "restart";
      log("Rollback: recreating web + loginserver");
      const restart = composeResult("up -d --no-deps --force-recreate web loginserver");
      log(`  compose output: ${(restart.output || "").slice(0, 300)}`);
      if (recreateFailed(restart)) {
        return failUpgrade("Rollback", `Restart failed: ${(restart.output || "").slice(0, 200)}`);
      }
      upgradeState.step = "health_check";
      log("Rollback: health check");
      const healthy = await postRestartHealthCheck();
      log("  ℹ The database was not rolled back; restore a backups/pre-upgrade-*.sql dump manually if a migration must be undone");
      finishWithHealth("Rollback", healthy, { rollback: true, images: Object.fromEntries(plan.map(p => [p.svc, p.target])) });
    } catch (err) {
      failUpgrade("Rollback", err.message);
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

function waitForContainerRunning(container, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    function check() {
      const status = inspectContainer(container, "{{.State.Status}}");
      if (status === "running" || Date.now() - start >= timeoutMs) return resolve(status);
      setTimeout(check, 2000);
    }
    check();
  });
}

// Full post-restart sequence: wait for web + loginserver, restart nginx, verify
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
  // The loginserver has no HTTP endpoint; require the container to be running.
  const lsStatus = await waitForContainerRunning("eqemu-loginserver", 15000);
  if (lsStatus !== "running") {
    logEvent("error", "agent", "health", `Loginserver is ${lsStatus || "missing"} after restart`);
    return false;
  }
  log("  ✓ Loginserver running");
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

  // argv array, no shell: `since` is user input and must never reach a shell.
  const args = ["logs"];
  if (since) {
    // Duration (e.g. "1h", "30m") or ISO timestamp, anchored at both ends
    if (/^[0-9]+[smh]$/.test(since) || /^\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:\d{2})?)?$/.test(since)) {
      args.push("--since", since);
    } else {
      return jsonResponse(res, 400, { error: "Invalid since" });
    }
  }
  args.push("--tail", String(tail), "--timestamps", container);

  // docker logs writes the container's stderr stream to our stderr, so merge both.
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 15000, maxBuffer: 5 * 1024 * 1024 });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.error || (result.status !== 0 && !result.stdout)) {
    const msg = (result.error?.message || output || "").trim();
    return jsonResponse(res, 500, { error: `Failed to get logs for ${container}: ${msg.slice(0, 200)}` });
  }
  const lines = output.split("\n").filter(Boolean);
  jsonResponse(res, 200, { service, container, lines, count: lines.length, tail });
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
  if (method === "POST" && url === "/rollback") return doRollback(res);
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
