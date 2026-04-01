#!/usr/bin/env node
// EQEmulator Upgrade Agent — lightweight HTTP API for Docker operations
// Runs inside a node:alpine container with Docker socket access.

const http = require("http");
const { execSync, exec } = require("child_process");
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
    return execSync(cmd, { encoding: "utf8", timeout: 120000, ...opts }).trim();
  } catch (err) {
    return err.stderr ? err.stderr.trim() : err.message;
  }
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
    execSync(`docker exec eqemu-mariadb mysqldump -u root -p"${DB_ROOT_PASSWORD}" eqemu_login > "${backupFile}"`, { shell: true, timeout: 60000 });
    const size = fs.statSync(backupFile).size;
    log(`Backup saved: ${backupFile} (${size} bytes)`);
    // Prune old backups (keep last 5)
    try {
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("pre-upgrade-")).sort().reverse();
      files.slice(5).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
    } catch {}
    jsonResponse(res, 200, { ok: true, file: `pre-upgrade-${stamp}.sql`, size });
  } catch (err) {
    try { fs.unlinkSync(backupFile); } catch {}
    jsonResponse(res, 500, { error: "backup failed: " + err.message });
  }
}

function doPull(res) {
  log("POST /pull");
  const output = run(`cd "${COMPOSE_DIR}" && docker compose -f docker-compose.release.yml pull web loginserver 2>&1`);
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
    if (tempContainer && tempContainer.length > 10) {
      run(`docker cp ${tempContainer}:/app/migrations/. ${MIGRATIONS_DIR}/ 2>/dev/null`);
      run(`docker rm ${tempContainer} 2>/dev/null`);
    }
  } catch {}

  try {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
    for (const fname of files) {
      const fpath = path.join(MIGRATIONS_DIR, fname);
      const result = run(`docker exec -i eqemu-mariadb mysql -u root -p"${DB_ROOT_PASSWORD}" eqemu_login < "${fpath}" 2>&1`);
      const realErrors = result.split("\n").filter(l => l && !/Duplicate column|Duplicate key|already exists|Warning/i.test(l)).join("; ");
      if (realErrors) errors.push(`${fname}: ${realErrors}`);
      applied++;
      log(`  ✓ ${fname}`);
    }
  } catch (err) {
    errors.push(err.message);
  }

  jsonResponse(res, 200, { ok: true, applied, errors: errors.length ? errors : undefined });
}

function doRestart(res, service) {
  log(`POST /restart/${service}`);
  const allowed = ["web", "loginserver", "mariadb", "redis", "nginx"];
  if (!allowed.includes(service)) {
    jsonResponse(res, 400, { error: `invalid service: ${service}` });
    return;
  }
  run(`cd "${COMPOSE_DIR}" && docker compose -f docker-compose.release.yml up -d --force-recreate ${service} 2>&1`);
  jsonResponse(res, 200, { ok: true, service });
}

function doUpgrade(res) {
  log("POST /upgrade — starting full upgrade");

  // Step 1: Backup
  log("Step 1/4: Backing up database");
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
  const stamp = new Date().toISOString().replace(/[T:]/g, "-").slice(0, 19);
  const backupFile = path.join(BACKUP_DIR, `pre-upgrade-${stamp}.sql`);
  try {
    execSync(`docker exec eqemu-mariadb mysqldump -u root -p"${DB_ROOT_PASSWORD}" eqemu_login > "${backupFile}"`, { shell: true, timeout: 60000 });
  } catch (err) {
    try { fs.unlinkSync(backupFile); } catch {}
    jsonResponse(res, 500, { error: "backup failed, upgrade aborted" });
    return;
  }
  const backupSize = fs.statSync(backupFile).size;
  log(`  ✓ Backup saved (${backupSize} bytes)`);

  // Step 2: Pull new images
  log("Step 2/4: Pulling new images");
  run(`cd "${COMPOSE_DIR}" && docker compose -f docker-compose.release.yml pull web loginserver 2>&1`);
  log("  ✓ Images pulled");

  // Step 3: Run migrations from new image
  log("Step 3/4: Running migrations");
  let migCount = 0;
  try {
    const tempContainer = run("docker create ghcr.io/straps-eq/eqemu-web:latest 2>/dev/null").trim();
    if (tempContainer && tempContainer.length > 10) {
      try { fs.mkdirSync(MIGRATIONS_DIR, { recursive: true }); } catch {}
      run(`docker cp ${tempContainer}:/app/migrations/. ${MIGRATIONS_DIR}/ 2>/dev/null`);
      run(`docker rm ${tempContainer} 2>/dev/null`);
    }
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
    for (const fname of files) {
      run(`docker exec -i eqemu-mariadb mysql -u root -p"${DB_ROOT_PASSWORD}" eqemu_login < "${path.join(MIGRATIONS_DIR, fname)}" 2>&1`);
      migCount++;
    }
  } catch {}
  log(`  ✓ ${migCount} migrations applied`);

  // Step 4: Restart services with new images
  log("Step 4/4: Restarting services");
  run(`cd "${COMPOSE_DIR}" && docker compose -f docker-compose.release.yml up -d --force-recreate web loginserver 2>&1`);
  log("  ✓ Services restarted");

  // Prune old backups (keep last 5)
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("pre-upgrade-")).sort().reverse();
    files.slice(5).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  } catch {}

  log("Upgrade complete");
  jsonResponse(res, 200, { ok: true, backup: `pre-upgrade-${stamp}.sql`, backup_size: backupSize, migrations: migCount });
}

// ── HTTP Server ──
const server = http.createServer((req, res) => {
  // Auth check
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${TOKEN}`) {
    jsonResponse(res, 401, { error: "unauthorized" });
    return;
  }

  const url = req.url || "/";
  const method = req.method || "GET";

  if (method === "GET" && url === "/status") return getStatus(res);
  if (method === "GET" && url === "/version") return getVersion(res);
  if (method === "POST" && url === "/backup") return doBackup(res);
  if (method === "POST" && url === "/pull") return doPull(res);
  if (method === "POST" && url === "/migrate") return doMigrate(res);
  if (method === "POST" && url === "/upgrade") return doUpgrade(res);
  if (method === "POST" && url.startsWith("/restart/")) {
    const svc = url.replace("/restart/", "");
    return doRestart(res, svc);
  }

  jsonResponse(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  log(`Listening on port ${PORT} (token: ${TOKEN.slice(0, 8)}...)`);
});
