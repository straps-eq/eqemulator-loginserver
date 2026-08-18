import { NextRequest, NextResponse } from "next/server";
import http from "http";
import { dedupeLiveServers } from "@/lib/loginserver-api";

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

/**
 * Fetch the live world server list, or null if the loginserver could not be
 * reached or returned something unusable.
 *
 * The null case must stay distinguishable from an empty list: reporting 0 when
 * the loginserver is simply unreachable writes a false zero into the population
 * history, which permanently skews averages and peaks over that window.
 */
async function getLiveServers(): Promise<any[] | null> {
  const apiUrl = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
  const token = process.env.LOGINSERVER_API_TOKEN || "";
  return new Promise((resolve) => {
    const req = http.get(`${apiUrl}/v1/servers/list`, {
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) { resolve(null); return; }
        try {
          const json = JSON.parse(data);
          if (!Array.isArray(json)) { resolve(null); return; }
          resolve(dedupeLiveServers(json));
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

export async function GET(req: NextRequest) {
  if (!isInternalRequest(req)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const servers = await getLiveServers();

  const lines: string[] = [
    "# HELP eqemu_loginserver_up Whether the loginserver API responded for this scrape",
    "# TYPE eqemu_loginserver_up gauge",
    `eqemu_loginserver_up ${servers === null ? 0 : 1}`,
  ];

  // When the loginserver is unreachable, deliberately emit no server or
  // population series. Prometheus then marks them stale, leaving an honest gap
  // in the graph rather than ingesting a 0 that never actually happened.
  // A reachable-but-empty list still reports 0, because that is real data.
  if (servers !== null) {
    lines.push(
      "# HELP eqemu_server_players_online Current number of players online per server",
      "# TYPE eqemu_server_players_online gauge",
      "# HELP eqemu_server_status Server status (1=online, 0=offline)",
      "# TYPE eqemu_server_status gauge",
      "# HELP eqemu_server_zones_booted Number of zones currently booted per server",
      "# TYPE eqemu_server_zones_booted gauge",
      "# HELP eqemu_servers_total Total number of connected world servers",
      "# TYPE eqemu_servers_total gauge",
      `eqemu_servers_total ${servers.length}`,
    );

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
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
