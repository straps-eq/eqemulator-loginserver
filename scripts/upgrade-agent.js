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
    const safeCmd = cmd.replace(/-p"[^"]*"/g, '-p"***"');
    log(`  $ ${safeCmd.slice(0, 200)}`);
    return execSync(cmd, { encoding: "utf8", timeout: 300000, ...opts }).trim();
  } catch (err) {
    const msg = err.stderr ? err.stderr.trim() : err.message;
    log(`  ✗ ${msg.replace(/-p"[^"]*"/g, '-p"***"').slice(0, 300)}`);
    return msg;
  }
}

// Helper: run docker compose with correct file, env, and project name.
// Project name must match the host's (derived from directory name "eqemu").
// HOST_PROJECT_DIR is the real host path (e.g. /opt/eqemu) so Docker resolves
// bind mount paths correctly (COMPOSE_DIR=/host is only visible inside this container).
const HOST_DIR = process.env.HOST_PROJECT_DIR || "/opt/eqemu";
function compose(args) {
  return run(`docker compose -p eqemu --project-directory "${HOST_DIR}" -f "${COMPOSE_DIR}/docker-compose.yml" --env-file "${COMPOSE_DIR}/.env" ${args} 2>&1`);
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
  const output = compose(`up -d --no-deps --force-recreate ${service}`);
  // If we recreated web or loginserver, nginx needs a restart to pick up new container IPs
  if (service === "web" || service === "loginserver") {
    log("Restarting nginx to pick up new container IP");
    run("docker restart eqemu-nginx 2>&1");
  }
  jsonResponse(res, 200, { ok: true, service, output: output.slice(0, 300) });
}

// Upgrade state — tracked so the dashboard can poll /upgrade/status
let upgradeState = { running: false, step: "", error: "", result: null };

function doUpgrade(res) {
  if (upgradeState.running) {
    jsonResponse(res, 409, { error: "Upgrade already in progress", step: upgradeState.step });
    return;
  }

  // Respond immediately — upgrade runs in background
  upgradeState = { running: true, step: "starting", error: "", result: null };
  jsonResponse(res, 202, { ok: true, started: true });

  // Run the actual upgrade asynchronously
  setImmediate(() => {
    try {
      log("POST /upgrade — starting full upgrade");

      // Step 1: Backup
      upgradeState.step = "backup";
      log("Step 1/5: Backing up database");
      try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
      const stamp = new Date().toISOString().replace(/[T:]/g, "-").slice(0, 19);
      const backupFile = path.join(BACKUP_DIR, `pre-upgrade-${stamp}.sql`);
      try {
        execSync(`docker exec eqemu-mariadb mysqldump -u root -p"${DB_ROOT_PASSWORD}" eqemu_login > "${backupFile}"`, { shell: true, timeout: 60000 });
      } catch (err) {
        try { fs.unlinkSync(backupFile); } catch {}
        upgradeState = { running: false, step: "failed", error: "backup failed", result: null };
        return;
      }
      const backupSize = fs.statSync(backupFile).size;
      log(`  ✓ Backup saved (${backupSize} bytes)`);

      // Step 2: Pull new images
      upgradeState.step = "pull";
      log("Step 2/5: Pulling new images");
      compose("pull web loginserver");
      log("  ✓ Images pulled");

      // Step 3: Run migrations from new image
      upgradeState.step = "migrate";
      log("Step 3/5: Running migrations");
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
      upgradeState.step = "restart";
      log("Step 4/5: Restarting services");
      compose("up -d --no-deps --force-recreate web loginserver");
      log("  ✓ Services restarted");

      // Step 5: Restart nginx to pick up new container IPs
      upgradeState.step = "nginx";
      log("Step 5/5: Restarting nginx");
      run("docker restart eqemu-nginx 2>&1");
      log("  ✓ Nginx restarted");

      // Prune old backups (keep last 5)
      try {
        const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("pre-upgrade-")).sort().reverse();
        files.slice(5).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
      } catch {}

      log("Upgrade complete");
      upgradeState = { running: false, step: "done", error: "", result: { backup: `pre-upgrade-${stamp}.sql`, backup_size: backupSize, migrations: migCount } };
    } catch (err) {
      log(`Upgrade failed: ${err.message}`);
      upgradeState = { running: false, step: "failed", error: err.message, result: null };
    }
  });
}

function getUpgradeStatus(res) {
  jsonResponse(res, 200, upgradeState);
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

setInterval(checkLspxHealth, LSPX_CHECK_INTERVAL);
log("LSPX watchdog enabled (check every 5m, restart on ≥5 unique user failures)");

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
  if (method === "GET" && url === "/upgrade/status") return getUpgradeStatus(res);
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
