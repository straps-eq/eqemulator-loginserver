import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { platformConfig, federationNodes } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

const GITHUB_REPO = "straps-eq/eqemulator-loginserver";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

import { APP_VERSION } from "@/lib/version";
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

function compareVersions(current: string, latest: string): boolean {
  // Strip 'v' prefix and pre-release suffixes (e.g. "1.5.0-beta.1" → "1.5.0")
  const c = current.replace(/^v/, "").replace(/-.*$/, "").split(".").map(Number);
  const l = latest.replace(/^v/, "").replace(/-.*$/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

async function proxyToAgent(path: string, method: string = "GET"): Promise<any> {
  const token = process.env.UPGRADE_AGENT_TOKEN || "";
  try {
    const res = await fetch(`http://upgrade-agent:9090${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return await res.json();
    return { error: `Agent returned ${res.status}` };
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { error: "Upgrade agent request timed out (15s)" };
    }
    return { error: "Upgrade agent not reachable" };
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
      const nodeId = parseInt(body.node_id, 10);
      const mode = body.mode || "direct";
      if (!nodeId || isNaN(nodeId)) {
        return NextResponse.json({ error: "node_id required (number)" }, { status: 400 });
      }
      try {
        const { federationPost } = await import("@/lib/federation/client");
        const [node] = await db.select().from(federationNodes).where(eq(federationNodes.id, nodeId));
        if (!node) {
          return NextResponse.json({ error: "Node not found" }, { status: 404 });
        }
        console.log(`[remote_force_pull] Force pull & restart on node ${nodeId} (${node.endpointUrl}) mode=${mode}`);
        const result = await federationPost(node.endpointUrl, "/api/federation/force_pull_restart", { mode }, node.tlsCertHash);
        console.log(`[remote_force_pull] Result: ok=${result.ok} status=${result.status} data=${JSON.stringify(result.data)} error=${result.error}`);
        return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : (result.status || 502) });
      } catch (err) {
        return NextResponse.json({ error: "Failed to reach peer node" }, { status: 502 });
      }
    }
    case "remote_upgrade": {
      // Trigger image-only upgrade on a peer federation node
      const nodeId = parseInt(body.node_id, 10);
      if (!nodeId || isNaN(nodeId)) {
        return NextResponse.json({ error: "node_id required (number)" }, { status: 400 });
      }
      try {
        const { federationPost } = await import("@/lib/federation/client");
        const [node] = await db.select().from(federationNodes).where(eq(federationNodes.id, nodeId));
        if (!node) {
          return NextResponse.json({ error: "Node not found" }, { status: 404 });
        }
        console.log(`[remote_upgrade] Triggering upgrade on node ${nodeId} (${node.endpointUrl})`);
        const result = await federationPost(node.endpointUrl, "/api/federation/remote_upgrade", {}, node.tlsCertHash);
        console.log(`[remote_upgrade] Result: ok=${result.ok} status=${result.status} data=${JSON.stringify(result.data)} error=${result.error}`);
        return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : (result.status || 502) });
      } catch (err) {
        return NextResponse.json({ error: "Failed to reach peer node" }, { status: 502 });
      }
    }
    case "remote_restart": {
      const nodeId = parseInt(body.node_id, 10);
      const service = body.service || "loginserver";
      if (!nodeId || isNaN(nodeId)) {
        return NextResponse.json({ error: "node_id required (number)" }, { status: 400 });
      }
      try {
        const { federationPost } = await import("@/lib/federation/client");
        const [node] = await db.select().from(federationNodes).where(eq(federationNodes.id, nodeId));
        if (!node) {
          return NextResponse.json({ error: "Node not found" }, { status: 404 });
        }
        console.log(`[remote_restart] Restarting ${service} on node ${nodeId} (${node.endpointUrl})`);
        const result = await federationPost(node.endpointUrl, "/api/federation/remote_restart", { service }, node.tlsCertHash);
        console.log(`[remote_restart] Result: ok=${result.ok} status=${result.status} data=${JSON.stringify(result.data)} error=${result.error}`);
        return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : (result.status || 502) });
      } catch (err) {
        return NextResponse.json({ error: "Failed to reach peer node" }, { status: 502 });
      }
    }
    case "remote_upgrade_status": {
      const nodeId = parseInt(body.node_id, 10);
      if (!nodeId || isNaN(nodeId)) {
        return NextResponse.json({ error: "node_id required (number)" }, { status: 400 });
      }
      try {
        const { federationGet } = await import("@/lib/federation/client");
        const [node] = await db.select().from(federationNodes).where(eq(federationNodes.id, nodeId));
        if (!node) {
          return NextResponse.json({ error: "Node not found" }, { status: 404 });
        }
        const result = await federationGet(node.endpointUrl, "/api/federation/remote_upgrade_status", node.tlsCertHash);
        console.log(`[remote_upgrade_status] Node ${nodeId}: ok=${result.ok} data=${JSON.stringify(result.data)} error=${result.error}`);
        return NextResponse.json(result.ok ? result.data : { error: result.error });
      } catch (err) {
        return NextResponse.json({ error: "Failed to reach peer node" }, { status: 502 });
      }
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
