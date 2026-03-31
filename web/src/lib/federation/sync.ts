/**
 * Federation sync engine — pulls data changes from peers and applies them locally
 * with origin authority rules.
 */
import { db, pool } from "@/lib/db";
import {
  federationNodes,
  federationChangelog,
  federationOriginMap,
  loginAccounts,
  loginWorldServers,
  loginServerAdmins,
  serverProfiles,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { federationGet } from "./client";
import { getSelfNode, getActivePeers, updatePeerSyncSeq, auditLog } from "./node";
import { getLatestSeq, pruneChangelog, pruneAuditLog } from "./changelog";

const SYNCED_TABLES = new Set([
  "login_accounts",
  "login_world_servers",
  "login_server_admins",
  "server_profiles",
]);

// Column whitelists — only these columns are allowed in sync payloads.
// Sensitive columns (private keys, tokens) are explicitly excluded.
const ALLOWED_COLUMNS: Record<string, Set<string>> = {
  login_accounts: new Set([
    "id", "account_name", "account_password", "account_email",
    "source_loginserver", "last_login_date",
    "created_at", "updated_at",
  ]),
  login_world_servers: new Set([
    "id", "long_name", "short_name", "tag_description",
    "login_server_list_type_id", "last_login_date", "last_ip_address",
    "login_server_admin_id", "is_server_trusted", "note",
  ]),
  login_server_admins: new Set([
    "id", "account_name", "account_password", "first_name",
    "last_name", "email", "registration_date",
  ]),
  server_profiles: new Set([
    "id", "world_server_id", "server_description", "server_banner_url",
    "server_rules", "server_website", "server_discord",
    "tags", "claimed_by_admin_id", "created_at", "updated_at",
  ]),
};

const VALID_COLUMN_RE = /^[a-z_][a-z0-9_]{0,63}$/;

/** Validate and filter payload columns against the whitelist. */
function sanitizePayload(
  tableName: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const allowed = ALLOWED_COLUMNS[tableName];
  if (!allowed) return {};

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (allowed.has(key) && VALID_COLUMN_RE.test(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

interface ChangeEntry {
  id: number;
  table_name: string;
  row_id: number;
  operation: "insert" | "update" | "delete";
  origin_node_id: number;
  payload: Record<string, unknown>;
  created_at: string;
}

interface HeartbeatResponse {
  node_id: number;
  name: string;
  public_key: string;
  is_master: boolean;
  latest_seq: number;
  latest_config_version: number;
  software_version?: string;
  timestamp: number;
}

interface ChangesResponse {
  changes: ChangeEntry[];
  latest_seq: number;
}

interface SyncDataResponse {
  node_id: number;
  accounts: Array<Record<string, unknown>>;
  servers: Array<Record<string, unknown>>;
  admins: Array<Record<string, unknown>>;
  profiles: Array<Record<string, unknown>>;
  live_servers: Array<Record<string, unknown>>;
  timestamp: number;
}

/** Cached live server data from federation peers — keyed by source node ID. */
const federatedLiveCache = new Map<number, { data: Array<Record<string, unknown>>; expires: number }>();
const LIVE_CACHE_TTL_MS = 90_000; // 90 seconds (sync runs every 60s)

/** Get cached live servers from all federation peers. */
export function getFederatedLiveServers(): Array<Record<string, unknown>> {
  const now = Date.now();
  const all: Array<Record<string, unknown>> = [];
  federatedLiveCache.forEach((entry, nodeId) => {
    if (now < entry.expires) {
      all.push(...entry.data);
    } else {
      federatedLiveCache.delete(nodeId);
    }
  });
  return all;
}

/** Run a single sync cycle: pull changes from all active peers. */
export async function runSyncCycle(): Promise<{
  peersChecked: number;
  changesApplied: number;
  errors: string[];
}> {
  const self = await getSelfNode();
  if (!self) return { peersChecked: 0, changesApplied: 0, errors: ["Not initialized"] };

  const peers = await getActivePeers();
  let changesApplied = 0;
  const errors: string[] = [];

  for (const peer of peers) {
    try {
      // Skip pulling from mesh-tier peers — they are read-only consumers
      if (peer.nodeTier === "mesh") continue;

      // Heartbeat first
      const hb = await federationGet<HeartbeatResponse>(
        peer.endpointUrl,
        "/api/federation/heartbeat",
        peer.tlsCertHash
      );

      if (!hb.ok || !hb.data) {
        errors.push(`${peer.name}: heartbeat failed — ${hb.error}`);
        continue;
      }

      // Store peer's reported software version
      if (hb.data.software_version) {
        const { updatePeerVersion } = await import("./node");
        await updatePeerVersion(peer.id, hb.data.software_version);
      }

      // Pull changes since our last known seq for this peer
      const sinceSeq = peer.lastSyncSeq || 0;
      if (hb.data.latest_seq <= sinceSeq) {
        // Even if no changelog changes, still do full data sync
      } else {
        const changesRes = await federationGet<ChangesResponse>(
          peer.endpointUrl,
          `/api/federation/changes?since=${sinceSeq}&limit=500`,
          peer.tlsCertHash
        );

        if (!changesRes.ok || !changesRes.data?.changes) {
          errors.push(`${peer.name}: pull changes failed — ${changesRes.error}`);
        } else {
          let maxSeq = sinceSeq;

          for (const change of changesRes.data.changes) {
            if (!SYNCED_TABLES.has(change.table_name)) continue;

            // Origin authority: only apply inserts from any node,
            // updates/deletes only from the origin node
            if (change.operation !== "insert") {
              const isOrigin = await isOriginNode(change.table_name, change.row_id, change.origin_node_id);
              if (!isOrigin) {
                await auditLog(peer.id, "origin_authority_rejected", {
                  table: change.table_name,
                  rowId: change.row_id,
                  operation: change.operation,
                  originNodeId: change.origin_node_id,
                });
                if (change.id > maxSeq) maxSeq = change.id;
                continue;
              }
            }

            try {
              await applyChange(change);
              changesApplied++;
            } catch (err) {
              errors.push(`${peer.name}: apply ${change.table_name}#${change.row_id} failed — ${err}`);
            }

            if (change.id > maxSeq) maxSeq = change.id;
          }

          // Update our cursor for this peer
          if (maxSeq > sinceSeq) {
            await updatePeerSyncSeq(peer.id, maxSeq);
          }
        }
      }

      // Full loginserver data sync — pull all accounts, servers, admins from this peer
      try {
        const syncData = await federationGet<SyncDataResponse>(
          peer.endpointUrl,
          "/api/federation/sync_data",
          peer.tlsCertHash
        );

        if (syncData.ok && syncData.data) {
          const applied = await applyFullDataSync(syncData.data, peer.id);
          changesApplied += applied;
        } else {
          errors.push(`${peer.name}: sync_data failed — ${syncData.error}`);
        }
      } catch (err) {
        errors.push(`${peer.name}: sync_data error — ${err instanceof Error ? err.message : String(err)}`);
      }

      // Update last sync timestamp
      await updatePeerSyncSeq(peer.id, peer.lastSyncSeq || 0);
    } catch (err) {
      errors.push(`${peer.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Prune old changelog entries that all peers have already synced past
  try {
    await pruneChangelog(7); // 7-day minimum retention
  } catch (err) {
    errors.push(`changelog prune failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Prune old audit log entries (90-day retention)
  try {
    await pruneAuditLog(90);
  } catch (err) {
    errors.push(`audit prune failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { peersChecked: peers.length, changesApplied, errors };
}

/** Convert ISO 8601 string or Date to MySQL datetime format (YYYY-MM-DD HH:MM:SS) */
function toMySQLDatetime(val: unknown): string {
  if (!val) return new Date().toISOString().slice(0, 19).replace("T", " ");
  const d = new Date(val as string);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 19).replace("T", " ");
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** Apply full loginserver data from a peer — upsert accounts, servers, admins. */
async function applyFullDataSync(data: SyncDataResponse, sourceNodeId: number): Promise<number> {
  const conn = await pool.getConnection();
  let applied = 0;

  try {
    // Upsert login_accounts — match on unique key (source_loginserver, account_name)
    // Don't include id — let auto-increment handle it so local IDs don't conflict
    for (const acct of data.accounts) {
      try {
        await conn.execute(
          `INSERT INTO login_accounts (account_name, account_password, account_email, source_loginserver, last_login_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             account_password = VALUES(account_password),
             account_email = VALUES(account_email),
             last_login_date = VALUES(last_login_date),
             updated_at = VALUES(updated_at)`,
          [
            acct.account_name, acct.account_password, acct.account_email || "",
            acct.source_loginserver || "local",
            toMySQLDatetime(acct.last_login_date),
            toMySQLDatetime(acct.created_at),
            toMySQLDatetime(acct.updated_at),
          ] as string[]
        );
        applied++;
      } catch (err) {
        console.error(`[sync_data] account upsert error for ${acct.account_name}:`, err);
      }
    }

    // Delete old synced servers from this source, then insert fresh
    await conn.execute(
      `DELETE FROM login_world_servers WHERE federation_source_node_id = ?`,
      [sourceNodeId]
    );

    for (const srv of data.servers) {
      try {
        await conn.execute(
          `INSERT INTO login_world_servers (long_name, short_name, tag_description, login_server_list_type_id, last_login_date, login_server_admin_id, is_server_trusted, note, federation_source_node_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            srv.long_name, srv.short_name, srv.tag_description || "",
            srv.login_server_list_type_id || 1, toMySQLDatetime(srv.last_login_date),
            srv.login_server_admin_id || 0, srv.is_server_trusted || 0,
            srv.note || null, sourceNodeId,
          ] as (string | number | null)[]
        );
        applied++;
      } catch (err) {
        console.error(`[sync_data] server upsert error for ${srv.short_name}:`, err);
      }
    }

    // Delete old synced admins from this source, then insert fresh
    await conn.execute(
      `DELETE FROM login_server_admins WHERE federation_source_node_id = ?`,
      [sourceNodeId]
    );

    for (const adm of data.admins) {
      try {
        await conn.execute(
          `INSERT INTO login_server_admins (account_name, account_password, first_name, last_name, email, registration_date, registration_ip_address, federation_source_node_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            adm.account_name, adm.account_password || "",
            adm.first_name || "", adm.last_name || "", adm.email || "",
            toMySQLDatetime(adm.registration_date), "", sourceNodeId,
          ] as (string | number)[]
        );
        applied++;
      } catch (err) {
        console.error(`[sync_data] admin upsert error for ${adm.account_name}:`, err);
      }
    }

    // Upsert server profiles — match by short_name to find local server ID
    const profileCount = data.profiles?.length || 0;
    if (data.profiles && data.profiles.length > 0) {
      for (const prof of data.profiles) {
        try {
          // Find the local server by short_name (synced from this federation source)
          const [rows] = await conn.execute(
            `SELECT id FROM login_world_servers WHERE short_name = ? AND federation_source_node_id = ? LIMIT 1`,
            [prof.short_name as string, sourceNodeId] as (string | number)[]
          ) as unknown as [Array<{ id: number }>];

          if (rows.length > 0) {
            const localServerId = rows[0].id;
            await conn.execute(
              `INSERT INTO server_profiles (world_server_id, description, website_url, discord_url, banner_image_url, expansion_era, custom_ruleset, tags, display_tier, show_player_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE
                 description = VALUES(description),
                 website_url = VALUES(website_url),
                 discord_url = VALUES(discord_url),
                 banner_image_url = VALUES(banner_image_url),
                 expansion_era = VALUES(expansion_era),
                 custom_ruleset = VALUES(custom_ruleset),
                 tags = VALUES(tags),
                 display_tier = VALUES(display_tier),
                 show_player_count = VALUES(show_player_count),
                 updated_at = NOW()`,
              [
                localServerId,
                prof.description || null,
                prof.website_url || null,
                prof.discord_url || null,
                prof.banner_image_url || null,
                prof.expansion_era || null,
                prof.custom_ruleset || null,
                prof.tags ? JSON.stringify(prof.tags) : null,
                prof.display_tier || null,
                prof.show_player_count ?? 1,
              ] as (string | number | null)[]
            );
            applied++;
          }
        } catch (err) {
          console.error(`[sync_data] profile upsert error for ${prof.short_name}:`, err);
        }
      }
    }

    // Cache live server data for the servers API
    if (data.live_servers && data.live_servers.length > 0) {
      federatedLiveCache.set(sourceNodeId, {
        data: data.live_servers,
        expires: Date.now() + LIVE_CACHE_TTL_MS,
      });
    }

    console.log(`[sync_data] Applied ${applied} records from node ${sourceNodeId}: ${data.accounts.length} accounts, ${data.servers.length} servers, ${data.admins.length} admins, ${profileCount} profiles, ${data.live_servers?.length || 0} live`);
  } finally {
    conn.release();
  }

  return applied;
}

/** Check if a change came from the origin node for a given record. */
async function isOriginNode(
  tableName: string,
  rowId: number,
  claimedOriginNodeId: number
): Promise<boolean> {
  // Primary: check origin map (authoritative, survives changelog pruning)
  const mapRows = await db
    .select({ originNodeId: federationOriginMap.originNodeId })
    .from(federationOriginMap)
    .where(
      and(
        eq(federationOriginMap.tableName, tableName),
        eq(federationOriginMap.rowId, rowId)
      )
    )
    .limit(1);

  if (mapRows.length > 0) {
    return mapRows[0].originNodeId === claimedOriginNodeId;
  }

  // Fallback: check changelog for the original insert
  const logRows = await db
    .select({ originNodeId: federationChangelog.originNodeId })
    .from(federationChangelog)
    .where(
      sql`${federationChangelog.tableName} = ${tableName}
        AND ${federationChangelog.rowId} = ${rowId}
        AND ${federationChangelog.operation} = 'insert'`
    )
    .orderBy(federationChangelog.id)
    .limit(1);

  if (logRows.length > 0) {
    // Backfill origin map for future lookups
    await db.insert(federationOriginMap).values({
      tableName,
      rowId,
      originNodeId: logRows[0].originNodeId,
      createdAt: new Date(),
    }).onDuplicateKeyUpdate({ set: { originNodeId: logRows[0].originNodeId } });
    return logRows[0].originNodeId === claimedOriginNodeId;
  }

  // Last resort: assume local ownership for records with no provenance
  const self = await getSelfNode();
  if (claimedOriginNodeId === self?.id) return true;

  // Record is unknown — reject the claim to be safe
  return false;
}

/** Record origin ownership for a row. Called on inserts. */
async function recordOrigin(tableName: string, rowId: number, originNodeId: number) {
  await db.insert(federationOriginMap).values({
    tableName,
    rowId,
    originNodeId,
    createdAt: new Date(),
  }).onDuplicateKeyUpdate({ set: { originNodeId } });
}

/** Apply a single change to the local database. */
async function applyChange(change: ChangeEntry) {
  const { table_name, row_id, operation, payload, origin_node_id } = change;

  // Defense-in-depth: re-check table whitelist
  if (!SYNCED_TABLES.has(table_name)) {
    throw new Error(`Table ${table_name} not in sync whitelist`);
  }

  // Sanitize payload columns against per-table whitelist
  const safePayload = sanitizePayload(table_name, payload);

  switch (operation) {
    case "insert":
      await applyInsert(table_name, row_id, safePayload);
      // Record origin ownership so future updates/deletes can be verified
      await recordOrigin(table_name, row_id, origin_node_id);
      break;
    case "update":
      await applyUpdate(table_name, row_id, safePayload);
      break;
    case "delete":
      // Deletes are NOT applied from remote nodes (origin authority).
      // This is a safety net — we already filter in the caller.
      break;
  }

  // Record in our own changelog so we don't re-sync it back
  await db.insert(federationChangelog).values({
    tableName: table_name,
    rowId: row_id,
    operation,
    originNodeId: origin_node_id,
    payload: safePayload,
    createdAt: new Date(),
  });
}

async function applyInsert(tableName: string, rowId: number, payload: Record<string, unknown>) {
  const conn = await pool.getConnection();
  try {
    const columns = Object.keys(payload);
    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map((c) => payload[c]);
    const colNames = columns.map((c) => `\`${c}\``).join(", ");

    await conn.execute(
      `INSERT IGNORE INTO \`${tableName}\` (${colNames}) VALUES (${placeholders})`,
      values as (string | number | null)[]
    );
  } finally {
    conn.release();
  }
}

async function applyUpdate(tableName: string, rowId: number, payload: Record<string, unknown>) {
  const conn = await pool.getConnection();
  try {
    const columns = Object.keys(payload).filter((c) => c !== "id");
    if (columns.length === 0) return;

    const setClause = columns.map((c) => `\`${c}\` = ?`).join(", ");
    const values = columns.map((c) => payload[c]);
    values.push(rowId);

    await conn.execute(
      `UPDATE \`${tableName}\` SET ${setClause} WHERE id = ?`,
      values as (string | number | null)[]
    );
  } finally {
    conn.release();
  }
}
