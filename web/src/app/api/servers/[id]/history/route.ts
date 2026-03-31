import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loginWorldServers } from "@/db/schema";
import { eq } from "drizzle-orm";
import http from "http";

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
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid server ID" }, { status: 400 });
  }

  // Look up server short name from DB
  const [server] = await db
    .select({ shortName: loginWorldServers.shortName })
    .from(loginWorldServers)
    .where(eq(loginWorldServers.id, id))
    .limit(1);

  if (!server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get("days") || "1", 10), 365);

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

  const [playersResult, statusResult] = await Promise.all([
    promQuery(playersQuery, start, end, step),
    promQuery(statusQuery, start, end, step),
  ]);

  if (!playersResult || playersResult.status !== "success" || !playersResult.data?.result?.length) {
    return NextResponse.json({
      history: [],
      stats: { avg: 0, max: 0, samples: 0, uptime_pct: null },
    });
  }

  const values: [number, string][] = playersResult.data.result[0].values;

  const history = values.map(([ts, val]) => ({
    players: parseInt(val, 10) || 0,
    time: new Date(ts * 1000).toISOString(),
  }));

  const playerCounts = history.map((h) => h.players);
  const avg = playerCounts.length > 0
    ? Math.round(playerCounts.reduce((a, b) => a + b, 0) / playerCounts.length)
    : 0;
  const max = playerCounts.length > 0 ? Math.max(...playerCounts) : 0;

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
    stats: { avg, max, samples: history.length, uptime_pct },
  });
}
