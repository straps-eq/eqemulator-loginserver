import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { platformConfig, federationNodes } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

const GITHUB_REPO = "straps-eq/eqemulator-loginserver";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

import { APP_VERSION, compareVersions as cmpVersions, normalizeVersion } from "@/lib/version";
const CURRENT_VERSION = APP_VERSION;

// Cache GitHub release check (15 minutes)
let releaseCache: { data: any; expires: number } | null = null;
const RELEASE_CACHE_TTL = 15 * 60 * 1000;

async function getLatestRelease() {
  const now = Date.now();
  if (releaseCache && now < releaseCache.expires) return releaseCache.data;

  try {
    const res = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    releaseCache = { data, expires: now + RELEASE_CACHE_TTL };
    return data;
  } catch {
    return null;
  }
}

/** True if `latest` is newer than `current`. */
function compareVersions(current: string, latest: string): boolean {
  return cmpVersions(latest, current) > 0;
}

/** Federation node table for the dashboard: every node incl. self, with reported status. */
async function getFederationOverview(selfNodeId: number | null, isMaster: boolean) {
  const status = await import("@/lib/federation/status");
  const [rows, statusRows, effective, own, master] = await Promise.all([
    db.select({
      id: federationNodes.id,
      name: federationNodes.name,
      endpointUrl: federationNodes.endpointUrl,
      nodeTier: federationNodes.nodeTier,
      status: federationNodes.status,
      isSelf: federationNodes.isSelf,
      isMaster: federationNodes.isMaster,
      isApproved: federationNodes.isApproved,
      softwareVersion: federationNodes.softwareVersion,
      lastHeartbeat: federationNodes.lastHeartbeatAt,
      lastSyncAt: federationNodes.lastSyncAt,
    }).from(federationNodes),
    status.getNodeStatusRows(),
    status.getEffectiveDesiredVersions(),
    status.getOwnDesiredVersions(),
    status.getMasterDesiredVersions(),
  ]);
  const desiredFor = (channel: string) =>
    channel === "canary" ? effective.desired_version_canary || effective.desired_version_stable : effective.desired_version_stable;

  const nodes = rows
    .filter((n) => n.isApproved || n.isSelf)
    .map((n) => {
      const s = statusRows.get(n.id);
      const u = s?.updaterStatus || null;
      const channel = u?.channel || "stable";
      const desired = desiredFor(channel);
      return {
        id: n.id,
        name: n.name,
        endpointUrl: n.endpointUrl,
        nodeTier: n.nodeTier,
        status: n.status,
        isSelf: n.isSelf === 1 || n.id === selfNodeId,
        isMaster: n.isMaster === 1,
        softwareVersion: n.softwareVersion,
        federationProtocol: s?.federationProtocol ?? null,
        lastHeartbeat: n.lastHeartbeat,
        lastStatusAt: s?.lastStatusAt ?? null,
        updater: u
          ? {
              channel: u.channel,
              auto: u.auto,
              lastResult: u.last_result,
              lastCheckAt: u.last_check_at,
              lastError: u.last_error,
              pendingVersion: u.pending_version,
              previousVersion: u.previous_version,
            }
          : null,
        desiredVersion: desired,
        behindDesired: !!desired && !!n.softwareVersion && cmpVersions(n.softwareVersion, desired) < 0,
      };
    })
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || Number(b.isMaster) - Number(a.isMaster) || a.name.localeCompare(b.name));

  return {
    isMaster,
    desired: effective,
    ownDesired: { stable: own.stable, canary: own.canary, updatedAt: own.updatedAt },
    masterDesired: isMaster ? null : { stable: master.stable, canary: master.canary, updatedAt: master.updatedAt },
    nodes,
  };
}

async function proxyToAgent(path: string, method: string = "GET"): Promise<any> {
  const token = process.env.UPGRADE_AGENT_TOKEN || "";
  try {
    const res = await fetch(`http://upgrade-agent:9090${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) return data ?? {};
    // Surface the agent's own error message (e.g. 409 from /rollback, 500 from /pull)
    return { error: (data && (data.error || data.message)) || `Agent returned ${res.status}`, agentStatus: res.status };
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { error: "Upgrade agent request timed out (15s)" };
    }
    return { error: "Upgrade agent not reachable" };
  }
}

/**
 * Send a legacy remote_* command to a peer, signed by this node, and record it
 * (sent + outcome) in federation_audit_log.
 */
async function sendRemoteCommand(
  rawNodeId: unknown,
  command: "remote_upgrade" | "remote_upgrade_status" | "remote_restart" | "force_pull_restart",
  method: "GET" | "POST",
  payload: Record<string, unknown> | undefined,
  adminName: string | undefined,
  opts: { quiet?: boolean } = {}
) {
  const nodeId = parseInt(String(rawNodeId), 10);
  if (!nodeId || isNaN(nodeId)) {
    return NextResponse.json({ error: "node_id required (number)" }, { status: 400 });
  }
  try {
    const { federationPost, federationGet } = await import("@/lib/federation/client");
    const { auditLog, getSelfNode } = await import("@/lib/federation/node");
    const [node] = await db.select().from(federationNodes).where(eq(federationNodes.id, nodeId));
    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }
    const self = await getSelfNode();
    const path = `/api/federation/${command}`;
    const result = method === "GET"
      ? await federationGet(node.endpointUrl, path, node.tlsCertHash, { recipientPublicKey: node.publicKey, recipientVersion: node.softwareVersion })
      : await federationPost(node.endpointUrl, path, payload ?? {}, node.tlsCertHash, { recipientPublicKey: node.publicKey, recipientVersion: node.softwareVersion });
    // Status polls are frequent; only log them when they fail.
    if (!opts.quiet || !result.ok) {
      await auditLog(self?.id || 0, "remote_command_sent", {
        command,
        targetNodeId: node.id,
        targetName: node.name,
        payload: payload ?? null,
        admin: adminName || null,
        ok: result.ok,
        status: result.status,
        error: result.ok ? null : (result.data as { error?: string } | null)?.error || result.error,
      });
    }
    if (!opts.quiet) {
      console.log(`[${command}] node ${nodeId} (${node.endpointUrl}): ok=${result.ok} status=${result.status}`);
    }
    if (result.ok) return NextResponse.json(result.data);
    const errMsg = (result.data as { error?: string } | null)?.error || result.error;
    return NextResponse.json({ error: errMsg }, { status: opts.quiet ? 200 : (result.status || 502) });
  } catch {
    return NextResponse.json({ error: "Failed to reach peer node" }, { status: 502 });
  }
}

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.isAdmin || session.adminRole !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Get self node info (ID + master status) — single call, reused below
  let selfNodeId: number | null = null;
  let isMaster = false;
  try {
    const { getSelfNode } = await import("@/lib/federation/node");
    const self = await getSelfNode();
    if (self) {
      selfNodeId = self.id;
      isMaster = !!self.isMaster;
    }
  } catch {}

  const [release, services, statusPageConfig, peerNodes] = await Promise.all([
    getLatestRelease(),
    proxyToAgent("/status"),
    db.select().from(platformConfig).where(eq(platformConfig.configKey, "status_page_public")),
    db.select({
      id: federationNodes.id,
      name: federationNodes.name,
      endpointUrl: federationNodes.endpointUrl,
      nodeTier: federationNodes.nodeTier,
      status: federationNodes.status,
      softwareVersion: federationNodes.softwareVersion,
      lastHeartbeat: federationNodes.lastHeartbeatAt,
    }).from(federationNodes).where(
      selfNodeId ? ne(federationNodes.id, selfNodeId) : undefined as any
    ),
  ]);

  let federation: Awaited<ReturnType<typeof getFederationOverview>> | null = null;
  if (selfNodeId) {
    try {
      federation = await getFederationOverview(selfNodeId, isMaster);
    } catch (err) {
      console.error("[admin/system] federation overview failed:", err);
    }
  }

  const latestVersion = release?.tag_name?.replace(/^v/, "") || null;
  let updateAvailable = latestVersion ? compareVersions(CURRENT_VERSION, latestVersion) : false;
  const statusPagePublic = statusPageConfig.length > 0 ? statusPageConfig[0].configValue === "true" : true;

  // Non-master nodes: also check if any peer (master) reports a newer version
  let peerLatestVersion: string | null = null;
  if (!isMaster && peerNodes && peerNodes.length > 0) {
    for (const p of peerNodes) {
      if (p.softwareVersion && compareVersions(CURRENT_VERSION, p.softwareVersion)) {
        if (!peerLatestVersion || compareVersions(peerLatestVersion, p.softwareVersion)) {
          peerLatestVersion = p.softwareVersion;
        }
      }
    }
    if (peerLatestVersion) {
      updateAvailable = true;
    }
  }

  return NextResponse.json({
    currentVersion: CURRENT_VERSION,
    latestVersion: peerLatestVersion || latestVersion,
    updateAvailable,
    releaseNotes: release?.body || null,
    releaseUrl: release?.html_url || null,
    publishedAt: release?.published_at || null,
    services: services?.services || null,
    agentConnected: !services?.error,
    statusPagePublic,
    isMaster,
    peerNodes: peerNodes || [],
    federation,
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn || !session.isAdmin || session.adminRole !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const action = body.action;

  switch (action) {
    case "upgrade": {
      const result = await proxyToAgent("/upgrade", "POST");
      return NextResponse.json(result, { status: result.error ? 500 : 200 });
    }
    case "rollback": {
      // Local only: agent swaps web + loginserver back to :previous images (DB is not rolled back).
      const result = await proxyToAgent("/rollback", "POST");
      try {
        const { auditLog, getSelfNode } = await import("@/lib/federation/node");
        const self = await getSelfNode();
        await auditLog(self?.id || 0, "local_rollback_requested", { admin: session.accountName || null, ok: !result.error, error: result.error || null });
      } catch {}
      if (result.error) return NextResponse.json(result, { status: result.agentStatus || 500 });
      return NextResponse.json(result, { status: 202 });
    }
    case "upgrade_status": {
      const result = await proxyToAgent("/upgrade/status");
      return NextResponse.json(result);
    }
    case "pull": {
      const result = await proxyToAgent("/pull", "POST");
      return NextResponse.json(result);
    }
    case "backup": {
      const result = await proxyToAgent("/backup", "POST");
      return NextResponse.json(result, { status: result.error ? 500 : 200 });
    }
    case "migrate": {
      const result = await proxyToAgent("/migrate", "POST");
      return NextResponse.json(result);
    }
    case "restart": {
      const service = body.service;
      if (!service || !["web", "loginserver", "mariadb", "redis", "nginx"].includes(service)) {
        return NextResponse.json({ error: "Invalid service" }, { status: 400 });
      }
      const result = await proxyToAgent(`/restart/${service}`, "POST");
      return NextResponse.json(result);
    }
    case "force_pull_restart": {
      const mode = body.mode || "direct";
      const result = await proxyToAgent(`/force_pull_restart?mode=${mode}`, "POST");
      return NextResponse.json(result, { status: result.error ? 500 : 202 });
    }
    case "remote_force_pull_restart": {
      const mode = body.mode === "compose" ? "compose" : "direct";
      return sendRemoteCommand(body.node_id, "force_pull_restart", "POST", { mode }, session.accountName);
    }
    case "remote_upgrade": {
      // Legacy: trigger image-only upgrade on a peer (only works if the peer
      // opted in with allow_remote_commands; 1.5.x/1.6.x peers have no gate)
      return sendRemoteCommand(body.node_id, "remote_upgrade", "POST", {}, session.accountName);
    }
    case "remote_restart": {
      const service = ["loginserver", "web", "nginx"].includes(body.service) ? body.service : "loginserver";
      return sendRemoteCommand(body.node_id, "remote_restart", "POST", { service }, session.accountName);
    }
    case "remote_upgrade_status": {
      return sendRemoteCommand(body.node_id, "remote_upgrade_status", "GET", undefined, session.accountName, { quiet: true });
    }
    case "set_desired_version": {
      // Master: publishes the version to the federation (heartbeat response).
      // Peer: a local override for this node's own updater only.
      const channel = body.channel;
      if (channel !== "stable" && channel !== "canary") {
        return NextResponse.json({ error: "channel must be 'stable' or 'canary'" }, { status: 400 });
      }
      const raw = typeof body.version === "string" ? body.version.trim() : "";
      const version = raw === "" ? null : normalizeVersion(raw);
      if (raw !== "" && !version) {
        return NextResponse.json({ error: "version must look like 1.7.0 (or empty to clear)" }, { status: 400 });
      }
      const { setOwnDesiredVersion, getOwnDesiredVersions } = await import("@/lib/federation/status");
      const { auditLog, getSelfNode } = await import("@/lib/federation/node");
      const self = await getSelfNode();
      if (!self) {
        return NextResponse.json({ error: "Federation not initialized" }, { status: 400 });
      }
      const before = await getOwnDesiredVersions();
      await setOwnDesiredVersion(channel, version);
      await auditLog(self.id, "desired_version_set", {
        channel,
        version,
        previous: channel === "stable" ? before.stable : before.canary,
        admin: session.accountName || null,
        scope: self.isMaster ? "published" : "local_override",
      });
      return NextResponse.json({ success: true, channel, version });
    }
    case "notify_check": {
      // Ask a peer's updater to check for updates now. Records a request on
      // the peer; executes nothing there.
      const nodeId = parseInt(String(body.node_id), 10);
      if (!nodeId || isNaN(nodeId)) {
        return NextResponse.json({ error: "node_id required (number)" }, { status: 400 });
      }
      const { federationPost } = await import("@/lib/federation/client");
      const { auditLog, getSelfNode } = await import("@/lib/federation/node");
      const self = await getSelfNode();
      if (!self?.isMaster) {
        return NextResponse.json({ error: "Only the master can notify peers" }, { status: 403 });
      }
      const [node] = await db.select().from(federationNodes).where(eq(federationNodes.id, nodeId));
      if (!node || node.isSelf) {
        return NextResponse.json({ error: "Node not found" }, { status: 404 });
      }
      const result = await federationPost(node.endpointUrl, "/api/federation/notify_check",
        { reason: "admin_dashboard" }, node.tlsCertHash,
        { recipientPublicKey: node.publicKey, recipientVersion: node.softwareVersion });
      const peerError = (result.data as { error?: string } | null)?.error;
      await auditLog(self.id, "notify_check_sent", {
        targetNodeId: node.id, targetName: node.name, admin: session.accountName || null,
        ok: result.ok, status: result.status, error: result.ok ? null : peerError || result.error,
      });
      if (result.ok) return NextResponse.json({ success: true, ...(result.data as object) });
      // 1.5.x/1.6.x peers do not know notify_check (404): their operator has to update manually.
      const msg = result.status === 404
        ? `${node.name} does not support notify_check (runs ${node.softwareVersion || "an old version"}); its operator must update`
        : peerError || result.error || "Failed to reach peer node";
      return NextResponse.json({ error: msg }, { status: result.status || 502 });
    }
    case "reset_node_version": {
      // Operator action after a peer was rolled back below 1.7.0: an unbound
      // request never lowers the recorded version (it could be a replay), so
      // clearing it is done here, audit logged.
      const nodeId = parseInt(String(body.node_id), 10);
      if (!nodeId || isNaN(nodeId)) {
        return NextResponse.json({ error: "node_id required (number)" }, { status: 400 });
      }
      const { auditLog, getSelfNode } = await import("@/lib/federation/node");
      const self = await getSelfNode();
      const [node] = await db.select().from(federationNodes).where(eq(federationNodes.id, nodeId));
      if (!self || !node || node.isSelf) {
        return NextResponse.json({ error: "Node not found" }, { status: 404 });
      }
      const { pool } = await import("@/lib/db");
      await pool.execute(`UPDATE federation_nodes SET software_version = NULL WHERE id = ?`, [node.id]);
      await auditLog(self.id, "node_version_reset", {
        targetNodeId: node.id, targetName: node.name, previousVersion: node.softwareVersion, admin: session.accountName || null,
      });
      return NextResponse.json({ success: true });
    }
    case "toggle_status_page": {
      const { enabled } = body;
      if (typeof enabled !== "boolean") {
        return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
      }
      await db
        .insert(platformConfig)
        .values({ configKey: "status_page_public", configValue: String(enabled), updatedAt: new Date() })
        .onDuplicateKeyUpdate({ set: { configValue: String(enabled), updatedAt: new Date() } });
      return NextResponse.json({ success: true, statusPagePublic: enabled });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
