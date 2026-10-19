#!/usr/bin/env node
// Local test harness for scripts/upgrade-agent.js. No Docker needed: it stubs
// child_process.execSync / spawnSync with a fake Docker host, starts the agent
// on a random port and drives its HTTP API.
//
//   node scripts/test/upgrade-agent.test.js
//
// Takes ~20 s (one case waits out the loginserver health timeout).

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const TOKEN = "test-token-0123456789abcdef";
const DB_PW = "SuperSecretRootPw!42";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
const composeDir = path.join(tmp, "host");
const migDir = path.join(tmp, "migrations");
const userDockerCfg = path.join(tmp, "user-docker");
fs.mkdirSync(composeDir, { recursive: true });
fs.mkdirSync(userDockerCfg, { recursive: true });
const COMPOSE_CONTENT = "services: {}\n# sentinel: must not be overwritten\n";
fs.writeFileSync(path.join(composeDir, "docker-compose.yml"), COMPOSE_CONTENT);
fs.writeFileSync(path.join(composeDir, ".env"), `DB_ROOT_PASSWORD=${DB_PW}\n`);
// A stale ghcr.io login the agent must warn about and ignore.
fs.writeFileSync(path.join(userDockerCfg, "config.json"), JSON.stringify({ auths: { "ghcr.io": { auth: "c3RhbGU6cGF0" } } }));

// ── Fake docker host ──
let S; // scenario state
function reset(over = {}) {
  S = {
    composeImages: {
      web: "ghcr.io/straps-eq/eqemu-web:v1.6.2",
      loginserver: "ghcr.io/straps-eq/eqemu-loginserver:latest",
      "upgrade-agent": "ghcr.io/straps-eq/eqemu-upgrade-agent:latest",
    },
    images: {
      "sha256:webold": "sha256:webold",
      "sha256:lsold": "sha256:lsold",
      "sha256:agentold": "sha256:agentold",
    },
    containers: {
      "eqemu-web": { image: "sha256:webold", status: "running" },
      "eqemu-loginserver": { image: "sha256:lsold", status: "running" },
      "eqemu-upgrade-agent": { image: "sha256:agentold", status: "running" },
    },
    lsStatusAfterRestart: "running",
    pulls: [], tags: [], ups: [], composePulls: [],
    migrations: { "001_a.sql": "CREATE TABLE IF NOT EXISTS a (id INT);\n" },
    migrationResult: () => ({ status: 0, stdout: "", stderr: "" }),
    applied: new Set(),
    upFails: false,
    ...over,
  };
}
reset();

function resolveImg(ref) { return S.images[ref]; }

cp.execSync = function (cmd, opts = {}) {
  if (/docker compose .* config --format json/.test(cmd)) {
    const services = {};
    for (const [k, v] of Object.entries(S.composeImages)) services[k] = { image: v, environment: { DB_ROOT_PASSWORD: DB_PW } };
    return JSON.stringify({ services });
  }
  if (/docker compose .* up -d/.test(cmd)) {
    S.ups.push(cmd);
    if (S.upFails) { const e = new Error("fail"); e.stdout = "Error response from daemon: boom"; e.stderr = ""; throw e; }
    if (/web loginserver/.test(cmd)) {
      for (const [svc, c] of [["web", "eqemu-web"], ["loginserver", "eqemu-loginserver"]]) {
        const id = resolveImg(S.composeImages[svc]);
        if (id) S.containers[c].image = id;
      }
      S.containers["eqemu-loginserver"].status = S.lsStatusAfterRestart;
    }
    return "Container eqemu-web Started";
  }
  if (cmd.includes("{{json .Mounts}}")) throw new Error("no such container");
  const st = cmd.match(/\{\{\.State\.Status\}\}'? (eqemu-[a-z-]+)/);
  if (st) return (S.containers[st[1]] || { status: "missing" }).status;
  if (cmd.startsWith("wget")) return "";
  return "";
};

cp.spawnSync = function (bin, args, opts = {}) {
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const fail = (stderr) => ({ status: 1, stdout: "", stderr });
  assert.strictEqual(bin, "docker");
  // Never put the DB password on a command line.
  assert(!args.join(" ").includes(DB_PW), "DB password on docker argv");
  const a = args;
  if (a[0] === "inspect") {
    const c = S.containers[a[3]];
    if (!c) return fail("No such object");
    if (a[2] === "{{.Image}}") return ok(c.image);
    if (a[2] === "{{.State.Status}}") return ok(c.status);
    if (a[2] === "{{.Config.Image}}") return ok("");
  }
  if (a[0] === "image" && a[1] === "inspect") {
    const id = resolveImg(a[4]);
    return id ? ok(id) : fail("No such image");
  }
  if (a[0] === "tag") {
    const id = resolveImg(a[1]);
    if (!id) return fail("No such image");
    S.images[a[2]] = id; S.tags.push(`${a[1]} -> ${a[2]}`); return ok();
  }
  if (a[0] === "pull") {
    const dc = opts.env && opts.env.DOCKER_CONFIG;
    assert(dc && dc !== userDockerCfg && fs.existsSync(dc) && fs.readdirSync(dc).length === 0, "pull must use an empty temp DOCKER_CONFIG");
    S.pulls.push(a[1]);
    if (S.pullFails) return fail("denied");
    S.images[a[1]] = `sha256:new-${a[1].split("/").pop()}`;
    return ok();
  }
  if (a[0] === "compose" && a.includes("pull")) { S.composePulls.push(a.slice(a.indexOf("pull") + 1)); return ok(); }
  if (a[0] === "create") return ok("abcdef1234567890");
  if (a[0] === "cp") {
    const dest = a[2];
    fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
    for (const [f, sql] of Object.entries(S.migrations)) fs.writeFileSync(path.join(dest, f), sql);
    return ok();
  }
  if (a[0] === "rm") return ok();
  if (a[0] === "exec") {
    assert(opts.env && opts.env.MYSQL_PWD === DB_PW, "MYSQL_PWD must come from env");
    if (a.includes("mysqldump")) return ok("-- MariaDB dump\n" + "x".repeat(200) + "\n-- Dump completed\n");
    if (a.includes("-N")) {
      const sql = opts.input;
      if (/^CREATE TABLE/.test(sql)) return ok();
      const sel = sql.match(/SELECT COUNT\(\*\) .* filename = '([^']+)'/);
      if (sel) return ok(S.applied.has(sel[1]) ? "1" : "0");
      const ins = sql.match(/INSERT IGNORE .* VALUES \('([^']+)'\)/);
      if (ins) { S.applied.add(ins[1]); return ok(); }
      return ok();
    }
    return S.migrationResult(opts.input);
  }
  return ok();
};

// Capture logs.
const logs = [];
const origLog = console.log;
console.log = (...m) => { logs.push(m.join(" ")); if (process.env.VERBOSE) origLog(...m); };
console.error = console.log;

const PORT = 39000 + Math.floor(Math.random() * 1000);
Object.assign(process.env, {
  AGENT_TOKEN: TOKEN, AGENT_PORT: String(PORT), COMPOSE_DIR: composeDir, HOST_PROJECT_DIR: "/opt/eqemu",
  MIGRATIONS_DIR: migDir, DB_ROOT_PASSWORD: DB_PW, DOCKER_CONFIG: userDockerCfg,
});
require("../upgrade-agent.js");

function request(method, p, token = TOKEN) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path: p, headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let body = ""; res.on("data", d => body += d);
      res.on("end", () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on("error", reject); req.end();
  });
}
async function waitDone() {
  for (let i = 0; i < 200; i++) {
    const r = await request("GET", "/upgrade/status");
    if (!r.body.running) return r.body;
    await new Promise(r2 => setTimeout(r2, 100));
  }
  throw new Error("upgrade did not finish");
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); }
  catch (e) { results.push(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

(async () => {
  await new Promise(r => setTimeout(r, 300));

  await test("rejects bad token", async () => {
    assert.strictEqual((await request("POST", "/rollback", "nope")).status, 401);
  });

  await test("image_upgrade pulls exact compose refs, keeps :previous, no re-tag, no self-update", async () => {
    reset();
    const r = await request("POST", "/image_upgrade");
    assert.strictEqual(r.status, 202);
    const st = await waitDone();
    assert.strictEqual(st.step, "done", st.error);
    assert.deepStrictEqual(S.pulls, ["ghcr.io/straps-eq/eqemu-web:v1.6.2", "ghcr.io/straps-eq/eqemu-loginserver:latest"]);
    assert(!S.pulls.some(p => p.includes("web:latest")), "must not pull web:latest");
    assert(!S.pulls.some(p => p.includes("upgrade-agent")), "must not pull the agent image");
    assert.deepStrictEqual(S.tags, [
      "sha256:webold -> ghcr.io/straps-eq/eqemu-web:previous",
      "sha256:lsold -> ghcr.io/straps-eq/eqemu-loginserver:previous",
      "sha256:agentold -> ghcr.io/straps-eq/eqemu-upgrade-agent:previous",
    ]);
    assert.strictEqual(S.ups.length, 1);
    assert(/--force-recreate web loginserver/.test(S.ups[0]));
    assert(!S.ups.some(u => /upgrade-agent/.test(u)), "agent must not recreate itself");
    assert.strictEqual(st.result.migrations, 1);
    assert(logs.some(l => l.includes("saved ghcr.io login")), "ghcr.io login warning");
    assert(logs.some(l => l.includes("updated by scripts/deploy.sh")));
    assert(fs.existsSync(path.join(composeDir, ".rollback-state.json")));
  });

  await test("/upgrade does not overwrite docker-compose.yml or nginx config", async () => {
    reset();
    await request("POST", "/upgrade");
    const st = await waitDone();
    assert.strictEqual(st.step, "done", st.error);
    assert.strictEqual(fs.readFileSync(path.join(composeDir, "docker-compose.yml"), "utf8"), COMPOSE_CONTENT);
    assert(!fs.existsSync(path.join(composeDir, "docker-compose.yml.bak")));
    assert(!fs.existsSync(path.join(composeDir, "nginx")));
  });

  await test("digest-pinned compose is pulled by digest", async () => {
    reset({ composeImages: { web: "ghcr.io/straps-eq/eqemu-web@sha256:" + "a".repeat(64), loginserver: "ghcr.io/straps-eq/eqemu-loginserver:v1.6.2", "upgrade-agent": "ghcr.io/straps-eq/eqemu-upgrade-agent:v1.6.2" } });
    await request("POST", "/force_pull_restart?mode=direct");
    const st = await waitDone();
    assert.strictEqual(st.step, "done", st.error);
    assert.deepStrictEqual(S.pulls, ["ghcr.io/straps-eq/eqemu-web@sha256:" + "a".repeat(64), "ghcr.io/straps-eq/eqemu-loginserver:v1.6.2"]);
    assert(S.tags[0].endsWith("eqemu-web:previous"));
  });

  await test("force_pull_restart compose mode uses compose pull", async () => {
    reset();
    await request("POST", "/force_pull_restart?mode=compose");
    const st = await waitDone();
    assert.strictEqual(st.step, "done", st.error);
    assert.deepStrictEqual(S.composePulls, [["web", "loginserver"]]);
  });

  await test("pull failure fails before restart", async () => {
    reset({ pullFails: true });
    await request("POST", "/image_upgrade");
    const st = await waitDone();
    assert.strictEqual(st.step, "failed");
    assert(/Image pull failed/.test(st.error));
    assert.strictEqual(S.ups.length, 0);
  });

  await test("migration error aborts upgrade (no restart)", async () => {
    reset({
      migrations: { "001_a.sql": "SELECT 1;\n", "002_b.sql": "ALTER TABLE x ADD COLUMN y INT;\n" },
      migrationResult: (sql) => sql.includes("ALTER") ? { status: 1, stdout: "", stderr: "ERROR 1146 (42S02) at line 1: Table 'eqemu_login.x' doesn't exist" } : { status: 0, stdout: "", stderr: "" },
    });
    await request("POST", "/image_upgrade");
    const st = await waitDone();
    assert.strictEqual(st.step, "failed");
    assert(/Migration 002_b\.sql failed: ERROR 1146/.test(st.error), st.error);
    assert(/NOT restarted/.test(st.error));
    assert.strictEqual(S.ups.length, 0);
    assert(!S.applied.has("002_b.sql"));
    assert(S.applied.has("001_a.sql"));
  });

  await test("duplicate key on LAST statement is a documented no-op", async () => {
    reset({
      migrations: { "011_u.sql": "-- comment\n\nALTER TABLE login_accounts\n  ADD UNIQUE INDEX uq (a, b);\n" },
      migrationResult: () => ({ status: 1, stdout: "", stderr: "ERROR 1061 (42000) at line 3: Duplicate key name 'uq'" }),
    });
    await request("POST", "/image_upgrade");
    const st = await waitDone();
    assert.strictEqual(st.step, "done", st.error);
    assert.deepStrictEqual(st.result.migration_noops, ["011_u.sql"]);
    assert(S.applied.has("011_u.sql"));
  });

  await test("duplicate column on an EARLIER statement aborts", async () => {
    reset({
      migrations: { "006_x.sql": "ALTER TABLE a ADD COLUMN c INT;\n-- next\nALTER TABLE b ADD COLUMN c INT;\n" },
      migrationResult: () => ({ status: 1, stdout: "", stderr: "ERROR 1060 (42S21) at line 1: Duplicate column name 'c'" }),
    });
    await request("POST", "/image_upgrade");
    const st = await waitDone();
    assert.strictEqual(st.step, "failed");
    assert(/006_x\.sql failed/.test(st.error));
    assert.strictEqual(S.ups.length, 0);
  });

  await test("restart error fails", async () => {
    reset({ upFails: true });
    await request("POST", "/force_pull_restart");
    const st = await waitDone();
    assert.strictEqual(st.step, "failed");
    assert(/Restart failed/.test(st.error));
  });

  await test("failed health check => step failed, not done", async () => {
    reset({ lsStatusAfterRestart: "exited" });
    await request("POST", "/image_upgrade");
    const st = await waitDone();
    assert.strictEqual(st.step, "failed");
    assert(/health check failed/.test(st.error));
    assert.strictEqual(st.result.healthy, false);
  });

  await test("rollback re-points compose refs to :previous and recreates", async () => {
    reset();
    await request("POST", "/image_upgrade");
    assert.strictEqual((await waitDone()).step, "done");
    assert.strictEqual(S.containers["eqemu-web"].image, "sha256:new-eqemu-web:v1.6.2");
    S.tags = []; S.ups = [];
    const r = await request("POST", "/rollback");
    assert.strictEqual(r.status, 202, JSON.stringify(r.body));
    const st = await waitDone();
    assert.strictEqual(st.step, "done", st.error);
    assert.deepStrictEqual(S.tags, [
      "ghcr.io/straps-eq/eqemu-web:previous -> ghcr.io/straps-eq/eqemu-web:v1.6.2",
      "ghcr.io/straps-eq/eqemu-loginserver:previous -> ghcr.io/straps-eq/eqemu-loginserver:latest",
    ]);
    assert.strictEqual(S.ups.length, 1);
    assert.strictEqual(S.containers["eqemu-web"].image, "sha256:webold");
    assert.strictEqual(S.containers["eqemu-loginserver"].image, "sha256:lsold");
    assert.strictEqual(st.result.rollback, true);
  });

  await test("rollback without :previous is refused (409)", async () => {
    reset();
    const r = await request("POST", "/rollback");
    assert.strictEqual(r.status, 409);
    assert(/No .*:previous/.test(r.body.error));
  });

  await test("rollback with digest-pinned compose is refused (409)", async () => {
    reset({ composeImages: { web: "ghcr.io/straps-eq/eqemu-web@sha256:" + "b".repeat(64), loginserver: "x/y:1", "upgrade-agent": "x/z:1" } });
    const r = await request("POST", "/rollback");
    assert.strictEqual(r.status, 409);
    assert(/digest/.test(r.body.error));
  });

  await test("/migrate reports errors in dashboard shape", async () => {
    reset({ migrationResult: () => ({ status: 1, stdout: "", stderr: "ERROR 1064 (42000) at line 1: syntax" }) });
    const r = await request("POST", "/migrate");
    assert.strictEqual(r.body.ok, false);
    assert.strictEqual(r.body.applied, 0);
    assert(Array.isArray(r.body.errors) && /001_a\.sql/.test(r.body.errors[0]));
  });

  await test("secrets never logged", async () => {
    const all = logs.join("\n");
    assert(!all.includes(DB_PW), "DB password in logs");
    assert(!all.includes(TOKEN), "token in logs");
    assert(!all.includes("c3RhbGU6cGF0"), "registry auth in logs");
  });

  origLog(results.join("\n"));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
})();
