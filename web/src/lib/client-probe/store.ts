/**
 * Storage for client probe results (migration 013) and the public summary
 * shown in the server directory. Every read tolerates the tables being
 * absent (node not migrated yet): it then reports "not checked yet".
 */
import { pool } from "@/lib/db";
import { CLIENTS, ClientId, getClient } from "./clients";
import type { ProbeStatus } from "./classify";

export interface ClientSupportRow {
  world_server_id: number;
  client: string;
  status: ProbeStatus;
  detail: string;
  last_checked: Date;
  last_supported_at: Date | null;
}

/** What the public pages get per world. null = never probed. */
export interface ClientSupportSummary {
  /** ISO time of the most recent probe of this world. */
  checked_at: string;
  /** Clients that reach character select, in client release order. */
  supported: ClientId[];
  /** Clients the world recognizes but turns away by rule. */
  blocked: ClientId[];
  /** True when the last probe could not reach the world at all. */
  unreachable: boolean;
}

/**
 * A client that was supported recently stays shown as supported through a
 * transient failure (world restarting, packet loss) for this long.
 */
const SUPPORTED_GRACE_MS = 24 * 60 * 60 * 1000;

export async function saveProbeResult(
  worldServerId: number,
  client: ClientId,
  status: ProbeStatus,
  detail: string
): Promise<void> {
  await pool.execute(
    `INSERT INTO world_client_support (world_server_id, client, status, detail, last_checked, last_supported_at)
     VALUES (?, ?, ?, ?, NOW(), IF(? = 'supported', NOW(), NULL))
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       detail = VALUES(detail),
       last_checked = VALUES(last_checked),
       last_supported_at = IF(VALUES(status) = 'supported', VALUES(last_checked), last_supported_at)`,
    [worldServerId, client, status, detail.slice(0, 255), status]
  );
}

export async function getAllProbeRows(): Promise<ClientSupportRow[]> {
  try {
    const [rows] = await pool.query(
      `SELECT world_server_id, client, status, detail, last_checked, last_supported_at FROM world_client_support`
    );
    return rows as ClientSupportRow[];
  } catch {
    return [];
  }
}

export async function getProbeRowsForWorld(worldServerId: number): Promise<ClientSupportRow[]> {
  try {
    const [rows] = await pool.execute(
      `SELECT world_server_id, client, status, detail, last_checked, last_supported_at
         FROM world_client_support WHERE world_server_id = ?`,
      [worldServerId]
    );
    return rows as ClientSupportRow[];
  } catch {
    return [];
  }
}

/** Most recent probe time over all worlds, or null. */
export async function getLastProbeTime(): Promise<Date | null> {
  try {
    const [rows] = await pool.query(`SELECT MAX(last_checked) AS t FROM world_client_support`);
    const t = (rows as Array<{ t: Date | null }>)[0]?.t;
    return t ? new Date(t) : null;
  } catch {
    return null;
  }
}

export async function getOptedOutWorldIds(): Promise<Set<number>> {
  try {
    const [rows] = await pool.query(`SELECT world_server_id FROM world_client_probe_optout`);
    return new Set((rows as Array<{ world_server_id: number }>).map((r) => Number(r.world_server_id)));
  } catch {
    return new Set();
  }
}

export async function setWorldOptOut(worldServerId: number, optOut: boolean, note = ""): Promise<void> {
  if (optOut) {
    await pool.execute(
      `INSERT INTO world_client_probe_optout (world_server_id, note) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE note = VALUES(note)`,
      [worldServerId, note.slice(0, 255)]
    );
  } else {
    await pool.execute(`DELETE FROM world_client_probe_optout WHERE world_server_id = ?`, [worldServerId]);
  }
}

/** Fold one world's rows into the public summary. */
export function summarize(rows: ClientSupportRow[], now = Date.now()): ClientSupportSummary | null {
  const known = rows.filter((r) => getClient(r.client));
  if (known.length === 0) return null;

  let checked = 0;
  const byClient = new Map<string, ClientSupportRow>();
  for (const r of known) {
    byClient.set(r.client, r);
    const t = new Date(r.last_checked).getTime();
    if (t > checked) checked = t;
  }

  const supported: ClientId[] = [];
  const blocked: ClientId[] = [];
  let reached = false;
  for (const c of CLIENTS) {
    const r = byClient.get(c.id);
    if (!r) continue;
    if (r.status !== "unreachable") reached = true;
    const recentlySupported =
      r.last_supported_at !== null && now - new Date(r.last_supported_at).getTime() < SUPPORTED_GRACE_MS;
    if (r.status === "supported" || ((r.status === "error" || r.status === "unreachable") && recentlySupported)) {
      supported.push(c.id);
    } else if (r.status === "blocked") {
      blocked.push(c.id);
    }
  }

  return {
    checked_at: new Date(checked).toISOString(),
    supported,
    blocked,
    unreachable: !reached && supported.length === 0,
  };
}

/** world_server_id -> summary, for every probed world. */
export async function getClientSupportSummaries(): Promise<Map<number, ClientSupportSummary>> {
  const rows = await getAllProbeRows();
  const grouped = new Map<number, ClientSupportRow[]>();
  for (const r of rows) {
    const id = Number(r.world_server_id);
    const list = grouped.get(id);
    if (list) list.push(r);
    else grouped.set(id, [r]);
  }
  const out = new Map<number, ClientSupportSummary>();
  grouped.forEach((list, id) => {
    const s = summarize(list);
    if (s) out.set(id, s);
  });
  return out;
}

export async function getClientSupportSummary(worldServerId: number): Promise<ClientSupportSummary | null> {
  return summarize(await getProbeRowsForWorld(worldServerId));
}
