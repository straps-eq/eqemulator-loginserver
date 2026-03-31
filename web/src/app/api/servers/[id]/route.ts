import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loginWorldServers, serverProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid server ID" }, { status: 400 });
  }

  // Get server from DB
  const [server] = await db
    .select()
    .from(loginWorldServers)
    .where(eq(loginWorldServers.id, id))
    .limit(1);

  if (!server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  // Get profile if exists
  const [profile] = await db
    .select()
    .from(serverProfiles)
    .where(eq(serverProfiles.worldServerId, id))
    .limit(1);

  // Get live data from loginserver API
  let liveData = null;
  try {
    const http = require("http");
    const apiUrl = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
    const token = process.env.LOGINSERVER_API_TOKEN || "";
    const liveServers: any[] = await new Promise((resolve) => {
      const req = http.get(`${apiUrl}/v1/servers/list`, {
        headers: { Authorization: `Bearer ${token}` },
      }, (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => data += chunk);
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

    liveData = liveServers.find(
      (s) => s.server_short_name === server.shortName || s.server_long_name === server.longName
    );
  } catch {}

  return NextResponse.json({
    id: server.id,
    long_name: server.longName,
    short_name: server.shortName,
    tag_description: server.tagDescription,
    list_type_id: server.loginServerListTypeId,
    is_trusted: server.isServerTrusted,
    note: server.note,
    // Live data
    players_online: liveData?.players_online ?? 0,
    zones_booted: liveData?.zones_booted ?? 0,
    server_status: liveData?.server_status ?? 0,
    // Profile data
    profile: profile ? {
      description: profile.description,
      website_url: profile.websiteUrl,
      discord_url: profile.discordUrl,
      banner_image_url: profile.bannerImageUrl,
      expansion_era: profile.expansionEra,
      custom_ruleset: profile.customRuleset,
      tags: profile.tags,
    } : null,
  });
}
