import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { version as APP_VERSION } from "../../../../../package.json";

type RouteContext = { params: Promise<{ action: string }> };

// ── Heartbeat ──
async function handleHeartbeat(req: NextRequest) {
  const { getSelfNode, getAllConfig } = await import("@/lib/federation/node");
  const { getLatestSeq } = await import("@/lib/federation/changelog");
  const { authenticateFederationRequest } = await import("@/lib/federation/middleware");

  const self = await getSelfNode();
  if (!self) {
    return NextResponse.json({ error: "Federation not initialized" }, { status: 503 });
  }

  // If request has auth headers, verify them and return full details
  const pubkey = req.headers.get("x-federation-publickey");
  if (pubkey) {
    const auth = await authenticateFederationRequest(req, "");
    if (!auth.node) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const latestSeq = await getLatestSeq();
    const configs = await getAllConfig();
    const maxConfigVersion = configs.reduce((max, c) => Math.max(max, c.version), 0);

    return NextResponse.json({
      node_id: self.id,
      name: self.name,
      public_key: self.publicKey,
      is_master: self.isMaster,
      latest_seq: latestSeq,
      latest_config_version: maxConfigVersion,
      software_version: APP_VERSION,
      timestamp: Date.now(),
    });
  }

  // Unauthenticated: return minimal liveness probe only
  return NextResponse.json({ status: "ok", timestamp: Date.now() });
}

// ── Config ──
async function handleConfigGet(req: NextRequest) {
  const { getSelfNode, getConfigSince, getAllConfig } = await import("@/lib/federation/node");
  const { authenticateFederationRequest } = await import("@/lib/federation/middleware");

  const self = await getSelfNode();
  if (!self) {
    return NextResponse.json({ error: "Federation not initialized" }, { status: 503 });
  }
  if (!self.isMaster) {
    return NextResponse.json({ error: "Not the master node" }, { status: 403 });
  }

  const auth = await authenticateFederationRequest(req, "");
  if (!auth.node) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const sinceVersion = parseInt(
    req.nextUrl.searchParams.get("since_version") || "0",
    10
  );

  const configs = sinceVersion > 0
    ? await getConfigSince(sinceVersion)
    : await getAllConfig();

  return NextResponse.json({
    configs: configs.map((c) => ({
      key: c.configKey,
      value: c.configValue,
      version: c.version,
    })),
  });
}

// ── Changes GET ──
async function handleChangesGet(req: NextRequest) {
  const { getSelfNode } = await import("@/lib/federation/node");
  const { authenticateFederationRequest } = await import("@/lib/federation/middleware");
  const { getChangesSince, getLatestSeq } = await import("@/lib/federation/changelog");

  const self = await getSelfNode();
  if (!self) {
    return NextResponse.json({ error: "Federation not initialized" }, { status: 503 });
  }

  const auth = await authenticateFederationRequest(req, "");
  if (!auth.node) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const since = parseInt(req.nextUrl.searchParams.get("since") || "0", 10);
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") || "500", 10),
    1000
  );

  const changes = await getChangesSince(since, limit);
  const latestSeq = await getLatestSeq();

  return NextResponse.json({
    changes: changes.map((c) => ({
      id: c.id,
      table_name: c.tableName,
      row_id: c.rowId,
      operation: c.operation,
      origin_node_id: c.originNodeId,
      payload: c.payload,
      created_at: c.createdAt,
    })),
    latest_seq: latestSeq,
  });
}

// ── Changes POST ──
async function handleChangesPost(req: NextRequest) {
  const { getSelfNode } = await import("@/lib/federation/node");
  const { authenticateFederationRequest } = await import("@/lib/federation/middleware");

  const self = await getSelfNode();
  if (!self) {
    return NextResponse.json({ error: "Federation not initialized" }, { status: 503 });
  }

  const bodyText = await req.text();
  const auth = await authenticateFederationRequest(req, bodyText);
  if (!auth.node) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // For now, POST just triggers a pull from the pushing peer.
  // The actual sync engine handles applying changes.
  // This endpoint exists for future push-based notification.
  return NextResponse.json({ received: true });
}

// ── Register ──
async function handleRegister(req: NextRequest) {
  const { getSelfNode, completePeerRegistration, getAllConfig, getActivePeers } = await import("@/lib/federation/node");

  const self = await getSelfNode();
  if (!self) {
    return NextResponse.json({ error: "Federation not initialized" }, { status: 503 });
  }
  if (!self.isMaster) {
    return NextResponse.json({ error: "Not the master node" }, { status: 403 });
  }

  const body = await req.json();
  const { token, public_key } = body;

  if (!token || !public_key) {
    return NextResponse.json(
      { error: "Missing required fields: token, public_key" },
      { status: 400 }
    );
  }

  const result = await completePeerRegistration(token, public_key);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const configs = await getAllConfig();
  const peers = await getActivePeers();

  return NextResponse.json({
    node_id: result.nodeId,
    master: {
      public_key: self.publicKey,
      endpoint_url: self.endpointUrl,
      name: self.name,
    },
    config: configs.map((c) => ({
      key: c.configKey,
      value: c.configValue,
      version: c.version,
    })),
    peers: peers
      .filter((p) => p.id !== result.nodeId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        endpoint_url: p.endpointUrl,
        public_key: p.publicKey,
      })),
  });
}

// ── Password Hash Strength ──
// Only scrypt ($7$) and argon2id ($argon2id$) hashes are allowed across the federation.
// Weak hashes (md5, sha, plain) are rejected — the loginserver auto-upgrades
// on next login, so accounts with weak hashes sync once the user logs in.
const STRONG_HASH_PREFIXES = ["$7$", "$argon2id$"];

function isStrongHash(hash: string): boolean {
  return STRONG_HASH_PREFIXES.some((p) => hash.startsWith(p));
}

// ── Password Sync ──
// Dedicated channel for syncing password hashes between authenticated peers.
// Passwords are excluded from the changelog for safety, so this endpoint
// handles them separately with full Ed25519 authentication.
async function handlePasswordSync(req: NextRequest) {
  const { getSelfNode } = await import("@/lib/federation/node");
  const { authenticateFederationRequest } = await import("@/lib/federation/middleware");

  const self = await getSelfNode();
  if (!self) {
    return NextResponse.json({ error: "Federation not initialized" }, { status: 503 });
  }

  const bodyText = await req.text();
  const auth = await authenticateFederationRequest(req, bodyText);
  if (!auth.node) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { updates?: Array<{ table: string; row_id: number; password_hash: string }> };
  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.updates || !Array.isArray(body.updates) || body.updates.length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  // Only allow password updates on known tables with password columns
  const ALLOWED_PASSWORD_TABLES: Record<string, string> = {
    login_accounts: "account_password",
    login_server_admins: "account_password",
  };

  const { pool } = await import("@/lib/db");
  const { auditLog } = await import("@/lib/federation/node");
  let applied = 0;
  let rejectedWeak = 0;

  for (const update of body.updates) {
    const col = ALLOWED_PASSWORD_TABLES[update.table];
    if (!col) continue;
    if (typeof update.row_id !== "number" || update.row_id <= 0) continue;
    if (typeof update.password_hash !== "string" || update.password_hash.length === 0) continue;
    // Safety: max hash length 512 chars
    if (update.password_hash.length > 512) continue;

    // Enforce minimum hash strength — only scrypt ($7$) or argon2 ($argon2id$)
    if (!isStrongHash(update.password_hash)) {
      rejectedWeak++;
      continue;
    }

    const conn = await pool.getConnection();
    try {
      await conn.execute(
        `UPDATE \`${update.table}\` SET \`${col}\` = ? WHERE id = ?`,
        [update.password_hash, update.row_id]
      );
      applied++;
    } finally {
      conn.release();
    }
  }

  await auditLog(auth.node.id, "password_sync_received", {
    count: body.updates.length,
    applied,
    rejectedWeakHash: rejectedWeak,
  });

  return NextResponse.json({ applied, rejected_weak_hash: rejectedWeak });
}

// ── Sync Data (full table export for mesh nodes) ──
async function handleSyncData(req: NextRequest) {
  const { getSelfNode } = await import("@/lib/federation/node");
  const { authenticateFederationRequest } = await import("@/lib/federation/middleware");
  const { db } = await import("@/lib/db");
  const { loginAccounts, loginWorldServers, loginServerAdmins, platformAccounts, platformOauthLinks, accountLoginLinks, platformAdmins } = await import("@/db/schema");

  const self = await getSelfNode();
  if (!self) {
    return NextResponse.json({ error: "Federation not initialized" }, { status: 503 });
  }

  const auth = await authenticateFederationRequest(req, "");
  if (!auth.node) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Export loginserver accounts (with password hashes for auth replication)
  const accounts = await db
    .select({
      id: loginAccounts.id,
      account_name: loginAccounts.accountName,
      account_password: loginAccounts.accountPassword,
      account_email: loginAccounts.accountEmail,
      source_loginserver: loginAccounts.sourceLoginserver,
      last_login_date: loginAccounts.lastLoginDate,
      created_at: loginAccounts.createdAt,
      updated_at: loginAccounts.updatedAt,
    })
    .from(loginAccounts);

  // Export world servers (only locally connected, not already-synced records)
  const { sql } = await import("drizzle-orm");
  const servers = await db
    .select({
      id: loginWorldServers.id,
      long_name: loginWorldServers.longName,
      short_name: loginWorldServers.shortName,
      tag_description: loginWorldServers.tagDescription,
      login_server_list_type_id: loginWorldServers.loginServerListTypeId,
      last_login_date: loginWorldServers.lastLoginDate,
      login_server_admin_id: loginWorldServers.loginServerAdminId,
      is_server_trusted: loginWorldServers.isServerTrusted,
      note: loginWorldServers.note,
    })
    .from(loginWorldServers)
    .where(sql`federation_source_node_id IS NULL OR federation_source_node_id = 0`);

  // Export server admins (only local records)
  const admins = await db
    .select({
      id: loginServerAdmins.id,
      account_name: loginServerAdmins.accountName,
      account_password: loginServerAdmins.accountPassword,
      first_name: loginServerAdmins.firstName,
      last_name: loginServerAdmins.lastName,
      email: loginServerAdmins.email,
      registration_date: loginServerAdmins.registrationDate,
    })
    .from(loginServerAdmins)
    .where(sql`federation_source_node_id IS NULL OR federation_source_node_id = 0`);

  // Export server profiles — match by world_server_id OR login_server_admin_id fallback
  const [profileRows] = await db.execute(
    sql`SELECT lws.short_name, sp.description, sp.website_url, sp.discord_url,
               sp.banner_image_url, sp.expansion_era, sp.custom_ruleset, sp.tags,
               sp.display_tier, sp.show_player_count
        FROM server_profiles sp
        LEFT JOIN login_world_servers lws ON lws.id = sp.world_server_id
        LEFT JOIN login_world_servers lws2 ON lws2.login_server_admin_id = sp.login_server_admin_id
          AND sp.world_server_id = 0 AND sp.login_server_admin_id > 0
        WHERE COALESCE(lws.id, lws2.id) IS NOT NULL
          AND (COALESCE(lws.federation_source_node_id, lws2.federation_source_node_id) IS NULL
               OR COALESCE(lws.federation_source_node_id, lws2.federation_source_node_id) = 0)`
  ) as unknown as [Array<Record<string, unknown>>];

  // Make relative banner URLs absolute so mesh nodes can display them
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || self.endpointUrl).replace(/\/$/, "");
  const profiles = profileRows.map((p) => {
    const banner = p.banner_image_url as string | null;
    return {
      ...p,
      banner_image_url: banner && banner.startsWith("/")
        ? `${siteUrl}${banner}`
        : banner,
    };
  });

  // Export live server data (players online, status, zones) from loginserver API
  const http = await import("http");
  const apiUrl = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
  const token = process.env.LOGINSERVER_API_TOKEN || "";
  const liveServers: Record<string, unknown>[] = await new Promise((resolve) => {
    const r = http.get(`${apiUrl}/v1/servers/list`, {
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let data = "";
      res.on("data", (chunk: string) => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          // Strip local_ip (private LAN) but keep remote_ip (public, needed for client server list)
          const safe = (Array.isArray(json) ? json : []).map(
            ({ local_ip, ...rest }: Record<string, unknown>) => rest
          );
          resolve(safe);
        } catch { resolve([]); }
      });
    });
    r.on("error", () => resolve([]));
    r.setTimeout(5000, () => { r.destroy(); resolve([]); });
  });

  // Export platform accounts (identity anchors)
  const platAccounts = await db
    .select({
      id: platformAccounts.id,
      username: platformAccounts.username,
      email: platformAccounts.email,
      email_verified: platformAccounts.emailVerified,
      created_at: platformAccounts.createdAt,
      updated_at: platformAccounts.updatedAt,
    })
    .from(platformAccounts);

  // Export OAuth links
  const oauthLinks = await db
    .select({
      id: platformOauthLinks.id,
      platform_account_id: platformOauthLinks.platformAccountId,
      provider: platformOauthLinks.provider,
      provider_user_id: platformOauthLinks.providerUserId,
      provider_email: platformOauthLinks.providerEmail,
      created_at: platformOauthLinks.createdAt,
    })
    .from(platformOauthLinks);

  // Export account-login links
  const loginLinks = await db
    .select({
      id: accountLoginLinks.id,
      platform_account_id: accountLoginLinks.platformAccountId,
      login_account_id: accountLoginLinks.loginAccountId,
      linked_at: accountLoginLinks.linkedAt,
    })
    .from(accountLoginLinks);

  // Export platform admins
  const platAdmins = await db
    .select({
      id: platformAdmins.id,
      login_account_id: platformAdmins.loginAccountId,
      role: platformAdmins.role,
      created_at: platformAdmins.createdAt,
    })
    .from(platformAdmins);

  // Compute a content hash so receivers can skip processing when data is unchanged
  const crypto = await import("crypto");
  const hashInput = JSON.stringify({ accounts, servers, admins, profiles, platAccounts, oauthLinks, loginLinks, platAdmins });
  const dataHash = crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 16);

  return NextResponse.json({
    node_id: self.id,
    data_hash: dataHash,
    accounts,
    servers,
    admins,
    profiles,
    platform_accounts: platAccounts,
    oauth_links: oauthLinks,
    login_links: loginLinks,
    platform_admins: platAdmins,
    live_servers: liveServers,
    timestamp: Date.now(),
  });
}

// ── Play Request (master side) ──
async function handlePlayRequest(req: NextRequest) {
  const { authenticateFederationRequest } = await import("@/lib/federation/middleware");
  const bodyText = await req.text();
  const auth = await authenticateFederationRequest(req, bodyText);
  if (!auth.node) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = JSON.parse(bodyText);
  const { server_short_name, account_id, account_name, login_key, loginserver_name, client_ip } = body;

  if (!server_short_name || !account_id || !account_name || !login_key) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Find the local server ID by short_name (must be a live connected server, not federated)
  const { pool } = await import("@/lib/db");
  const [rows] = await pool.execute(
    `SELECT id FROM login_world_servers WHERE short_name = ? AND (federation_source_node_id IS NULL OR federation_source_node_id = 0) LIMIT 1`,
    [server_short_name]
  ) as unknown as [Array<{ id: number }>];

  if (rows.length === 0) {
    return NextResponse.json({ error: `Server '${server_short_name}' not found locally` }, { status: 404 });
  }

  const serverId = rows[0].id;
  console.log(`[play_request] Forwarding ClientAuth from node ${auth.node.id} for ${account_name} -> server ${server_short_name} (id=${serverId})`);

  // Call the local loginserver API to send ClientAuth to the world server
  const http = await import("http");
  const apiUrl = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
  const token = process.env.LOGINSERVER_API_TOKEN || "";

  const lsPayload = JSON.stringify({
    server_id: serverId,
    account_id,
    account_name,
    login_key,
    loginserver_name: loginserver_name || "eqemu",
    client_ip: client_ip || "0.0.0.0",
  });

  const lsResult: { ok: boolean; status: number; body: string } = await new Promise((resolve) => {
    const r = http.request(`${apiUrl}/v1/federation/auth_client`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk: string) => data += chunk);
      res.on("end", () => {
        resolve({ ok: res.statusCode === 200, status: res.statusCode || 500, body: data });
      });
    });
    r.on("error", (err) => resolve({ ok: false, status: 502, body: err.message }));
    r.setTimeout(10000, () => { r.destroy(); resolve({ ok: false, status: 504, body: "Timeout" }); });
    r.write(lsPayload);
    r.end();
  });

  if (lsResult.ok) {
    console.log(`[play_request] ClientAuth sent successfully for ${account_name} -> ${server_short_name}`);
    return NextResponse.json({ success: true, server_id: serverId });
  } else {
    console.error(`[play_request] Loginserver API returned ${lsResult.status}: ${lsResult.body}`);
    return NextResponse.json(
      { error: "Failed to send ClientAuth to world server" },
      { status: lsResult.status }
    );
  }
}

// ── Remote Upgrade (master triggers image-only upgrade on this node) ──
async function handleRemoteUpgrade(req: NextRequest) {
  const { authenticateFederationRequest } = await import("@/lib/federation/middleware");
  const bodyText = await req.text();
  const auth = await authenticateFederationRequest(req, bodyText);
  if (!auth.node) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Only allow master nodes to trigger remote upgrades
  if (!auth.node.isMaster) {
    return NextResponse.json({ error: "Only master nodes can trigger remote upgrades" }, { status: 403 });
  }

  console.log(`[federation] remote_upgrade (image-only) from ${auth.node.name}`);

  // Proxy to local upgrade agent — use image_upgrade (no config sync)
  const token = process.env.UPGRADE_AGENT_TOKEN || "";
  try {
    const agentRes = await fetch("http://upgrade-agent:9090/image_upgrade", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await agentRes.json();
    return NextResponse.json(result, { status: agentRes.status });
  } catch (err) {
    return NextResponse.json({ error: "Upgrade agent not reachable" }, { status: 502 });
  }
}

async function handleRemoteUpgradeStatus(req: NextRequest) {
  const { authenticateFederationRequest } = await import("@/lib/federation/middleware");
  const auth = await authenticateFederationRequest(req, "");
  if (!auth.node) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const token = process.env.UPGRADE_AGENT_TOKEN || "";
  try {
    const agentRes = await fetch("http://upgrade-agent:9090/upgrade/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await agentRes.json();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: "Upgrade agent not reachable" }, { status: 502 });
  }
}

// ── Notify Sync (peer tells us to re-sync now) ──
let pendingNotifySync = false;

async function handleNotifySync(req: NextRequest) {
  const { authenticateFederationRequest } = await import("@/lib/federation/middleware");
  const bodyText = await req.text();
  const auth = await authenticateFederationRequest(req, bodyText);
  if (!auth.node) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let reason = "unknown";
  try {
    const body = JSON.parse(bodyText);
    reason = body.reason || "unknown";
  } catch {}

  console.log(`[federation] notify_sync from ${auth.node.name}: ${reason}`);

  // Debounce: if a sync is already pending from a recent notification, skip
  if (pendingNotifySync) {
    return NextResponse.json({ queued: false, reason: "sync already pending" });
  }

  // Trigger a sync in the background (don't block the response).
  // Use the internal sync endpoint so the existing lock/guard applies.
  pendingNotifySync = true;
  const port = process.env.PORT || "3000";
  const syncSecret = process.env.FEDERATION_SYNC_SECRET || "";
  setTimeout(async () => {
    try {
      await fetch(`http://localhost:${port}/api/federation/sync`, {
        method: "POST",
        headers: { "x-sync-secret": syncSecret },
      });
    } catch (err) {
      console.error("[federation] notify_sync triggered sync failed:", err);
    } finally {
      pendingNotifySync = false;
    }
  }, 1000); // 1s delay to batch rapid notifications

  return NextResponse.json({ queued: true, reason });
}

// ── Sync ──
async function handleSync(req: NextRequest) {
  const { getSelfNode } = await import("@/lib/federation/node");
  const { runSyncCycle } = await import("@/lib/federation/sync");

  const self = await getSelfNode();
  if (!self) {
    return NextResponse.json({ error: "Federation not initialized" }, { status: 503 });
  }

  const secret = process.env.FEDERATION_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "FEDERATION_SYNC_SECRET not configured" }, { status: 500 });
  }
  const provided = req.headers.get("x-sync-secret") || "";
  if (provided.length !== secret.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runSyncCycle();
  return NextResponse.json(result);
}

// ── Route dispatcher ──

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { action } = await ctx.params;
  try {
    switch (action) {
      case "heartbeat":
        return await handleHeartbeat(req);
      case "config":
        return await handleConfigGet(req);
      case "changes":
        return await handleChangesGet(req);
      case "sync_data":
        return await handleSyncData(req);
      case "remote_upgrade_status":
        return await handleRemoteUpgradeStatus(req);
      default:
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } catch (error) {
    console.error(`Federation ${action} GET error:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { action } = await ctx.params;
  try {
    switch (action) {
      case "changes":
        return await handleChangesPost(req);
      case "register":
        return await handleRegister(req);
      case "sync":
        return await handleSync(req);
      case "password_sync":
        return await handlePasswordSync(req);
      case "play_request":
        return await handlePlayRequest(req);
      case "notify_sync":
        return await handleNotifySync(req);
      case "remote_upgrade":
        return await handleRemoteUpgrade(req);
      default:
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } catch (error) {
    console.error(`Federation ${action} POST error:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
