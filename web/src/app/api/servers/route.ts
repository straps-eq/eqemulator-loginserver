import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loginWorldServers, serverProfiles, platformConfig } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";
import http from "http";

/** Map population tier to loginserver list type id (shown in EQ client). */
const tierToListType: Record<string, number> = { high: 1, medium: 2, low: 3 };

export const dynamic = "force-dynamic";

async function getLiveServers() {
  const apiUrl = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
  const token = process.env.LOGINSERVER_API_TOKEN || "";
  return new Promise<any[]>((resolve) => {
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

/** Compute population tier from thresholds (if no manual override). */
function autoTier(playersOnline: number, highMin: number, mediumMin: number): string {
  if (playersOnline >= highMin) return "high";
  if (playersOnline >= mediumMin) return "medium";
  return "low";
}

export async function GET() {
  const [liveServers, dbServers, profiles, configRows] = await Promise.all([
    getLiveServers(),
    db.select().from(loginWorldServers),
    db.select().from(serverProfiles),
    db.select().from(platformConfig).where(
      inArray(platformConfig.configKey, ["tier_high_min_players", "tier_medium_min_players"])
    ),
  ]);

  const configMap = new Map(configRows.map((r) => [r.configKey, r.configValue]));
  const highMin = parseInt(configMap.get("tier_high_min_players") || "400", 10);
  const mediumMin = parseInt(configMap.get("tier_medium_min_players") || "100", 10);

  const enriched = liveServers.map((live: any) => {
    const dbMatch = dbServers.find(
      (d) => d.shortName === live.server_short_name || d.longName === live.server_long_name
    );
    const adminId = dbMatch?.loginServerAdminId || 0;
    const profile = dbMatch
      ? profiles.find((p) => p.worldServerId === dbMatch.id || (adminId > 0 && p.loginServerAdminId === adminId))
      : null;

    const manualTier = profile?.displayTier;
    const effectiveTier = manualTier || autoTier(live.players_online ?? 0, highMin, mediumMin);
    const showPlayerCount = profile?.showPlayerCount ?? 1;

    // Strip sensitive IPs from live server data
    const { local_ip, remote_ip, ...safeFields } = live;
    return {
      ...safeFields,
      players_online: showPlayerCount ? live.players_online : undefined,
      db_id: dbMatch?.id ?? null,
      is_trusted: dbMatch?.isServerTrusted ? true : false,
      tag_description: dbMatch?.tagDescription || null,
      is_claimed: adminId > 0,
      display_tier: effectiveTier,
      tier_override: manualTier ? true : false,
      show_player_count: !!showPlayerCount,
    };
  });

  // Auto-sync in-game list type from population tier (fire-and-forget)
  const updates: Promise<unknown>[] = [];
  for (const live of liveServers) {
    const dbMatch = dbServers.find(
      (d) => d.shortName === live.server_short_name || d.longName === live.server_long_name
    );
    if (!dbMatch) continue;
    const profile = profiles.find(
      (p) => p.worldServerId === dbMatch.id || ((dbMatch.loginServerAdminId || 0) > 0 && p.loginServerAdminId === dbMatch.loginServerAdminId)
    );
    const manualTier = profile?.displayTier;
    const tier = manualTier || autoTier(live.players_online ?? 0, highMin, mediumMin);
    const wantListType = tierToListType[tier] ?? 3;
    if (dbMatch.loginServerListTypeId !== wantListType) {
      updates.push(
        db.update(loginWorldServers)
          .set({ loginServerListTypeId: wantListType })
          .where(eq(loginWorldServers.id, dbMatch.id))
      );
    }
  }
  if (updates.length > 0) {
    try { await Promise.all(updates); } catch (e) { console.error("[servers] list type sync error:", e); }
  }

  return NextResponse.json(enriched);
}
