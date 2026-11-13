import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loginWorldServers, serverProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { activityFor } from "@/lib/activity";
import { getActivityThresholds } from "@/lib/public-servers";
import { canSeeExactCounts, getLiveData } from "@/lib/servers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const slug = decodeURIComponent(rawId);
  const numId = parseInt(slug, 10);

  // Get server from DB — accept numeric ID or short_name
  const [server] = await db
    .select()
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

  // Get profile if exists
  const [profile] = await db
    .select()
    .from(serverProfiles)
    .where(eq(serverProfiles.worldServerId, server.id))
    .limit(1);

  // Live data from the loginserver, falling back to the federated cache
  let liveData: any = null;
  try {
    liveData = await getLiveData(server.shortName, server.longName);
  } catch {}

  return NextResponse.json({
    id: server.id,
    long_name: server.longName,
    short_name: server.shortName,
    tag_description: server.tagDescription,
    list_type_id: server.loginServerListTypeId,
    is_trusted: server.isServerTrusted,
    note: server.note,
    // Live data. Activity band; the exact count only for the owner / admins.
    activity: activityFor(liveData?.players_online ?? 0, await getActivityThresholds()),
    ...((await canSeeExactCounts(server)) ? { players_online: liveData?.players_online ?? 0 } : {}),
    zones_booted: liveData?.zones_booted ?? 0,
    server_status: liveData?.server_status ?? -1,
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
