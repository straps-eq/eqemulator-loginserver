/**
 * Client probe runner: for each world connected to this node's loginserver
 * and each client version, mint a session key for the probe account through
 * the loginserver API, log in over UDP and record the result.
 *
 * One world at a time, one client at a time. See docs/client-probe.md.
 */
import crypto from "crypto";
import { pool } from "@/lib/db";
import { createAccount, dedupeLiveServers, getServerList, sendClientAuth, ServerListItem } from "@/lib/loginserver-api";
import { CLIENTS, ClientDef, ClientId } from "./clients";
import { CLIENT_ORDER } from "./labels";
import { probeWorldClient } from "./session";
import { getOptedOutWorldIds, saveProbeResult } from "./store";
import type { ProbeStatus } from "./classify";

export const PROBE_ACCOUNT_NAME = "eqemudev-probe";
const PROBE_ACCOUNT_SOURCE = "local";
/** EQ clients always connect to world on UDP 9000 (world/main.cpp). */
const WORLD_UDP_PORT = 9000;
/** Time for the loginserver main loop to deliver ClientAuth to the world. */
const AUTH_DELIVERY_WAIT_MS = 1500;
const PAUSE_BETWEEN_CLIENTS_MS = 2000;
const PAUSE_BETWEEN_WORLDS_MS = 5000;

// ── Configuration ──

function envFlag(name: string): boolean | null {
  const v = (process.env[name] || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return null;
}

/**
 * CLIENT_PROBE_ENABLED=true/false decides. When unset, the probe runs only on
 * the federation master.
 */
export async function isProbeEnabled(): Promise<{ enabled: boolean; reason: string }> {
  const flag = envFlag("CLIENT_PROBE_ENABLED");
  if (flag !== null) return { enabled: flag, reason: `CLIENT_PROBE_ENABLED=${flag}` };
  try {
    const { getSelfNode } = await import("@/lib/federation/node");
    const self = await getSelfNode();
    if (self?.isMaster) return { enabled: true, reason: "federation master (CLIENT_PROBE_ENABLED unset)" };
    return { enabled: false, reason: self ? "not the federation master (CLIENT_PROBE_ENABLED unset)" : "federation not initialized (CLIENT_PROBE_ENABLED unset)" };
  } catch {
    return { enabled: false, reason: "could not determine federation role" };
  }
}

export function probeIntervalMs(): number {
  const h = parseFloat(process.env.CLIENT_PROBE_INTERVAL_HOURS || "");
  return (Number.isFinite(h) && h >= 1 ? h : 6) * 60 * 60 * 1000;
}

/** CLIENT_PROBE_CLIENTS=titanium,rof2,... limits the clients probed. */
export function probeClients(): ClientDef[] {
  const raw = (process.env.CLIENT_PROBE_CLIENTS || "").trim().toLowerCase();
  const shown = CLIENTS.filter((c) => CLIENT_ORDER.indexOf(c.id) !== -1);
  if (!raw) return shown;
  const wanted = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const list = CLIENTS.filter((c) => wanted.indexOf(c.id) !== -1);
  return list.length > 0 ? list : shown;
}

// ── Shared state (one copy per process, also across Next.js bundles) ──

export interface ProbeWorldReport {
  world_server_id: number;
  short_name: string;
  results: Array<{ client: ClientId; status: ProbeStatus; detail: string; ms: number }>;
}

export interface ProbeRunReport {
  trigger: string;
  started_at: string;
  finished_at: string | null;
  worlds: ProbeWorldReport[];
  skipped: Array<{ short_name: string; reason: string }>;
  error: string | null;
}

interface ProbeState {
  running: boolean;
  last: ProbeRunReport | null;
}

const g = globalThis as unknown as { __clientProbeState?: ProbeState };
function state(): ProbeState {
  if (!g.__clientProbeState) g.__clientProbeState = { running: false, last: null };
  return g.__clientProbeState;
}

export function getProbeState(): { running: boolean; last: ProbeRunReport | null } {
  const s = state();
  return { running: s.running, last: s.last };
}

// ── Probe account ──

/**
 * The probe logs in as one dedicated loginserver account. The master creates
 * it through the loginserver API (random password nobody knows, source
 * "local"); federation sync then copies it to peers with the same id, so a
 * peer only waits for it rather than creating a second one.
 */
export async function ensureProbeAccount(): Promise<{ id: number } | { error: string }> {
  const find = async () => {
    const [rows] = await pool.execute(
      `SELECT id FROM login_accounts WHERE account_name = ? AND source_loginserver = ? LIMIT 1`,
      [PROBE_ACCOUNT_NAME, PROBE_ACCOUNT_SOURCE]
    );
    const list = rows as Array<{ id: number }>;
    return list.length > 0 ? Number(list[0].id) : 0;
  };

  const existing = await find();
  if (existing) return { id: existing };

  try {
    const { getSelfNode } = await import("@/lib/federation/node");
    const self = await getSelfNode();
    if (self && !self.isMaster) {
      return { error: `probe account ${PROBE_ACCOUNT_NAME} has not been synced from the master yet` };
    }
  } catch {
    // no federation tables: standalone node, create locally
  }

  const password = crypto.randomBytes(24).toString("base64");
  const created = await createAccount(PROBE_ACCOUNT_NAME, password);
  if (created.ok && created.data?.data?.account_id) {
    console.log(`[client-probe] created probe account ${PROBE_ACCOUNT_NAME} (id ${created.data.data.account_id})`);
    return { id: Number(created.data.data.account_id) };
  }
  // A concurrent create, or the API refused: look again before giving up.
  const again = await find();
  if (again) return { id: again };
  return { error: `could not create probe account: ${created.error || "unknown error"}` };
}

// ── Worlds ──

interface ProbeTarget {
  worldServerId: number;
  shortName: string;
  host: string;
}

function isPrivateIPv4(ip: string): boolean {
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(ip);
}

/** Pick the address a player outside the world's LAN would use. */
function pickHost(s: ServerListItem): string {
  const remote = (s.remote_ip || "").trim();
  const local = (s.local_ip || "").trim();
  if (remote && !isPrivateIPv4(remote)) return remote;
  return remote || local;
}

async function getTargets(onlyWorldId?: number): Promise<{ targets: ProbeTarget[]; skipped: ProbeRunReport["skipped"] }> {
  const res = await getServerList();
  if (!res.ok || !Array.isArray(res.data)) {
    throw new Error(`loginserver server list unavailable: ${res.error || "bad response"}`);
  }
  const live = dedupeLiveServers(res.data);
  const optedOut = await getOptedOutWorldIds();
  const targets: ProbeTarget[] = [];
  const skipped: ProbeRunReport["skipped"] = [];
  const seen = new Set<number>();

  for (const s of live) {
    const id = Number(s.world_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (onlyWorldId && id !== onlyWorldId) continue;
    const shortName = String(s.server_short_name || "");
    if (optedOut.has(id)) { skipped.push({ short_name: shortName, reason: "opted out" }); continue; }
    const host = pickHost(s);
    if (!host || host === "0.0.0.0") { skipped.push({ short_name: shortName, reason: "no address" }); continue; }
    targets.push({ worldServerId: id, shortName, host });
  }
  return { targets, skipped };
}

// ── Running ──

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** A session key like the loginserver's own (10 characters, A-Z0-9). */
function generateKey(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
  const bytes = crypto.randomBytes(10);
  let key = "";
  for (let i = 0; i < 10; i++) key += alphabet[bytes[i] % alphabet.length];
  return key;
}

async function probeOneWorld(target: ProbeTarget, accountId: number, clients: ClientDef[]): Promise<ProbeWorldReport> {
  const report: ProbeWorldReport = { world_server_id: target.worldServerId, short_name: target.shortName, results: [] };
  let unreachable = false;

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    let status: ProbeStatus;
    let detail: string;
    let ms = 0;

    if (unreachable) {
      // The first client got no session response; do not knock six more times.
      status = "unreachable";
      detail = "skipped: world did not answer the first client";
    } else {
      const key = generateKey();
      const auth = await sendClientAuth({
        serverId: target.worldServerId,
        accountId,
        accountName: PROBE_ACCOUNT_NAME,
        loginKey: key,
        loginserverName: PROBE_ACCOUNT_SOURCE,
      });
      if (!auth.ok) {
        status = "error";
        detail = `loginserver did not send the session key: ${(auth.error || "").slice(0, 120)}`;
      } else {
        await sleep(AUTH_DELIVERY_WAIT_MS);
        try {
          const r = await probeWorldClient({
            host: target.host,
            port: WORLD_UDP_PORT,
            client,
            loginserverAccountId: accountId,
            key,
          });
          status = r.status;
          detail = r.detail;
          ms = r.durationMs;
          if (status === "unreachable" && i === 0) unreachable = true;
        } catch (err) {
          status = "error";
          detail = `probe failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    report.results.push({ client: client.id, status, detail, ms });
    try {
      await saveProbeResult(target.worldServerId, client.id, status, detail);
    } catch (err) {
      console.error(`[client-probe] could not store result for ${target.shortName}/${client.id}:`, err);
    }
    if (!unreachable && i < clients.length - 1) await sleep(PAUSE_BETWEEN_CLIENTS_MS);
  }
  return report;
}

/**
 * Run one probe cycle. Returns null when a cycle is already running.
 * `worldServerId` limits the run to one world (admin "probe now").
 */
export async function runProbeCycle(opts: { trigger: string; worldServerId?: number }): Promise<ProbeRunReport | null> {
  const s = state();
  if (s.running) return null;
  s.running = true;

  const report: ProbeRunReport = {
    trigger: opts.trigger,
    started_at: new Date().toISOString(),
    finished_at: null,
    worlds: [],
    skipped: [],
    error: null,
  };
  s.last = report;

  try {
    const account = await ensureProbeAccount();
    if ("error" in account) throw new Error(account.error);

    const { targets, skipped } = await getTargets(opts.worldServerId);
    report.skipped = skipped;
    const clients = probeClients();
    console.log(`[client-probe] ${opts.trigger}: probing ${targets.length} world(s) x ${clients.length} client(s)`);

    for (let i = 0; i < targets.length; i++) {
      const w = await probeOneWorld(targets[i], account.id, clients);
      report.worlds.push(w);
      const summary = w.results.map((r) => `${r.client}=${r.status}`).join(" ");
      console.log(`[client-probe] ${targets[i].shortName}: ${summary}`);
      if (i < targets.length - 1) await sleep(PAUSE_BETWEEN_WORLDS_MS);
    }
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    console.error(`[client-probe] ${opts.trigger} failed: ${report.error}`);
  } finally {
    report.finished_at = new Date().toISOString();
    s.running = false;
  }
  return report;
}
