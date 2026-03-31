import { NextRequest, NextResponse } from "next/server";
import http from "http";

export const dynamic = "force-dynamic";

// Internal-only: only allow requests from Docker internal network or with metrics token
function isInternalRequest(req: NextRequest): boolean {
  // Allow if a metrics bearer token is configured and matches
  const metricsToken = process.env.METRICS_BEARER_TOKEN;
  if (metricsToken) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${metricsToken}`) return true;
  }

  // Allow internal Docker network IPs
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "";
  // Docker internal bridge IPs are typically 172.x.x.x or 10.x.x.x
  if (ip.startsWith("172.") || ip.startsWith("10.") || ip === "127.0.0.1" || ip === "::1") {
    return true;
  }

  // If no X-Forwarded-For (direct internal request), allow
  if (!forwarded) return true;

  return false;
}

async function getLiveServers(): Promise<any[]> {
  const apiUrl = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
  const token = process.env.LOGINSERVER_API_TOKEN || "";
  return new Promise((resolve) => {
    const req = http.get(`${apiUrl}/v1/servers/list`, {
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(Array.isArray(json) ? json : []);
        } catch { resolve([]); }
      });
    });
    req.on("error", () => resolve([]));
    req.setTimeout(5000, () => { req.destroy(); resolve([]); });
  });
}

export async function GET(req: NextRequest) {
  if (!isInternalRequest(req)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const servers = await getLiveServers();

  const lines: string[] = [
    "# HELP eqemu_server_players_online Current number of players online per server",
    "# TYPE eqemu_server_players_online gauge",
    "# HELP eqemu_server_status Server status (1=online, 0=offline)",
    "# TYPE eqemu_server_status gauge",
    "# HELP eqemu_server_zones_booted Number of zones currently booted per server",
    "# TYPE eqemu_server_zones_booted gauge",
    "# HELP eqemu_servers_total Total number of connected world servers",
    "# TYPE eqemu_servers_total gauge",
    `eqemu_servers_total ${servers.length}`,
  ];

  let totalPlayers = 0;
  for (const s of servers) {
    const name = (s.server_short_name || "unknown").replace(/"/g, '\\"');
    const longName = (s.server_long_name || "unknown").replace(/"/g, '\\"');
    const labels = `server_short_name="${name}",server_long_name="${longName}"`;
    const players = s.players_online ?? 0;
    const status = s.server_status > 0 ? 1 : 0;
    const zones = s.zones_booted ?? 0;
    totalPlayers += players;

    lines.push(`eqemu_server_players_online{${labels}} ${players}`);
    lines.push(`eqemu_server_status{${labels}} ${status}`);
    lines.push(`eqemu_server_zones_booted{${labels}} ${zones}`);
  }

  lines.push("# HELP eqemu_players_online_total Total players across all servers");
  lines.push("# TYPE eqemu_players_online_total gauge");
  lines.push(`eqemu_players_online_total ${totalPlayers}`);

  return new NextResponse(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
