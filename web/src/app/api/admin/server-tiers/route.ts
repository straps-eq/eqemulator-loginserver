import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { serverProfiles, platformConfig } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.isAdmin) {
    return null;
  }
  return session;
}

// GET — return current tier config + per-server overrides
export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [configRows, profiles] = await Promise.all([
    db.select().from(platformConfig).where(
      inArray(platformConfig.configKey, ["tier_high_min_players", "tier_medium_min_players"])
    ),
    db.select({
      worldServerId: serverProfiles.worldServerId,
      displayTier: serverProfiles.displayTier,
    }).from(serverProfiles),
  ]);

  const config: Record<string, string> = {
    tier_high_min_players: "400",
    tier_medium_min_players: "100",
  };
  for (const row of configRows) {
    config[row.configKey] = row.configValue;
  }

  // Map of db_id → manual tier override (only non-null)
  const overrides: Record<string, string> = {};
  for (const p of profiles) {
    if (p.displayTier) {
      overrides[String(p.worldServerId)] = p.displayTier;
    }
  }

  return NextResponse.json({ config, overrides });
}

// POST — update config or set per-server tier
export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;

  if (action === "update_config") {
    const { config } = body;
    if (!config || typeof config !== "object") {
      return NextResponse.json({ error: "config object required" }, { status: 400 });
    }

    const highMin = parseInt(config.tier_high_min_players, 10);
    const mediumMin = parseInt(config.tier_medium_min_players, 10);

    if (isNaN(highMin) || highMin < 1 || isNaN(mediumMin) || mediumMin < 1) {
      return NextResponse.json({ error: "Thresholds must be positive integers" }, { status: 400 });
    }
    if (mediumMin >= highMin) {
      return NextResponse.json({ error: "Medium threshold must be less than High threshold" }, { status: 400 });
    }

    // Upsert config values
    for (const [key, value] of Object.entries({ tier_high_min_players: String(highMin), tier_medium_min_players: String(mediumMin) })) {
      await db
        .insert(platformConfig)
        .values({ configKey: key, configValue: value, updatedAt: new Date() })
        .onDuplicateKeyUpdate({ set: { configValue: value, updatedAt: new Date() } });
    }

    return NextResponse.json({ success: true });
  }

  if (action === "set_tier") {
    const { db_id, tier } = body;
    if (!db_id || typeof db_id !== "number") {
      return NextResponse.json({ error: "Valid db_id required" }, { status: 400 });
    }
    if (tier !== null && tier !== "high" && tier !== "medium" && tier !== "low") {
      return NextResponse.json({ error: "tier must be 'high', 'medium', 'low', or null (auto)" }, { status: 400 });
    }

    // Check if profile exists
    const existing = await db
      .select({ id: serverProfiles.id })
      .from(serverProfiles)
      .where(eq(serverProfiles.worldServerId, db_id));

    if (existing.length === 0) {
      // Create a minimal profile for this server
      await db.insert(serverProfiles).values({
        worldServerId: db_id,
        displayTier: tier || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      await db
        .update(serverProfiles)
        .set({ displayTier: tier || null, updatedAt: new Date() })
        .where(eq(serverProfiles.worldServerId, db_id));
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
