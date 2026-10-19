/**
 * Node status reporting (web 1.7.0+, federation protocol 2).
 *
 * Each node includes {software_version, federation_protocol, updater_status}
 * in the heartbeat it sends; the receiver stores it on that peer's
 * federation_nodes row. `updater_status` comes from the host updater's status
 * file, mounted read-only into the web container.
 *
 * The master also publishes desired versions per channel in its heartbeat
 * response; peers store them as master_desired_version_* in their own config.
 * Nothing here executes anything: the master can only publish numbers.
 */
import { promises as fs } from "fs";
import { pool } from "@/lib/db";
import { APP_VERSION, FEDERATION_PROTOCOL, normalizeVersion } from "@/lib/version";
import { getSelfNode, getConfigValue, setConfig, auditLog } from "./node";

export const UPDATER_STATUS_PATH =
  process.env.UPDATER_STATUS_PATH || "/host-state/updater-status.json";
const MAX_STATUS_FILE_BYTES = 16 * 1024;

const LAST_RESULTS = new Set(["ok", "up_to_date", "failed", "rolled_back", "needs_operator"]);
const CHANNELS = new Set(["stable", "canary"]);

export interface UpdaterStatus {
  version: string | null;
  previous_version: string | null;
  channel: string | null;
  auto: boolean | null;
  last_check_at: string | null;
  last_result: string | null;
  last_error: string | null;
  pending_version: string | null;
  images: { web: string | null; loginserver: string | null; "upgrade-agent": string | null } | null;
  schema_version: string | null;
  updated_at: string | null;
}

export interface NodeStatusReport {
  software_version: string;
  federation_protocol: number;
  updater_status: UpdaterStatus | null;
}

function str(v: unknown, max = 64): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function digest(v: unknown): string | null {
  const s = str(v, 100);
  return s && /^[A-Za-z0-9:._-]+$/.test(s) ? s : null;
}

/**
 * Validate an updater status document (from the local file or from a peer)
 * down to the known schema. Unknown keys are dropped, strings are capped.
 */
export function sanitizeUpdaterStatus(raw: unknown): UpdaterStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const lastResult = str(r.last_result, 32);
  const channel = str(r.channel, 16);
  const imgs = r.images && typeof r.images === "object" && !Array.isArray(r.images)
    ? (r.images as Record<string, unknown>)
    : null;
  return {
    version: normalizeVersion(str(r.version)),
    previous_version: normalizeVersion(str(r.previous_version)),
    channel: channel && CHANNELS.has(channel) ? channel : null,
    auto: typeof r.auto === "boolean" ? r.auto : r.auto === "true" ? true : r.auto === "false" ? false : null,
    last_check_at: str(r.last_check_at, 40),
    last_result: lastResult && LAST_RESULTS.has(lastResult) ? lastResult : null,
    last_error: str(r.last_error, 500),
    pending_version: normalizeVersion(str(r.pending_version)),
    images: imgs
      ? { web: digest(imgs.web), loginserver: digest(imgs.loginserver), "upgrade-agent": digest(imgs["upgrade-agent"]) }
      : null,
    schema_version: str(r.schema_version, 64),
    updated_at: str(r.updated_at, 40),
  };
}

/** Read this host's updater status file. Absent or unreadable → null. */
export async function readUpdaterStatus(): Promise<UpdaterStatus | null> {
  try {
    const st = await fs.stat(UPDATER_STATUS_PATH);
    if (!st.isFile() || st.size > MAX_STATUS_FILE_BYTES) return null;
    const text = await fs.readFile(UPDATER_STATUS_PATH, "utf8");
    return sanitizeUpdaterStatus(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The status block this node sends in its heartbeat. */
export async function buildLocalStatus(): Promise<NodeStatusReport> {
  return {
    software_version: APP_VERSION,
    federation_protocol: FEDERATION_PROTOCOL,
    updater_status: await readUpdaterStatus(),
  };
}

let statusColumnsMissing = false;
let statusColumnsWarned = false;

function isUnknownColumn(err: unknown): boolean {
  const e = err as { errno?: number; code?: string };
  return e?.errno === 1054 || e?.code === "ER_BAD_FIELD_ERROR";
}

function warnMissingColumns() {
  if (statusColumnsWarned) return;
  statusColumnsWarned = true;
  console.warn("[federation] federation_nodes status columns missing — apply migrations/012_federation_node_status.sql");
}

/**
 * Store a node's reported status on its federation_nodes row. Works before
 * migration 012 is applied (only software_version is stored then).
 */
export async function storeNodeStatus(
  nodeId: number,
  report: { software_version?: unknown; federation_protocol?: unknown; updater_status?: unknown }
): Promise<void> {
  const version = normalizeVersion(str(report.software_version));
  const protoNum = Number(report.federation_protocol);
  const protocol = Number.isInteger(protoNum) && protoNum > 0 && protoNum < 1000 ? protoNum : null;
  const updater = sanitizeUpdaterStatus(report.updater_status);

  if (!statusColumnsMissing) {
    try {
      await pool.execute(
        `UPDATE federation_nodes
            SET software_version = COALESCE(?, software_version),
                federation_protocol = ?,
                updater_status = ?,
                last_status_at = NOW()
          WHERE id = ?`,
        [version, protocol, updater ? JSON.stringify(updater) : null, nodeId]
      );
      return;
    } catch (err) {
      if (!isUnknownColumn(err)) throw err;
      statusColumnsMissing = true;
      warnMissingColumns();
    }
  }
  if (version) {
    await pool.execute(`UPDATE federation_nodes SET software_version = ? WHERE id = ?`, [version, nodeId]);
  }
}

/** Refresh this node's own (is_self = 1) row with its current version/status. */
export async function updateSelfStatus(): Promise<void> {
  const self = await getSelfNode();
  if (!self) return;
  await storeNodeStatus(self.id, await buildLocalStatus());
}

export interface NodeStatusRow {
  id: number;
  updaterStatus: UpdaterStatus | null;
  federationProtocol: number | null;
  lastStatusAt: Date | null;
}

/** Read the status columns for all nodes (empty map before migration 012). */
export async function getNodeStatusRows(): Promise<Map<number, NodeStatusRow>> {
  const out = new Map<number, NodeStatusRow>();
  if (statusColumnsMissing) return out;
  try {
    const [rows] = await pool.execute(
      `SELECT id, updater_status, federation_protocol, last_status_at FROM federation_nodes`
    ) as unknown as [Array<{ id: number; updater_status: string | null; federation_protocol: number | null; last_status_at: Date | null }>];
    for (const r of rows) {
      let parsed: UpdaterStatus | null = null;
      if (r.updater_status) {
        try { parsed = sanitizeUpdaterStatus(JSON.parse(r.updater_status)); } catch {}
      }
      out.set(r.id, {
        id: r.id,
        updaterStatus: parsed,
        federationProtocol: r.federation_protocol,
        lastStatusAt: r.last_status_at,
      });
    }
  } catch (err) {
    if (isUnknownColumn(err)) {
      statusColumnsMissing = true;
      warnMissingColumns();
    } else {
      throw err;
    }
  }
  return out;
}

// ── Desired versions ──

export type Channel = "stable" | "canary";

async function configVersion(key: string): Promise<{ value: string | null; updatedAt: Date | null }> {
  const row = await getConfigValue(key);
  if (!row) return { value: null, updatedAt: null };
  const v = typeof row.value === "string" ? row.value : row.value == null ? null : String(row.value);
  return { value: normalizeVersion(v), updatedAt: row.updatedAt };
}

function latest(...dates: Array<Date | null>): Date | null {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || new Date(d).getTime() > new Date(best).getTime())) best = new Date(d);
  return best;
}

/** What this node publishes (master) or has set as a local override (peer). */
export async function getOwnDesiredVersions() {
  const [stable, canary] = await Promise.all([
    configVersion("desired_version_stable"),
    configVersion("desired_version_canary"),
  ]);
  return { stable: stable.value, canary: canary.value, updatedAt: latest(stable.updatedAt, canary.updatedAt) };
}

/** The values this node last received from its master. */
export async function getMasterDesiredVersions() {
  const [stable, canary, at] = await Promise.all([
    configVersion("master_desired_version_stable"),
    configVersion("master_desired_version_canary"),
    getConfigValue("master_desired_updated_at"),
  ]);
  const atValue = typeof at?.value === "string" ? new Date(at.value) : null;
  return {
    stable: stable.value,
    canary: canary.value,
    updatedAt: atValue && !isNaN(atValue.getTime()) ? atValue : latest(stable.updatedAt, canary.updatedAt),
  };
}

/**
 * Effective desired versions for this node's updater.
 * Master: its own published values. Peer: a local override if the operator set
 * one, otherwise the master's published values.
 */
export async function getEffectiveDesiredVersions(): Promise<{
  desired_version_stable: string | null;
  desired_version_canary: string | null;
  source: "self" | "master";
  updated_at: string | null;
}> {
  const self = await getSelfNode();
  const own = await getOwnDesiredVersions();
  if (self?.isMaster || own.stable || own.canary) {
    return {
      desired_version_stable: own.stable,
      desired_version_canary: own.canary,
      source: "self",
      updated_at: own.updatedAt ? own.updatedAt.toISOString() : null,
    };
  }
  const m = await getMasterDesiredVersions();
  return {
    desired_version_stable: m.stable,
    desired_version_canary: m.canary,
    source: "master",
    updated_at: m.updatedAt ? m.updatedAt.toISOString() : null,
  };
}

/** Set (or clear with null) this node's desired version for a channel. */
export async function setOwnDesiredVersion(channel: Channel, version: string | null): Promise<void> {
  await setConfig(`desired_version_${channel}`, version ?? "");
}

/** Store desired versions received from the master's heartbeat response (only on change). */
export async function storeMasterDesired(
  masterNodeId: number,
  stableRaw: unknown,
  canaryRaw: unknown,
  updatedAtRaw: unknown
): Promise<void> {
  const stable = normalizeVersion(typeof stableRaw === "string" ? stableRaw : null);
  const canary = normalizeVersion(typeof canaryRaw === "string" ? canaryRaw : null);
  const current = await getMasterDesiredVersions();
  if (current.stable === stable && current.canary === canary) return;
  await setConfig("master_desired_version_stable", stable ?? "");
  await setConfig("master_desired_version_canary", canary ?? "");
  const at = typeof updatedAtRaw === "string" && !isNaN(new Date(updatedAtRaw).getTime())
    ? new Date(updatedAtRaw).toISOString()
    : new Date().toISOString();
  await setConfig("master_desired_updated_at", at);
  await auditLog(masterNodeId, "master_desired_version_received", { stable, canary, updated_at: at });
  console.log(`[federation] master desired versions: stable=${stable || "-"} canary=${canary || "-"}`);
}
