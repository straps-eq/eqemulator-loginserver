import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loginWorldServers } from "@/db/schema";
import { eq } from "drizzle-orm";
import http from "http";
import { activityFor, activityFromLevel, activityLevel, type ActivityThresholds } from "@/lib/activity";
import { getActivityThresholds } from "@/lib/public-servers";
import { canSeeExactCounts } from "@/lib/servers";

/**
 * Population history as activity bands (0 idle .. 3 high per sample). Exact
 * counts (`players` per point, `avg` / `max`) are added only for the world's
 * claimed owner and platform admins; the public gets bands only.
 */
interface BandPoint {
  level: number;
  time: string;
  players?: number;
}

function bandStats(levels: number[]) {
  if (levels.length === 0) return { typical: null, busiest: null };
  const sorted = [...levels].sort((a, b) => a - b);
  return {
    // The band the world sits in half the time or more.
    typical: activityFromLevel(sorted[Math.floor((sorted.length - 1) / 2)]),
    busiest: activityFromLevel(sorted[sorted.length - 1]),
  };
}

/** A peer on an older version still answers with player counts: band them here. */
function normalizePeerHistory(json: any, t: ActivityThresholds) {
  const raw: any[] = Array.isArray(json?.history) ? json.history : [];
  const history: BandPoint[] = raw.map((h) => ({
    level: typeof h.level === "number" ? h.level : activityLevel(activityFor(h.players, t)),
    time: String(h.time),
  }));
  return {
    history,
    stats: {
      ...bandStats(history.map((h) => h.level)),
      samples: history.length,
      uptime_pct: json?.stats?.uptime_pct ?? null,
    },
  };
}

export const dynamic = "force-dynamic";

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";

function promQuery(query: string, start: number, end: number, step: string): Promise<any> {
  const qs = new URLSearchParams({ query, start: String(start), end: String(end), step });
  const url = `${PROMETHEUS_URL}/api/v1/query_range?${qs}`;

  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const slug = decodeURIComponent(rawId);
  const numId = parseInt(slug, 10);

  // Look up server — accept numeric ID or short_name
  const [server] = await db
    .select({
      shortName: loginWorldServers.shortName,
      federationSourceNodeId: loginWorldServers.federationSourceNodeId,
      loginServerAdminId: loginWorldServers.loginServerAdminId,
    })
    .from(loginWorldServers)
    .where(
      isNaN(numId)
        ? eq(loginWorldServers.shortName, slug)
        : eq(loginWorldServers.id, numId)
    )
    .limit(1);

  if (!server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get("days") || "1", 10), 365);

  // If this is a federated server, proxy the history request to the source node
  if (server.federationSourceNodeId && server.federationSourceNodeId > 0) {
    try {
      const { federationNodes } = await import("@/db/schema");
      const [sourceNode] = await db
        .select({ endpointUrl: federationNodes.endpointUrl })
        .from(federationNodes)
        .where(eq(federationNodes.id, server.federationSourceNodeId))
        .limit(1);

      if (sourceNode?.endpointUrl) {
        // Fetch the source node's server list to find the matching server ID
        const listRes = await fetch(`${sourceNode.endpointUrl}/api/servers`, {
          signal: AbortSignal.timeout(5000),
        });
        if (listRes.ok) {
          const servers = await listRes.json();
          const match = (Array.isArray(servers) ? servers : []).find(
            (s: any) => s.server_short_name === server.shortName
          );
          if (match?.db_id) {
            const histRes = await fetch(
              `${sourceNode.endpointUrl}/api/servers/${match.db_id}/history?days=${days}`,
              { signal: AbortSignal.timeout(10000) }
            );
            if (histRes.ok) {
              return NextResponse.json(normalizePeerHistory(await histRes.json(), await getActivityThresholds()));
            }
          }
        }
      }
    } catch {
      // Fall through to local Prometheus query (will return empty)
    }
  }

  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;

  // Choose step based on time range to keep result set reasonable
  let step = "60s";  // 1 day = 1440 points
  if (days > 3) step = "300s";   // 7 days = 2016 points
  if (days > 14) step = "900s";  // 30 days = 2880 points
  if (days > 60) step = "3600s"; // 365 days = 8760 points

  const escaped = server.shortName.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const playersQuery = `eqemu_server_players_online{server_short_name="${escaped}"}`;
  const statusQuery = `eqemu_server_status{server_short_name="${escaped}"}`;

  const [playersResult, statusResult, thresholds, exact] = await Promise.all([
    promQuery(playersQuery, start, end, step),
    promQuery(statusQuery, start, end, step),
    getActivityThresholds(),
    canSeeExactCounts(server),
  ]);

  if (!playersResult || playersResult.status !== "success" || !playersResult.data?.result?.length) {
    return NextResponse.json({
      history: [],
      stats: { typical: null, busiest: null, samples: 0, uptime_pct: null },
    });
  }

  const values: [number, string][] = playersResult.data.result[0].values;

  const counts = values.map(([, val]) => parseInt(val, 10) || 0);
  const history: BandPoint[] = values.map(([ts], i) => ({
    level: activityLevel(activityFor(counts[i], thresholds)),
    time: new Date(ts * 1000).toISOString(),
    ...(exact ? { players: counts[i] } : {}),
  }));
  const exactStats = exact && counts.length > 0
    ? { avg: Math.round(counts.reduce((a, b) => a + b, 0) / counts.length), max: Math.max(...counts) }
    : {};

  // Compute uptime % from status metric
  let uptime_pct: number | null = null;
  if (statusResult?.status === "success" && statusResult.data?.result?.length) {
    const statusValues: [number, string][] = statusResult.data.result[0].values;
    const onlineCount = statusValues.filter(([, v]) => parseInt(v, 10) > 0).length;
    uptime_pct = statusValues.length > 0
      ? Math.round((onlineCount / statusValues.length) * 100)
      : null;
  }

  return NextResponse.json({
    history,
    stats: { ...bandStats(history.map((h) => h.level)), ...exactStats, samples: history.length, uptime_pct },
  });
}
