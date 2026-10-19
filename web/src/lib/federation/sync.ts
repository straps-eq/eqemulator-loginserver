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
import { federationGet, federationPost, RECIPIENT_BINDING_MIN_VERSION } from "./client";
import { compareVersions } from "@/lib/version";
import { getSelfNode, getActivePeers, updatePeerSyncSeq, auditLog } from "./node";
import { getLatestSeq, pruneChangelog, pruneAuditLog } from "./changelog";
import { computeStableHash, computeVolatileHash, computeStableCollectionHashes, unchangedSignatureMessage, type SyncCondition } from "./sync-hash";
import { buildAdminIdMap, remapAdminId, pickServerWinners, isForeignOwner } from "./sync-remap";
import { verifyMessage } from "./crypto";
import { cacheGet, cacheSet, cacheDel } from "@/lib/redis";
import { randomBytes } from "crypto";

// Changelog-based sync is DISABLED for loginserver tables.
// The full data sync (applyFullDataSync) handles all loginserver tables with
// proper federation_source_node_id tracking and deduplication.
// The changelog sync was creating duplicate records (inserts without
// federation_source_node_id) and bloating the changelog by re-logging
// every applied change.
const SYNCED_TABLES = new Set<string>([
  // All loginserver tables handled by full data sync — do not add here
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
    "id", "world_server_id", "description", "banner_image_url",
    "custom_ruleset", "website_url", "discord_url",
    "expansion_era", "tags", "display_tier", "show_player_count",
    "claimed_by_admin_id", "created_at", "updated_at",
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
  federation_protocol?: number;
  updater_status?: unknown;
  desired_version_stable?: string | null;
  desired_version_canary?: string | null;
  desired_updated_at?: string | null;
  timestamp: number;
  active_peers?: Array<{ public_key: string; name: string; endpoint_url: string; node_tier: string }>;
}

interface ChangesResponse {
  changes: ChangeEntry[];
  latest_seq: number;
}

interface SyncDataResponse {
  node_id: number;
  data_hash?: string;
  /** Set on a conditional pull's signed "unchanged" answer, which carries no rows. */
  unchanged?: boolean;
  stable_hash?: string;
  volatile_hash?: string;
  signature?: string;
  accounts: Array<Record<string, unknown>>;
  servers: Array<Record<string, unknown>>;
  admins: Array<Record<string, unknown>>;
  profiles: Array<Record<string, unknown>>;
  platform_accounts?: Array<Record<string, unknown>>;
  oauth_links?: Array<Record<string, unknown>>;
  login_links?: Array<Record<string, unknown>>;
  platform_admins?: Array<Record<string, unknown>>;
  ws_admin_links?: Array<Record<string, unknown>>;
  live_servers: Array<Record<string, unknown>>;
  timestamp: number;
}

/** Cached live server data from federation peers — keyed by source node ID. */
const federatedLiveCache = new Map<number, { data: Array<Record<string, unknown>>; expires: number }>();
const LIVE_CACHE_TTL_MS = 90_000; // 90 seconds (sync runs every 60s)

/** Servers reclaimed as local during this sync cycle — skip re-adoption. */
const reclaimedServers = new Set<string>();

/**
 * Last-applied sync_data hashes per peer. Kept in Redis (in-memory fallback via
 * lib/redis) so a web restart does not force a full re-apply of every row.
 * The stable hash is computed locally from the received payload, so this works
 * against 1.5.x/1.6.x exporters whose `data_hash` still includes volatile columns.
 */
const SYNC_HASH_TTL_SECONDS = 7 * 24 * 3600;
/** How often volatile columns (last_login_date, ...) are refreshed when only they changed. */
const VOLATILE_REFRESH_MS = 10 * 60 * 1000;
const knownHashPeers = new Set<number>();
const stableKey = (id: number) => `fed:sync_hash:stable:${id}`;
const volatileKey = (id: number) => `fed:sync_hash:volatile:${id}`;
const volatileAtKey = (id: number) => `fed:sync_hash:volatile_at:${id}`;

/** Clear cached sync data hashes — call after admin edits to synced tables
 *  so the next sync cycle forces a full re-apply even if the peer's hash hasn't changed. */
export async function clearSyncDataHash(sourceNodeId?: number): Promise<void> {
  let ids: number[];
  if (sourceNodeId !== undefined) {
    ids = [sourceNodeId];
  } else {
    ids = Array.from(knownHashPeers);
    try {
      const [rows] = await pool.execute(`SELECT id FROM federation_nodes WHERE is_self = 0`) as unknown as [Array<{ id: number }>];
      rows.forEach((r) => ids.push(r.id));
    } catch { /* best effort */ }
  }
  const keys: string[] = [];
  for (const id of Array.from(new Set(ids))) keys.push(stableKey(id), volatileKey(id), volatileAtKey(id));
  await cacheDel(...keys);
}

/**
 * Condition for a conditional sync_data pull, or null for a plain full pull.
 * Mirrors the skip logic in applyFullDataSync: the volatile hash is only sent
 * when a volatile refresh is due, so a login-only change still arrives in full
 * every VOLATILE_REFRESH_MS. With no cached hash we always pull everything.
 */
async function buildSyncCondition(peerId: number): Promise<SyncCondition | null> {
  const [prevStable, prevVolatile, prevVolatileAt] = await Promise.all([
    cacheGet(stableKey(peerId)),
    cacheGet(volatileKey(peerId)),
    cacheGet(volatileAtKey(peerId)),
  ]);
  if (!prevStable || !/^[0-9a-f]{32}$/.test(prevStable)) return null;
  let volatile: string | null = null;
  if (Date.now() - Number(prevVolatileAt || 0) >= VOLATILE_REFRESH_MS) {
    if (!prevVolatile || !/^[0-9a-f]{32}$/.test(prevVolatile)) return null;
    volatile = prevVolatile;
  }
  return { stable: prevStable, volatile, nonce: randomBytes(16).toString("hex") };
}

function conditionQuery(cond: SyncCondition): Record<string, string> {
  const q: Record<string, string> = { if_stable: cond.stable, nonce: cond.nonce };
  if (cond.volatile) q.if_volatile = cond.volatile;
  return q;
}

/**
 * Accept an "unchanged" answer only if it echoes our hashes, is signed by the
 * peer's node key over our nonce and public key, and we still hold the same
 * stable hash (an admin edit may have cleared it mid-request to force a re-apply).
 */
async function verifyUnchanged(
  data: SyncDataResponse,
  cond: SyncCondition,
  peerId: number,
  peerPublicKey: string,
  selfPublicKey: string
): Promise<boolean> {
  const { signature, ...rest } = data;
  if (typeof signature !== "string" || !Array.isArray(data.live_servers)) return false;
  if (data.stable_hash !== cond.stable) return false;
  if (cond.volatile !== null && data.volatile_hash !== cond.volatile) return false;
  const message = unchangedSignatureMessage(cond.nonce, selfPublicKey, JSON.stringify(rest));
  if (!(await verifyMessage(peerPublicKey, signature, message))) return false;
  return (await cacheGet(stableKey(peerId))) === cond.stable;
}

/** world_server_admin_links rows mid-correction get login_server_admin_id = base + row id. */
const WS_LINK_PARK_BASE = 2_000_000_000;

/** Per-collection stable hashes of the last apply per peer (diagnostics only). */
const lastCollectionHashes = new Map<number, Record<string, string>>();

/** The hashes live in the persistent Redis volume, so after a database restore
 *  they could make this node skip re-applying peer data it no longer has. The
 *  first sync cycle of each process clears them and does a full re-apply. */
let syncHashesClearedAtStartup = false;

/** Track our own local server list hash to detect when new servers join. */
let lastLocalServerHash: string | null = null;

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

type SyncCycleResult = { peersChecked: number; changesApplied: number; errors: string[] };

/** The cycle in flight, on globalThis because Next can load this module in more than one bundle. */
const syncState = globalThis as unknown as { __eqemuSyncCycle?: Promise<SyncCycleResult> };

/**
 * Run a single sync cycle: pull changes from all active peers. Callers that
 * arrive while a cycle is running share it; two cycles never overlap, since
 * racing first pulls each inserted the same servers.
 */
export function runSyncCycle(): Promise<SyncCycleResult> {
  if (syncState.__eqemuSyncCycle) return syncState.__eqemuSyncCycle;
  const run = runSyncCycleOnce().finally(() => {
    if (syncState.__eqemuSyncCycle === run) syncState.__eqemuSyncCycle = undefined;
  });
  syncState.__eqemuSyncCycle = run;
  return run;
}

async function runSyncCycleOnce(): Promise<SyncCycleResult> {
  const self = await getSelfNode();
  if (!self) return { peersChecked: 0, changesApplied: 0, errors: ["Not initialized"] };
  if (!syncHashesClearedAtStartup) {
    syncHashesClearedAtStartup = true;
    try { await clearSyncDataHash(); } catch (err) { console.error("[sync] clearing cached sync hashes failed:", err); }
  }

  const peers = await getActivePeers();
  let changesApplied = 0;
  const errors: string[] = [];

  // Keep our own federation_nodes row (is_self = 1) current: version + updater status.
  const status = await import("./status");
  try {
    await status.updateSelfStatus();
  } catch (err) {
    errors.push(`self status update failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Reclaim servers that reconnected to the local loginserver BEFORE syncing.
  // This MUST run before applyFullDataSync so that locally-connected servers
  // have federation_source_node_id = NULL and won't be pruned by the sync.
  reclaimedServers.clear();
  try {
    const http = await import("http");
    const apiUrl = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
    const token = process.env.LOGINSERVER_API_TOKEN || "";
    const localLive: Array<{ server_short_name: string }> = await new Promise((resolve) => {
      const r = http.get(`${apiUrl}/v1/servers/list`, {
        headers: { Authorization: `Bearer ${token}` },
      }, (res: any) => {
        let d = "";
        res.on("data", (c: string) => d += c);
        res.on("end", () => {
          try { resolve(JSON.parse(d)); } catch { resolve([]); }
        });
      });
      r.on("error", () => resolve([]));
      r.setTimeout(5000, () => { r.destroy(); resolve([]); });
    });

    if (localLive.length > 0) {
      const liveShortNames = localLive.map((s) => s.server_short_name);
      for (const shortName of liveShortNames) {
        try {
          const [rows] = await pool.execute(
            `SELECT id, federation_source_node_id FROM login_world_servers WHERE short_name = ? AND federation_source_node_id > 0 LIMIT 1`,
            [shortName]
          ) as unknown as [Array<{ id: number; federation_source_node_id: number }>];
          if (rows.length > 0) {
            await pool.execute(`UPDATE login_world_servers SET federation_source_node_id = NULL WHERE id = ?`, [rows[0].id]);
            await pool.execute(`DELETE FROM federation_server_status WHERE world_server_id = ?`, [rows[0].id]);
            reclaimedServers.add(shortName);
            console.log(`[sync_data] reclaimed server "${shortName}" (id ${rows[0].id}) as local — reconnected directly`);
          }
        } catch {}
      }
    }
  } catch (err) {
    errors.push(`reclaim check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const peer of peers) {
    try {
      // Skip pulling from mesh-tier peers — they are read-only consumers
      if (peer.nodeTier === "mesh") continue;

      // Heartbeat first. Peers known to run >= 1.7.0 get a signed POST that
      // carries our status; older peers get the legacy GET.
      const peerIsCurrent = compareVersions(peer.softwareVersion, RECIPIENT_BINDING_MIN_VERSION) >= 0;
      const recipient = { recipientPublicKey: peer.publicKey, recipientVersion: peer.softwareVersion };
      let hb = peerIsCurrent
        ? await federationPost<HeartbeatResponse>(
            peer.endpointUrl, "/api/federation/heartbeat", await status.buildLocalStatus(), peer.tlsCertHash, recipient)
        : await federationGet<HeartbeatResponse>(
            peer.endpointUrl, "/api/federation/heartbeat", peer.tlsCertHash, recipient);
      let sentStatus = peerIsCurrent && hb.ok;
      if (peerIsCurrent && !hb.ok && (hb.status === 404 || hb.status === 405)) {
        // Peer rolled back (no POST heartbeat / no bound signatures): legacy GET, unbound.
        hb = await federationGet<HeartbeatResponse>(
          peer.endpointUrl, "/api/federation/heartbeat", peer.tlsCertHash,
          { recipientPublicKey: peer.publicKey, recipientVersion: null });
      }

      if (!hb.ok || !hb.data) {
        errors.push(`${peer.name}: heartbeat failed — ${hb.error}`);
        continue;
      }

      // Update heartbeat timestamp and peer's reported status
      const { updatePeerHeartbeat } = await import("./node");
      await updatePeerHeartbeat(peer.id);
      await status.storeNodeStatus(peer.id, {
        software_version: hb.data.software_version,
        federation_protocol: hb.data.federation_protocol,
        updater_status: hb.data.updater_status,
      });

      // First contact after the peer upgraded to >= 1.7.0: send our status now
      // instead of waiting a cycle (also teaches it our version, so it starts
      // binding signatures to us).
      if (!sentStatus && compareVersions(hb.data.software_version, RECIPIENT_BINDING_MIN_VERSION) >= 0) {
        const r = await federationPost(
          peer.endpointUrl, "/api/federation/heartbeat", await status.buildLocalStatus(), peer.tlsCertHash,
          { recipientPublicKey: peer.publicKey, recipientVersion: hb.data.software_version });
        sentStatus = r.ok;
      }

      // Desired versions published by the master (advisory; our updater decides)
      if (peer.isMaster && "desired_version_stable" in hb.data) {
        try {
          await status.storeMasterDesired(
            peer.id, hb.data.desired_version_stable, hb.data.desired_version_canary, hb.data.desired_updated_at);
        } catch (err) {
          errors.push(`storing master desired versions failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Reconcile peer list: if this peer (typically master) provides an active_peers list,
      // deactivate any local peers that are NOT in that list and NOT self.
      // Trust our own stored is_master flag, never the peer's self-reported one:
      // otherwise any peer could claim mastership and rewrite our peer list.
      if (hb.data.active_peers && peer.isMaster) {
        try {
          const { getSelfNode } = await import("./node");
          const selfNode = await getSelfNode();
          const masterPeerKeys = new Set(hb.data.active_peers.map((p) => p.public_key));
          // Also include the master's own key and our own key
          masterPeerKeys.add(peer.publicKey);
          if (selfNode) masterPeerKeys.add(selfNode.publicKey);

          // Build a lookup of master-reported peers by public key
          const masterEndpoints = new Map(
            hb.data.active_peers!.map((p) => [p.public_key, p])
          );

          // Get ALL local peers (not just active) so we can reactivate unapproved ones
          const [allLocalRows] = await pool.execute(
            `SELECT id, public_key, name, endpoint_url, status, is_approved FROM federation_nodes WHERE is_self = 0`
          ) as unknown as [Array<{ id: number; public_key: string; name: string; endpoint_url: string; status: string; is_approved: number }>];

          const localPeersByKey = new Map(allLocalRows.map(r => [r.public_key, r]));

          // Mirror the tier the master gives us onto our own row, so this node's
          // admin page shows "official" after a promotion instead of the join default.
          const selfEntry = selfNode ? masterEndpoints.get(selfNode.publicKey) : undefined;
          if (selfNode && selfEntry && (selfEntry.node_tier === "official" || selfEntry.node_tier === "mesh")
              && selfEntry.node_tier !== selfNode.nodeTier) {
            await pool.execute(
              `UPDATE federation_nodes SET node_tier = ?, updated_at = NOW() WHERE id = ? AND is_self = 1`,
              [selfEntry.node_tier, selfNode.id]
            );
            console.log(`[federation] own tier set to "${selfEntry.node_tier}" by master`);
          }

          // Deactivate local peers not in master's list, update/approve those that are
          for (const localPeer of allLocalRows) {
            if (!masterPeerKeys.has(localPeer.public_key)) {
              if (localPeer.status === "active" && localPeer.is_approved === 1) {
                await pool.execute(
                  `UPDATE federation_nodes SET status = 'revoked', is_approved = 0, updated_at = NOW() WHERE id = ?`,
                  [localPeer.id]
                );
                console.log(`[federation] deactivated node "${localPeer.name}" (id ${localPeer.id}) — removed from master`);
                await auditLog(localPeer.id, "node_removed_by_master", { name: localPeer.name });
              }
            } else {
              const masterPeer = masterEndpoints.get(localPeer.public_key);
              // Approve/activate if master says it's active but local copy isn't
              if (localPeer.status !== "active" || localPeer.is_approved !== 1) {
                await pool.execute(
                  `UPDATE federation_nodes SET status = 'active', is_approved = 1, node_tier = ?, updated_at = NOW() WHERE id = ?`,
                  [masterPeer?.node_tier || "mesh", localPeer.id]
                );
                console.log(`[federation] approved node "${localPeer.name}" (id ${localPeer.id}) — active on master`);
              }
              // Update endpoint_url if master reports a different one
              if (masterPeer && masterPeer.endpoint_url !== localPeer.endpoint_url) {
                await pool.execute(
                  `UPDATE federation_nodes SET endpoint_url = ?, updated_at = NOW() WHERE id = ?`,
                  [masterPeer.endpoint_url, localPeer.id]
                );
                console.log(`[federation] updated endpoint for "${localPeer.name}": ${localPeer.endpoint_url} -> ${masterPeer.endpoint_url}`);
              }
            }
          }

          // Create local entries for peers the master reports that we don't have at all
          for (const mp of hb.data.active_peers!) {
            if (mp.public_key === selfNode?.publicKey) continue; // skip self
            if (mp.public_key === peer.publicKey) continue; // skip the master itself
            if (localPeersByKey.has(mp.public_key)) continue; // already handled above
            try {
              await pool.execute(
                `INSERT INTO federation_nodes (name, endpoint_url, public_key, is_self, is_master, is_approved, status, node_tier, created_at, updated_at)
                 VALUES (?, ?, ?, 0, 0, 1, 'active', ?, NOW(), NOW())`,
                [mp.name, mp.endpoint_url, mp.public_key, mp.node_tier || "mesh"]
              );
              console.log(`[federation] created new peer "${mp.name}" from master's active list`);
            } catch (err) {
              console.error(`[federation] failed to create peer "${mp.name}":`, err);
            }
          }

          // Update the master peer's own endpoint if it changed
          const masterSelfEntry = hb.data.active_peers!.find(
            p => p.public_key === peer.publicKey
          );
          if (masterSelfEntry && masterSelfEntry.endpoint_url !== peer.endpointUrl) {
            await pool.execute(
              `UPDATE federation_nodes SET endpoint_url = ?, updated_at = NOW() WHERE id = ?`,
              [masterSelfEntry.endpoint_url, peer.id]
            );
            console.log(`[federation] updated master endpoint: ${peer.endpointUrl} -> ${masterSelfEntry.endpoint_url}`);
          }
        } catch (err) {
          errors.push(`peer reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
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
        // Ask for an "unchanged" answer when we hold this peer's last applied
        // hash. Anything other than a verified "unchanged" (old peer, rejected
        // query, bad signature) falls back to the plain full pull.
        const cond = await buildSyncCondition(peer.id);
        let syncData = await federationGet<SyncDataResponse>(
          peer.endpointUrl,
          cond ? `/api/federation/sync_data?${new URLSearchParams(conditionQuery(cond))}` : "/api/federation/sync_data",
          peer.tlsCertHash
        );
        let unchanged = false;
        if (cond && syncData.ok && syncData.data?.unchanged) {
          unchanged = await verifyUnchanged(syncData.data, cond, peer.id, peer.publicKey, self.publicKey);
          if (!unchanged) console.warn(`[sync_data] unverifiable "unchanged" answer from ${peer.name}; pulling full data`);
        }
        if (cond && !unchanged && (syncData.data?.unchanged || (syncData.status >= 400 && syncData.status < 500))) {
          syncData = await federationGet<SyncDataResponse>(
            peer.endpointUrl,
            "/api/federation/sync_data",
            peer.tlsCertHash
          );
        }

        if (unchanged && syncData.data) {
          // Same as the "stable hash unchanged" skip in applyFullDataSync.
          await applyLiveServers(syncData.data.live_servers, peer.id);
        } else if (syncData.ok && syncData.data && !syncData.data.unchanged) {
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

  // Self-healing: purge junk records that accumulate from sync bugs
  try {
    const [blankResult] = await pool.execute(
      `DELETE FROM login_server_admins WHERE account_name = '' OR account_name IS NULL`
    ) as unknown as [{ affectedRows: number }];
    if (blankResult.affectedRows > 0) {
      console.log(`[housekeeping] purged ${blankResult.affectedRows} blank-name login_server_admins`);
    }
    // Duplicate federated servers where a local copy already exists (local is authoritative)
    const [dupResult] = await pool.execute(
      `DELETE fed FROM login_world_servers fed
       INNER JOIN login_world_servers loc ON loc.short_name = fed.short_name
         AND (loc.federation_source_node_id IS NULL OR loc.federation_source_node_id = 0)
       WHERE fed.federation_source_node_id IS NOT NULL AND fed.federation_source_node_id > 0`
    ) as unknown as [{ affectedRows: number }];
    if (dupResult.affectedRows > 0) {
      console.log(`[housekeeping] purged ${dupResult.affectedRows} duplicate federated servers (local copy exists)`);
    }
    // Orphaned server_profiles with no matching world server
    await pool.execute(
      `DELETE sp FROM server_profiles sp LEFT JOIN login_world_servers lws ON sp.world_server_id = lws.id WHERE lws.id IS NULL`
    );
    // Orphaned server_profiles with world_server_id = 0
    await pool.execute(`DELETE FROM server_profiles WHERE world_server_id = 0`);
  } catch (err) {
    errors.push(`housekeeping cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Check if our own local data changed (e.g. new world server connected).
  // If so, broadcast notify_sync to all peers so they pull fresh data immediately.
  try {
    const { db } = await import("@/lib/db");
    const { loginWorldServers } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");
    const localServers = await db
      .select({ id: loginWorldServers.id, shortName: loginWorldServers.shortName })
      .from(loginWorldServers)
      .where(sql`federation_source_node_id IS NULL OR federation_source_node_id = 0`);

    const crypto = await import("crypto");
    const currentHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(localServers))
      .digest("hex")
      .slice(0, 16);

    if (lastLocalServerHash !== null && currentHash !== lastLocalServerHash) {
      console.log("[federation] local server list changed, notifying peers");
      const { broadcastSyncNotification } = await import("./client");
      await broadcastSyncNotification("server_list_changed");
    }
    lastLocalServerHash = currentHash;
  } catch (err) {
    errors.push(`local hash check failed: ${err instanceof Error ? err.message : String(err)}`);
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
  knownHashPeers.add(sourceNodeId);
  let rowErrors = 0;
  const collections = {
    accounts: data.accounts, servers: data.servers, admins: data.admins, profiles: data.profiles,
    platform_accounts: data.platform_accounts, oauth_links: data.oauth_links, login_links: data.login_links,
    ws_admin_links: data.ws_admin_links, platform_admins: data.platform_admins,
  };
  const stableHash = computeStableHash(collections);
  const volatileHash = computeVolatileHash(collections);
  const [prevStable, prevVolatile, prevVolatileAt] = await Promise.all([
    cacheGet(stableKey(sourceNodeId)),
    cacheGet(volatileKey(sourceNodeId)),
    cacheGet(volatileAtKey(sourceNodeId)),
  ]);

  // Skip processing if identity/credential data hasn't changed — still update live servers
  if (prevStable === stableHash) {
    // Volatile-only change (logins): refresh timestamps on a slow cadence.
    // Not counted as "changes applied".
    if (prevVolatile !== volatileHash && Date.now() - Number(prevVolatileAt || 0) >= VOLATILE_REFRESH_MS) {
      try {
        await applyVolatileRefresh(data, sourceNodeId);
        await cacheSet(volatileKey(sourceNodeId), volatileHash, SYNC_HASH_TTL_SECONDS);
        await cacheSet(volatileAtKey(sourceNodeId), String(Date.now()), SYNC_HASH_TTL_SECONDS);
      } catch (err) {
        rowErrors++;
        console.error(`[sync_data] volatile refresh from node ${sourceNodeId} failed:`, err);
      }
    }
    await applyLiveServers(data.live_servers, sourceNodeId);
    return 0;
  }

  // Say which collections changed since the last apply in this process, so a
  // payload that never stops changing can be traced to its source.
  const collectionHashes = computeStableCollectionHashes(collections);
  const prevCollections = lastCollectionHashes.get(sourceNodeId);
  if (prevCollections) {
    const changed = Object.keys(collectionHashes).filter((k) => prevCollections[k] !== collectionHashes[k]);
    console.log(`[sync_data] stable data from node ${sourceNodeId} changed: ${changed.join(", ") || "none (hash cache was empty)"}`);
  }

  const conn = await pool.getConnection();
  let applied = 0;
  // Rows deliberately not applied (duplicates on the source, ids with no local
  // match). Logged, but unlike rowErrors they do not block hash caching: they
  // would be skipped the same way on every retry.
  let skipped = 0;
  let aiFloor = 0;

  try {
    await conn.beginTransaction();

    // Platform tables flow one-way (master -> peers), and only peers translate
    // source admin ids; the master keeps what it is sent.
    const selfNode = await getSelfNode();
    const isMasterNode = selfNode?.isMaster ?? false;

    // Upsert login_accounts — preserve master's ID so federated play auth works.
    // The EQ client gets its account_id at login time from the local login_accounts.id.
    // The world server's account table stores lsaccount_id from previous logins.
    // If the mesh has a different ID for the same account, auth will fail.
    for (const acct of data.accounts) {
      try {
        const srcLs = acct.source_loginserver || "local";

        if (acct.id) {
          // Reconcile ID mismatches before upserting
          // 1. Check if this account_name exists locally with a different ID
          const [existing] = await conn.execute(
            `SELECT id FROM login_accounts WHERE account_name = ? AND source_loginserver = ? LIMIT 1`,
            [acct.account_name, srcLs] as string[]
          ) as unknown as [Array<{ id: number }>];

          if (existing.length > 0 && existing[0].id !== acct.id) {
            const localId = existing[0].id;

            // 2. Check if master's ID is already used by a DIFFERENT account locally
            const [conflict] = await conn.execute(
              `SELECT id, account_name FROM login_accounts WHERE id = ? LIMIT 1`,
              [acct.id] as number[]
            ) as unknown as [Array<{ id: number; account_name: string }>];

            if (conflict.length > 0 && conflict[0].account_name !== acct.account_name) {
              // Master's ID is taken by another local account — reassign it
              const [maxRow] = await conn.execute(
                `SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM login_accounts`,
                [] as string[]
              ) as unknown as [Array<{ next_id: number }>];
              const newId = maxRow[0].next_id;
              try { await conn.execute(`UPDATE account_login_links SET login_account_id = ? WHERE login_account_id = ?`, [newId, acct.id] as number[]); } catch {}
              await conn.execute(`UPDATE login_accounts SET id = ? WHERE id = ?`, [newId, acct.id] as number[]);
              console.log(`[sync_data] relocated conflicting account id ${acct.id} -> ${newId}`);
            }

            // 3. Remap local entry to master's ID
            try { await conn.execute(`UPDATE account_login_links SET login_account_id = ? WHERE login_account_id = ?`, [acct.id, localId] as number[]); } catch {}
            await conn.execute(`UPDATE login_accounts SET id = ? WHERE id = ?`, [acct.id, localId] as number[]);
            console.log(`[sync_data] remapped ${acct.account_name} id ${localId} -> ${acct.id}`);
          }

          // 4. Upsert with master's ID
          await conn.execute(
            `INSERT INTO login_accounts (id, account_name, account_password, account_email, source_loginserver, last_login_date, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               account_password = VALUES(account_password),
               account_email = VALUES(account_email),
               source_loginserver = VALUES(source_loginserver),
               last_login_date = VALUES(last_login_date),
               updated_at = VALUES(updated_at)`,
            [
              acct.id, acct.account_name, acct.account_password, acct.account_email || "",
              srcLs,
              toMySQLDatetime(acct.last_login_date),
              toMySQLDatetime(acct.created_at),
              toMySQLDatetime(acct.updated_at),
            ] as (string | number)[]
          );
        } else {
          // No ID from master — fallback to name-based upsert
          await conn.execute(
            `INSERT INTO login_accounts (account_name, account_password, account_email, source_loginserver, last_login_date, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               account_password = VALUES(account_password),
               account_email = VALUES(account_email),
               source_loginserver = VALUES(source_loginserver),
               last_login_date = VALUES(last_login_date),
               updated_at = VALUES(updated_at)`,
            [
              acct.account_name, acct.account_password, acct.account_email || "",
              srcLs,
              toMySQLDatetime(acct.last_login_date),
              toMySQLDatetime(acct.created_at),
              toMySQLDatetime(acct.updated_at),
            ] as string[]
          );
        }
        const [acctResult] = await conn.execute(`SELECT ROW_COUNT() as c`) as unknown as [Array<{ c: number }>];
        if (acctResult[0].c > 0) applied++;
      } catch (err) {
        rowErrors++;
        console.error(`[sync_data] account upsert error for ${acct.account_name}:`, err);
      }
    }

    // Upsert admins — match on (account_name, federation_source_node_id).
    // Done before servers: a peer gives these rows its own ids, so the source's
    // login_server_admin_id values are translated through adminIdMap below.
    // Skip blank account names — these are junk records that cause duplication loops
    const syncedAdminNames = new Set<string>();
    const adminPairs: Array<{ sourceId: unknown; localId: number }> = [];
    for (const adm of data.admins) {
      try {
        if (!adm.account_name || (adm.account_name as string).trim() === "") continue;
        const [existingAdm] = await conn.execute(
          `SELECT id FROM login_server_admins WHERE account_name = ? AND federation_source_node_id = ? ORDER BY id LIMIT 1`,
          [adm.account_name, sourceNodeId] as (string | number)[]
        ) as unknown as [Array<{ id: number }>];

        let localAdminId: number;
        if (existingAdm.length > 0) {
          await conn.execute(
            `UPDATE login_server_admins SET account_password = ?, first_name = ?, last_name = ?, email = ?, registration_date = ? WHERE id = ?`,
            [
              adm.account_password || "", adm.first_name || "",
              adm.last_name || "", adm.email || "",
              toMySQLDatetime(adm.registration_date), existingAdm[0].id,
            ] as (string | number)[]
          );
          localAdminId = existingAdm[0].id;
        } else {
          const [ins] = await conn.execute(
            `INSERT INTO login_server_admins (account_name, account_password, first_name, last_name, email, registration_date, registration_ip_address, federation_source_node_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              adm.account_name, adm.account_password || "",
              adm.first_name || "", adm.last_name || "", adm.email || "",
              toMySQLDatetime(adm.registration_date), "", sourceNodeId,
            ] as (string | number)[]
          ) as unknown as [{ insertId: number }];
          localAdminId = Number(ins.insertId);
        }
        adminPairs.push({ sourceId: adm.id, localId: localAdminId });
        syncedAdminNames.add(adm.account_name as string);
        const [admResult] = await conn.execute(`SELECT ROW_COUNT() as c`) as unknown as [Array<{ c: number }>];
        if (admResult[0].c > 0) applied++;
      } catch (err) {
        rowErrors++;
        console.error(`[sync_data] admin upsert error for ${adm.account_name}:`, err);
      }
    }

    // Remove admins from this source that no longer exist on the peer
    if (syncedAdminNames.size > 0) {
      const [existingAdmins] = await conn.execute(
        `SELECT id, account_name FROM login_server_admins WHERE federation_source_node_id = ?`,
        [sourceNodeId]
      ) as unknown as [Array<{ id: number; account_name: string }>];
      for (const row of existingAdmins) {
        if (!syncedAdminNames.has(row.account_name)) {
          await conn.execute(`DELETE FROM login_server_admins WHERE id = ?`, [row.id]);
        }
      }
    }

    // Source admin id -> local admin id. Re-applied on every full apply, so rows
    // written with the source's ids by older versions are corrected in place
    // (the first cycle after a restart always does a full apply, see
    // syncHashesClearedAtStartup).
    const adminIdMap = buildAdminIdMap(adminPairs);
    const unmappedAdmins = new Set<string>();
    const localAdminId = (sourceId: unknown, what: string): number | null => {
      if (isMasterNode) return Number(sourceId || 0);
      const id = remapAdminId(adminIdMap, sourceId);
      if (id === null) {
        skipped++;
        unmappedAdmins.add(`${sourceId} (${what})`);
      }
      return id;
    };

    // Upsert servers — match on (short_name, federation_source_node_id) to preserve stable IDs
    // The source can hold duplicate rows for one short_name; keep its lowest id
    // so peers do not flip between them, and count the rest as skips.
    const syncedShortNames = new Set<string>();
    const { winners: serverRows, skipped: dupServers } = pickServerWinners(data.servers);
    if (dupServers.length > 0) {
      skipped += dupServers.length;
      console.log(`[sync_data] node ${sourceNodeId} sent ${dupServers.length} duplicate server row(s) (${Array.from(new Set(dupServers.map((d) => d.short_name))).join(", ")}); using the lowest id of each`);
    }
    for (const srv of serverRows) {
      try {
        const [existingSrv] = await conn.execute(
          `SELECT id FROM login_world_servers WHERE short_name = ? AND federation_source_node_id = ? ORDER BY id LIMIT 1`,
          [srv.short_name, sourceNodeId] as (string | number)[]
        ) as unknown as [Array<{ id: number }>];

        if (existingSrv.length > 0) {
          // Already have this server from this source — update it. Without a
          // local admin to point at, leave login_server_admin_id as it is.
          const srvAdminId = localAdminId(srv.login_server_admin_id, `server ${srv.short_name}`);
          await conn.execute(
            `UPDATE login_world_servers SET long_name = ?, tag_description = ?, login_server_list_type_id = ?, last_login_date = ?,${srvAdminId === null ? "" : " login_server_admin_id = ?,"} is_server_trusted = ?, note = ? WHERE id = ?`,
            [
              srv.long_name, srv.tag_description || "",
              srv.login_server_list_type_id || 1, toMySQLDatetime(srv.last_login_date),
              ...(srvAdminId === null ? [] : [srvAdminId]), srv.is_server_trusted || 0,
              srv.note || null, existingSrv[0].id,
            ] as (string | number | null)[]
          );
        } else {
          // Skip if this server already exists locally — local copy is authoritative
          const [localSrv] = await conn.execute(
            `SELECT id FROM login_world_servers WHERE short_name = ? AND (federation_source_node_id IS NULL OR federation_source_node_id = 0) LIMIT 1`,
            [srv.short_name] as string[]
          ) as unknown as [Array<{ id: number }>];

          if (localSrv.length > 0) {
            // Local server takes precedence — don't create a federated duplicate
            syncedShortNames.add(srv.short_name as string);
            continue;
          }

          // Also skip if it already exists from a different federation source
          const [otherSrv] = await conn.execute(
            `SELECT id FROM login_world_servers WHERE short_name = ? AND federation_source_node_id IS NOT NULL AND federation_source_node_id != ? LIMIT 1`,
            [srv.short_name, sourceNodeId] as (string | number)[]
          ) as unknown as [Array<{ id: number }>];

          if (otherSrv.length > 0) {
            // Already exists from another node — skip duplicate
            syncedShortNames.add(srv.short_name as string);
            continue;
          }

          // New federated server — insert (admin 0 until it can be mapped)
          const srvAdminId = localAdminId(srv.login_server_admin_id, `server ${srv.short_name}`);
          await conn.execute(
            `INSERT INTO login_world_servers (long_name, short_name, tag_description, login_server_list_type_id, last_login_date, login_server_admin_id, is_server_trusted, note, federation_source_node_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              srv.long_name, srv.short_name, srv.tag_description || "",
              srv.login_server_list_type_id || 1, toMySQLDatetime(srv.last_login_date),
              srvAdminId ?? 0, srv.is_server_trusted || 0,
              srv.note || null, sourceNodeId,
            ] as (string | number | null)[]
          );
        }
        syncedShortNames.add(srv.short_name as string);
        const [srvResult] = await conn.execute(`SELECT ROW_COUNT() as c`) as unknown as [Array<{ c: number }>];
        if (srvResult[0].c > 0) applied++;
      } catch (err) {
        rowErrors++;
        console.error(`[sync_data] server upsert error for ${srv.short_name}:`, err);
      }
    }

    // Remove servers from this source that no longer exist on the peer.
    // Preserve servers that are live on the peer (adopted via live_servers)
    // even if they aren't in the peer's exported servers list.
    const liveShortNames = new Set<string>(
      (data.live_servers || []).map((ls: Record<string, unknown>) => ls.server_short_name as string).filter(Boolean)
    );
    if (syncedShortNames.size > 0 || liveShortNames.size > 0) {
      const [existingRows] = await conn.execute(
        `SELECT id, short_name FROM login_world_servers WHERE federation_source_node_id = ?`,
        [sourceNodeId]
      ) as unknown as [Array<{ id: number; short_name: string }>];
      for (const row of existingRows) {
        if (!syncedShortNames.has(row.short_name) && !liveShortNames.has(row.short_name)) {
          await conn.execute(`DELETE FROM server_profiles WHERE world_server_id = ?`, [row.id]);
          await conn.execute(`DELETE FROM login_world_servers WHERE id = ?`, [row.id]);
        }
      }
    }

    // Upsert server profiles — match by short_name to find local server ID
    const profileCount = data.profiles?.length || 0;
    if (data.profiles && data.profiles.length > 0) {
      for (const prof of data.profiles) {
        try {
          // Skip malformed profiles (e.g. from old export bug)
          if (!prof.short_name) continue;

          // Find the local server by short_name (synced from this federation source)
          const [rows] = await conn.execute(
            `SELECT id, login_server_admin_id FROM login_world_servers WHERE short_name = ? AND federation_source_node_id = ? ORDER BY id LIMIT 1`,
            [prof.short_name as string, sourceNodeId] as (string | number)[]
          ) as unknown as [Array<{ id: number; login_server_admin_id: number }>];

          if (rows.length > 0) {
            const localServerId = rows[0].id;
            // The account panel finds profiles by admin id; on a peer use the
            // server's (already translated) admin. NULL keeps the current value.
            const profAdminId = !isMasterNode && rows[0].login_server_admin_id > 0 ? rows[0].login_server_admin_id : null;
            await conn.execute(
              `INSERT INTO server_profiles (world_server_id, login_server_admin_id, description, website_url, discord_url, banner_image_url, expansion_era, custom_ruleset, tags, display_tier, show_player_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE
                 login_server_admin_id = COALESCE(VALUES(login_server_admin_id), login_server_admin_id),
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
                profAdminId,
                prof.description ?? null,
                prof.website_url ?? null,
                prof.discord_url ?? null,
                prof.banner_image_url ?? null,
                prof.expansion_era ?? null,
                prof.custom_ruleset ?? null,
                prof.tags ? JSON.stringify(prof.tags) : null,
                prof.display_tier ?? null,
                prof.show_player_count ?? 1,
              ] as (string | number | null)[]
            );
            const [profResult] = await conn.execute(`SELECT ROW_COUNT() as c`) as unknown as [Array<{ c: number }>];
            if (profResult[0].c > 0) applied++;
          }
        } catch (err) {
          rowErrors++;
          console.error(`[sync_data] profile upsert error for ${prof.short_name}:`, err);
        }
      }
    }

    // Platform tables (platform_accounts, oauth_links, login_links, platform_admins)
    // flow one-way: master → peers. The master never imports these from peers.

    const blockedAccounts = new Set<number>();
    const blocked = (accountId: unknown): boolean => {
      if (!blockedAccounts.has(Number(accountId))) return false;
      skipped++;
      return true;
    };

    // Upsert platform_accounts (identity anchors) — with ID conflict resolution.
    // Mesh nodes may have locally-created accounts whose IDs collide with the
    // master's IDs. Before upserting, detect and relocate any conflicting local
    // account to a high ID, then update all FK references.
    if (!isMasterNode && data.platform_accounts && data.platform_accounts.length > 0) {
      for (const pa of data.platform_accounts) {
        try {
          if (pa.id) {
            // Check if this ID is occupied by a DIFFERENT local account
            const [existing] = await conn.execute(
              `SELECT id, username, email FROM platform_accounts WHERE id = ? LIMIT 1`,
              [pa.id] as number[]
            ) as unknown as [Array<{ id: number; username: string; email: string }>];

            if (existing.length > 0 && existing[0].email !== pa.email) {
              // ID collision — relocate the local account (and everything that
              // references it) to a high ID. Throws on failure, which skips the
              // upsert below so the local account is never overwritten.
              await relocatePlatformAccount(conn, Number(pa.id), existing[0].username);
            }
          }

          await conn.execute(
            `INSERT INTO platform_accounts (id, username, email, email_verified, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               username = VALUES(username),
               email = VALUES(email),
               email_verified = VALUES(email_verified),
               updated_at = VALUES(updated_at)`,
            [
              pa.id, pa.username, pa.email, pa.email_verified || 0,
              toMySQLDatetime(pa.created_at),
              toMySQLDatetime(pa.updated_at),
            ] as (string | number)[]
          );
          const [r] = await conn.execute(`SELECT ROW_COUNT() as c`) as unknown as [Array<{ c: number }>];
          if (r[0].c > 0) applied++;
        } catch (err) {
          rowErrors++;
          // Without the master's account at this id (a local one may still sit
          // there), its child rows below would attach to the wrong account.
          if (pa.id) blockedAccounts.add(Number(pa.id));
          console.error(`[sync_data] platform_accounts upsert error for id ${pa.id}:`, err);
        }
      }

      // Bump AUTO_INCREMENT on platform tables (after commit, see below) so
      // locally-created records never collide with synced master IDs.
      aiFloor = Math.max(...data.platform_accounts.map((p) => (p.id as number) || 0)) + 100000;
    }

    // Upsert platform_oauth_links
    if (!isMasterNode && data.oauth_links && data.oauth_links.length > 0) {
      for (const ol of data.oauth_links) {
        try {
          if (blocked(ol.platform_account_id)) continue;
          await moveForeignHolder(conn, "platform_oauth_links", "platform_account_id", ol.id, ol.platform_account_id);
          const [sameLogin] = await conn.execute(
            `SELECT id, platform_account_id FROM platform_oauth_links WHERE provider = ? AND provider_user_id = ? AND id != ? AND platform_account_id != ? LIMIT 1`,
            [ol.provider, ol.provider_user_id, ol.id, ol.platform_account_id] as (string | number)[]
          ) as unknown as [Array<{ id: number; platform_account_id: number }>];
          if (sameLogin.length > 0) {
            console.warn(`[sync_data] ${ol.provider} login on local oauth row ${sameLogin[0].id} moves from platform account ${sameLogin[0].platform_account_id} to master account ${ol.platform_account_id}`);
          }
          await conn.execute(
            `INSERT INTO platform_oauth_links (id, platform_account_id, provider, provider_user_id, provider_email, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               platform_account_id = VALUES(platform_account_id),
               provider_email = VALUES(provider_email)`,
            [
              ol.id, ol.platform_account_id, ol.provider,
              ol.provider_user_id, ol.provider_email || null,
              toMySQLDatetime(ol.created_at),
            ] as (string | number | null)[]
          );
          const [r] = await conn.execute(`SELECT ROW_COUNT() as c`) as unknown as [Array<{ c: number }>];
          if (r[0].c > 0) applied++;
        } catch (err) {
          rowErrors++;
          console.error(`[sync_data] oauth_links upsert error for id ${ol.id}:`, err);
        }
      }
    }

    // Upsert account_login_links
    if (!isMasterNode && data.login_links && data.login_links.length > 0) {
      for (const ll of data.login_links) {
        try {
          if (blocked(ll.platform_account_id)) continue;
          await moveForeignHolder(conn, "account_login_links", "platform_account_id", ll.id, ll.platform_account_id);
          await conn.execute(
            `INSERT INTO account_login_links (id, platform_account_id, login_account_id, linked_at)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               platform_account_id = VALUES(platform_account_id),
               login_account_id = VALUES(login_account_id)`,
            [
              ll.id, ll.platform_account_id, ll.login_account_id,
              toMySQLDatetime(ll.linked_at),
            ] as (string | number)[]
          );
          const [r] = await conn.execute(`SELECT ROW_COUNT() as c`) as unknown as [Array<{ c: number }>];
          if (r[0].c > 0) applied++;
        } catch (err) {
          rowErrors++;
          console.error(`[sync_data] login_links upsert error for id ${ll.id}:`, err);
        }
      }
    }

    // Upsert platform_admins — handle unique constraint on login_account_id
    if (!isMasterNode && data.platform_admins && data.platform_admins.length > 0) {
      for (const pa of data.platform_admins) {
        try {
          if (blocked(pa.login_account_id)) continue;
          // A local row holding this id for another account moves to a fresh id
          await moveForeignHolder(conn, "platform_admins", "login_account_id", pa.id, pa.login_account_id);
          // The same account already has a row under another id (unique
          // login_account_id): give that row the master's id instead of
          // deleting it; the upsert then applies the master's role.
          if (pa.login_account_id) {
            const [existing] = await conn.execute(
              `SELECT id FROM platform_admins WHERE login_account_id = ? AND id != ? LIMIT 1`,
              [pa.login_account_id, pa.id] as number[]
            ) as unknown as [Array<{ id: number }>];
            if (existing.length > 0) {
              await conn.execute(`UPDATE platform_admins SET id = ? WHERE id = ?`, [pa.id, existing[0].id] as number[]);
              console.log(`[sync_data] platform_admins row id ${existing[0].id} (login_account_id ${pa.login_account_id}) renumbered to master id ${pa.id}`);
            }
          }

          await conn.execute(
            `INSERT INTO platform_admins (id, login_account_id, role, created_at)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               login_account_id = VALUES(login_account_id),
               role = VALUES(role)`,
            [
              pa.id, pa.login_account_id, pa.role,
              toMySQLDatetime(pa.created_at),
            ] as (string | number)[]
          );
          const [r] = await conn.execute(`SELECT ROW_COUNT() as c`) as unknown as [Array<{ c: number }>];
          if (r[0].c > 0) applied++;
        } catch (err) {
          rowErrors++;
          console.error(`[sync_data] platform_admins upsert error for id ${pa.id}:`, err);
        }
      }
    }

    // Upsert world_server_admin_links
    if (!isMasterNode && data.ws_admin_links && data.ws_admin_links.length > 0) {
      // 1. A local link holding a master link's id moves to a fresh id: one
      //    of another platform account, or one pointing at a world admin
      //    created on this node (rows synced by older versions hold the
      //    master's raw admin id, never a different local admin's).
      for (const wl of data.ws_admin_links) {
        if (!wl.id || blockedAccounts.has(Number(wl.platform_account_id))) continue;
        try {
          const target = remapAdminId(adminIdMap, wl.login_server_admin_id);
          const [rows] = await conn.execute(
            `SELECT l.platform_account_id AS owner, l.login_server_admin_id AS admin_id, a.id AS admin_row, a.federation_source_node_id AS admin_src
             FROM world_server_admin_links l LEFT JOIN login_server_admins a ON a.id = l.login_server_admin_id
             WHERE l.id = ? LIMIT 1`,
            [wl.id] as number[]
          ) as unknown as [Array<{ owner: number; admin_id: number; admin_row: number | null; admin_src: number | null }>];
          if (rows.length === 0) continue;
          const r = rows[0];
          const localAdmin = r.admin_row !== null && !(Number(r.admin_src) > 0) &&
            Number(r.admin_id) !== Number(wl.login_server_admin_id) && Number(r.admin_id) !== target;
          if (isForeignOwner(r.owner, wl.platform_account_id) || localAdmin) {
            await moveRowToFreshId(conn, "world_server_admin_links", wl.id,
              `platform account ${r.owner}, admin ${r.admin_id}; master row ${wl.id} is platform account ${wl.platform_account_id}`);
          }
        } catch (err) {
          rowErrors++;
          console.error(`[sync_data] ws_admin_link ${wl.id} local row check error:`, err);
        }
      }
      // 2. Older versions stored the master's admin ids here. Before correcting
      //    them, park the master's link rows whose admin id is about to change
      //    on a value no admin has, so the unique login_server_admin_id cannot
      //    make two corrections block each other (e.g. two links swapping ids).
      //    Parked rows are kept; one whose correction is then skipped points at
      //    no admin rather than at someone else's.
      for (const wl of data.ws_admin_links) {
        const target = remapAdminId(adminIdMap, wl.login_server_admin_id);
        if (!wl.id || !target || blockedAccounts.has(Number(wl.platform_account_id))) continue;
        try {
          const [res] = await conn.execute(
            `UPDATE world_server_admin_links SET login_server_admin_id = ? WHERE id = ? AND platform_account_id = ? AND login_server_admin_id != ?`,
            [WS_LINK_PARK_BASE + Number(wl.id), wl.id, wl.platform_account_id, target] as number[]
          ) as unknown as [{ affectedRows: number }];
          if (res.affectedRows > 0) console.log(`[sync_data] ws_admin_link ${wl.id}: correcting login_server_admin_id to local admin ${target}`);
        } catch (err) {
          rowErrors++;
          console.error(`[sync_data] ws_admin_link ${wl.id} park error:`, err);
        }
      }
      // 3. Upsert, pointing at this node's copy of the admin
      for (const wl of data.ws_admin_links) {
        try {
          if (blocked(wl.platform_account_id)) continue;
          const linkAdminId = localAdminId(wl.login_server_admin_id, `ws_admin_link ${wl.id}`);
          if (!linkAdminId) continue;
          // login_server_admin_id is unique: never take over another link row
          const [holder] = await conn.execute(
            `SELECT id, platform_account_id FROM world_server_admin_links WHERE login_server_admin_id = ? AND id != ? LIMIT 1`,
            [linkAdminId, wl.id] as number[]
          ) as unknown as [Array<{ id: number; platform_account_id: number }>];
          if (holder.length > 0) {
            skipped++;
            console.warn(`[sync_data] ws_admin_link ${wl.id}: local admin ${linkAdminId} is already linked by row ${holder[0].id} (platform account ${holder[0].platform_account_id}); left as is`);
            continue;
          }
          await conn.execute(
            `INSERT INTO world_server_admin_links (id, platform_account_id, login_server_admin_id, linked_at)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               platform_account_id = VALUES(platform_account_id),
               login_server_admin_id = VALUES(login_server_admin_id)`,
            [
              wl.id, wl.platform_account_id, linkAdminId,
              toMySQLDatetime(wl.linked_at),
            ] as (string | number | null)[]
          );
          const [r] = await conn.execute(`SELECT ROW_COUNT() as c`) as unknown as [Array<{ c: number }>];
          if (r[0].c > 0) applied++;
        } catch (err) {
          rowErrors++;
          console.error(`[sync_data] ws_admin_links upsert error for id ${wl.id}:`, err);
        }
      }
    }

    if (unmappedAdmins.size > 0) {
      console.warn(`[sync_data] no local admin for source admin id(s) from node ${sourceNodeId}, left unchanged: ${Array.from(unmappedAdmins).join(", ")}`);
    }

    // Clean up orphaned profiles (from old DELETE+INSERT sync cycles)
    try {
      await conn.execute(
        `DELETE sp FROM server_profiles sp
         LEFT JOIN login_world_servers lws ON sp.world_server_id = lws.id
         WHERE lws.id IS NULL`
      );
    } catch (err) {
      rowErrors++;
      console.error(`[sync_data] orphan profile cleanup error:`, err);
    }

    // Cache live server data for the servers API
    if (data.live_servers && data.live_servers.length > 0) {
      federatedLiveCache.set(sourceNodeId, {
        data: data.live_servers,
        expires: Date.now() + LIVE_CACHE_TTL_MS,
      });

      // Write live data to federation_server_status for the loginserver binary.
      // Also adopt local servers that are live on a peer (LB routing case):
      // set their federation_source_node_id so the C++ loginserver shows them.
      for (const ls of data.live_servers) {
        try {
          const shortName = ls.server_short_name as string;
          if (!shortName) continue;
          // Skip servers reclaimed as local earlier in this sync cycle (A-5 race fix)
          if (reclaimedServers.has(shortName)) continue;

          // First try: match by (short_name, federation_source_node_id)
          let [rows] = await conn.execute(
            `SELECT id FROM login_world_servers WHERE short_name = ? AND federation_source_node_id = ? ORDER BY id LIMIT 1`,
            [shortName, sourceNodeId] as (string | number)[]
          ) as unknown as [Array<{ id: number }>];

          // Second try: match a local server with NULL federation_source_node_id.
          // This handles LB routing — server registered here but connected to peer.
          if (rows.length === 0) {
            const [localRows] = await conn.execute(
              `SELECT id FROM login_world_servers WHERE short_name = ? AND (federation_source_node_id IS NULL OR federation_source_node_id = 0) LIMIT 1`,
              [shortName] as string[]
            ) as unknown as [Array<{ id: number }>];

            if (localRows.length > 0) {
              // Adopt as federated so the C++ loginserver binary includes it
              await conn.execute(
                `UPDATE login_world_servers SET federation_source_node_id = ? WHERE id = ?`,
                [sourceNodeId, localRows[0].id] as number[]
              );
              console.log(`[sync_data] adopted local server "${shortName}" (id ${localRows[0].id}) as live on node ${sourceNodeId}`);
              rows = localRows;
            }
          }

          if (rows.length === 0) continue;

          await conn.execute(
            `INSERT INTO federation_server_status (world_server_id, remote_ip, players_online, server_status, zones_booted, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               remote_ip = VALUES(remote_ip),
               players_online = VALUES(players_online),
               server_status = VALUES(server_status),
               zones_booted = VALUES(zones_booted),
               updated_at = NOW()`,
            [
              rows[0].id,
              (ls.remote_ip as string) || '',
              (ls.players_online as number) || 0,
              (ls.server_status as number) || 0,
              (ls.zones_booted as number) || 0,
            ] as (string | number)[]
          );
        } catch (err) {
          console.error(`[sync_data] federation_server_status upsert error:`, err);
        }
      }
    }

    await conn.commit();

    // ALTER TABLE commits implicitly, so it runs only once the transaction is
    // done. Uses max(synced ID) + 100000 as the floor, only if the current
    // AUTO_INCREMENT is lower.
    if (aiFloor > 0) {
      try {
        for (const tbl of ['platform_accounts', 'platform_oauth_links', 'account_login_links', 'platform_admins', 'world_server_admin_links']) {
          const [curAi] = await conn.execute(
            `SELECT AUTO_INCREMENT as ai FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
            [tbl] as string[]
          ) as unknown as [Array<{ ai: number }>];
          if (curAi.length > 0 && curAi[0].ai < aiFloor) {
            await conn.execute(`ALTER TABLE \`${tbl}\` AUTO_INCREMENT = ${aiFloor}`);
            console.log(`[sync_data] bumped ${tbl} AUTO_INCREMENT to ${aiFloor}`);
          }
        }
      } catch (err) {
        rowErrors++;
        console.error(`[sync_data] AUTO_INCREMENT bump error:`, err);
      }
    }

    // Cache the hashes for future skip detection (after commit, so a rolled-back
    // apply is retried next cycle). Row errors are swallowed above so one bad
    // row cannot block the rest; if any happened, do not cache, so the whole
    // set is re-applied next cycle instead of being skipped for days.
    if (rowErrors > 0) {
      console.warn(`[sync_data] ${rowErrors} row error(s) applying data from node ${sourceNodeId}; will re-apply next cycle${skipped > 0 ? ` (${skipped} rows skipped)` : ""}`);
      return applied;
    }
    await cacheSet(stableKey(sourceNodeId), stableHash, SYNC_HASH_TTL_SECONDS);
    await cacheSet(volatileKey(sourceNodeId), volatileHash, SYNC_HASH_TTL_SECONDS);
    await cacheSet(volatileAtKey(sourceNodeId), String(Date.now()), SYNC_HASH_TTL_SECONDS);
    lastCollectionHashes.set(sourceNodeId, collectionHashes);

    // "applied" counts rows the upserts matched: mysql2 connects with
    // CLIENT_FOUND_ROWS, so ROW_COUNT() is 1 for an unchanged row too.
    if (applied > 0) {
      console.log(`[sync_data] Applied ${applied} changes from node ${sourceNodeId}: ${data.accounts.length} accounts, ${data.servers.length} servers, ${data.admins.length} admins, ${profileCount} profiles, ${data.live_servers?.length || 0} live${skipped > 0 ? `, ${skipped} skipped` : ""}`);
    }
  } catch (txErr) {
    try { await conn.rollback(); } catch {}
    throw txErr;
  } finally {
    conn.release();
  }

  return applied;
}

type Conn = Awaited<ReturnType<typeof pool.getConnection>>;

/**
 * Move a local platform account off an id the master owns, along with every
 * row that references it. platform_oauth_links has an FK with no ON UPDATE,
 * so neither order works with FK checks on: they are off for the moves and
 * restored in finally, inside a savepoint so a failure leaves nothing half
 * moved. Every row pointing at the old id moves: from now on the account is
 * always moved before any master row for that id is written, so they are the
 * local account's. (Master rows attached by older versions' failed attempts
 * move too; the upserts that follow give the master's account its own rows
 * back by id or unique key, and moveForeignHolder keeps the local copies.)
 */
async function relocatePlatformAccount(conn: Conn, oldId: number, username: string): Promise<number> {
  const [maxRow] = await conn.execute(
    `SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM platform_accounts WHERE id >= 100000`
  ) as unknown as [Array<{ next_id: number }>];
  const newId = Math.max(Number(maxRow[0].next_id), 100000);
  // Every column that holds a platform account id (platform_admins.login_account_id included)
  const refs: Array<[string, string]> = [
    ["world_server_admin_links", "platform_account_id"],
    ["account_login_links", "platform_account_id"],
    ["platform_oauth_links", "platform_account_id"],
    ["platform_admins", "login_account_id"],
  ];
  await conn.query(`SAVEPOINT relocate_platform_account`);
  try {
    await conn.query(`SET FOREIGN_KEY_CHECKS = 0`);
    try {
      for (const [table, col] of refs) {
        const [res] = await conn.execute(
          `UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, [newId, oldId]
        ) as unknown as [{ affectedRows: number }];
        if (res.affectedRows > 0) console.log(`[sync_data] moved ${res.affectedRows} ${table} row(s) of "${username}" to platform account ${newId}`);
      }
      await conn.execute(`UPDATE platform_accounts SET id = ? WHERE id = ?`, [newId, oldId]);
    } finally {
      await conn.query(`SET FOREIGN_KEY_CHECKS = 1`);
    }
    await conn.query(`RELEASE SAVEPOINT relocate_platform_account`);
  } catch (err) {
    try { await conn.query(`ROLLBACK TO SAVEPOINT relocate_platform_account`); } catch (e) { console.error(`[sync_data] savepoint rollback failed:`, e); }
    console.error(`[sync_data] relocating local platform_account "${username}" off id ${oldId} failed:`, err);
    throw err;
  }
  console.log(`[sync_data] relocated local platform_account "${username}" id ${oldId} -> ${newId}`);
  return newId;
}

/**
 * Before a master row is upserted by its id: if a local row already holds that
 * id for a different owner, move the local row to a fresh id instead of
 * overwriting it.
 */
async function moveForeignHolder(conn: Conn, table: string, ownerCol: string, id: unknown, sourceOwner: unknown): Promise<void> {
  if (!id) return;
  const [rows] = await conn.execute(
    `SELECT ${ownerCol} AS owner FROM ${table} WHERE id = ? LIMIT 1`, [id] as number[]
  ) as unknown as [Array<{ owner: number }>];
  if (rows.length === 0 || !isForeignOwner(rows[0].owner, sourceOwner)) return;
  await moveRowToFreshId(conn, table, id, `${ownerCol} ${rows[0].owner}; master row ${id} is ${ownerCol} ${sourceOwner}`);
}

/** Renumber a local row to a fresh id (>= 100000, above anything in the table). */
async function moveRowToFreshId(conn: Conn, table: string, id: unknown, why: string): Promise<void> {
  const [maxRow] = await conn.execute(
    `SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM ${table}`
  ) as unknown as [Array<{ next_id: number }>];
  const newId = Math.max(Number(maxRow[0].next_id), 100000);
  await conn.execute(`UPDATE ${table} SET id = ? WHERE id = ?`, [newId, id] as number[]);
  console.log(`[sync_data] moved local ${table} row ${id} to id ${newId} (${why})`);
}

/** Update the live server cache and federation_server_status (changes frequently). */
async function applyLiveServers(liveServers: Array<Record<string, unknown>> | undefined, sourceNodeId: number): Promise<void> {
  if (liveServers && liveServers.length > 0) {
    federatedLiveCache.set(sourceNodeId, {
      data: liveServers,
      expires: Date.now() + LIVE_CACHE_TTL_MS,
    });
    const conn = await pool.getConnection();
    try {
      for (const ls of liveServers) {
        const shortName = ls.server_short_name as string;
        if (!shortName) continue;

        let [rows] = await conn.execute(
          `SELECT id FROM login_world_servers WHERE short_name = ? AND federation_source_node_id = ? ORDER BY id LIMIT 1`,
          [shortName, sourceNodeId] as (string | number)[]
        ) as unknown as [Array<{ id: number }>];

        // Also check for local servers (LB routing case)
        if (rows.length === 0) {
          const [localRows] = await conn.execute(
            `SELECT id FROM login_world_servers WHERE short_name = ? AND (federation_source_node_id IS NULL OR federation_source_node_id = 0) LIMIT 1`,
            [shortName] as string[]
          ) as unknown as [Array<{ id: number }>];
          if (localRows.length > 0) {
            await conn.execute(
              `UPDATE login_world_servers SET federation_source_node_id = ? WHERE id = ?`,
              [sourceNodeId, localRows[0].id] as number[]
            );
            console.log(`[sync_data] adopted local server "${shortName}" (id ${localRows[0].id}) as live on node ${sourceNodeId}`);
            rows = localRows;
          }
        }

        if (rows.length === 0) continue;
        await conn.execute(
          `INSERT INTO federation_server_status (world_server_id, remote_ip, players_online, server_status, zones_booted, updated_at)
           VALUES (?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             remote_ip = VALUES(remote_ip),
             players_online = VALUES(players_online),
             server_status = VALUES(server_status),
             zones_booted = VALUES(zones_booted),
             updated_at = NOW()`,
          [
            rows[0].id,
            (ls.remote_ip as string) || '',
            (ls.players_online as number) || 0,
            (ls.server_status as number) || 0,
            (ls.zones_booted as number) || 0,
          ] as (string | number)[]
        );
      }
    } finally { conn.release(); }
  }
}

/**
 * Refresh only volatile columns (login timestamps) from a peer's export,
 * without re-running the full upsert/reconcile path. Rows are matched the same
 * way the full apply matches them; rows that do not exist locally are skipped.
 */
async function applyVolatileRefresh(data: SyncDataResponse, sourceNodeId: number): Promise<void> {
  const conn = await pool.getConnection();
  try {
    const accts = (data.accounts || []).filter((a) => typeof a.id === "number" && (a.id as number) > 0);
    const CHUNK = 500;
    for (let i = 0; i < accts.length; i += CHUNK) {
      const chunk = accts.slice(i, i + CHUNK);
      const params: (string | number)[] = [];
      let caseLogin = "";
      let caseUpdated = "";
      for (const a of chunk) {
        caseLogin += " WHEN ? THEN ?";
        params.push(a.id as number, toMySQLDatetime(a.last_login_date));
      }
      for (const a of chunk) {
        caseUpdated += " WHEN ? THEN ?";
        params.push(a.id as number, toMySQLDatetime(a.updated_at));
      }
      const ids = chunk.map((a) => a.id as number);
      params.push(...ids);
      await conn.execute(
        `UPDATE login_accounts SET
           last_login_date = CASE id${caseLogin} ELSE last_login_date END,
           updated_at = CASE id${caseUpdated} ELSE updated_at END
         WHERE id IN (${ids.map(() => "?").join(",")})`,
        params
      );
    }
    for (const srv of data.servers || []) {
      if (!srv.short_name) continue;
      await conn.execute(
        `UPDATE login_world_servers SET last_login_date = ? WHERE short_name = ? AND federation_source_node_id = ?`,
        [toMySQLDatetime(srv.last_login_date), srv.short_name as string, sourceNodeId]
      );
    }
  } finally {
    conn.release();
  }
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

  // NOTE: We no longer re-log applied remote changes into the local changelog.
  // This was causing exponential changelog growth — every change from a peer
  // got echoed back, creating 137K+ duplicate entries.
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
