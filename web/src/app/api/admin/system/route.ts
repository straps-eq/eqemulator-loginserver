import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

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
  // Strip 'v' prefix
  const c = current.replace(/^v/, "").split(".").map(Number);
  const l = latest.replace(/^v/, "").split(".").map(Number);
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
    });
    if (res.ok) return await res.json();
    return { error: `Agent returned ${res.status}` };
  } catch (err) {
    return { error: "Upgrade agent not reachable" };
  }
}

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.isAdmin || session.adminRole !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [release, services] = await Promise.all([
    getLatestRelease(),
    proxyToAgent("/status"),
  ]);

  const latestVersion = release?.tag_name?.replace(/^v/, "") || null;
  const updateAvailable = latestVersion ? compareVersions(CURRENT_VERSION, latestVersion) : false;

  return NextResponse.json({
    currentVersion: CURRENT_VERSION,
    latestVersion,
    updateAvailable,
    releaseNotes: release?.body || null,
    releaseUrl: release?.html_url || null,
    publishedAt: release?.published_at || null,
    services: services?.services || null,
    agentConnected: !services?.error,
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
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
