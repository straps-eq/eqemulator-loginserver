import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import {
  loginServerAdmins,
  worldServerAdminLinks,
  serverProfiles,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createScryptHash } from "@/lib/scrypt-verify";
import { appendChangelog } from "@/lib/federation/changelog";
import { encryptString } from "@/lib/federation/crypto";

// Verify the caller owns this admin account
async function verifyOwnership(adminId: number, platformAccountId: number) {
  const links = await db
    .select()
    .from(worldServerAdminLinks)
    .where(
      and(
        eq(worldServerAdminLinks.loginServerAdminId, adminId),
        eq(worldServerAdminLinks.platformAccountId, platformAccountId)
      )
    );
  return links.length > 0 ? links[0] : null;
}

// PUT — update password or server profile
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const adminId = parseInt(id, 10);
    if (isNaN(adminId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const link = await verifyOwnership(adminId, session.accountId);
    if (!link) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();

    // Password reset
    if (body.action === "reset_password") {
      const { password } = body;
      if (!password || password.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters" },
          { status: 400 }
        );
      }

      const hashedPassword = await createScryptHash(password);

      // Update hash in login_server_admins (for loginserver auth)
      await db
        .update(loginServerAdmins)
        .set({ accountPassword: hashedPassword })
        .where(eq(loginServerAdmins.id, adminId));

      // Update encrypted password in link table (for operator retrieval)
      const encryptedPassword = await encryptString(password);
      await db
        .update(worldServerAdminLinks)
        .set({ accountPassword: encryptedPassword })
        .where(eq(worldServerAdminLinks.loginServerAdminId, adminId));

      await appendChangelog("login_server_admins", adminId, "update", {
        id: adminId,
        account_password: hashedPassword,
      });

      return NextResponse.json({ success: true });
    }

    // Update server profile
    if (body.action === "update_profile") {
      const { description, websiteUrl, discordUrl, expansionEra } = body;

      // Check if profile exists for this admin
      const existing = await db
        .select()
        .from(serverProfiles)
        .where(eq(serverProfiles.loginServerAdminId, adminId));

      if (existing.length > 0) {
        await db
          .update(serverProfiles)
          .set({
            description: description || null,
            websiteUrl: websiteUrl || null,
            discordUrl: discordUrl || null,
            expansionEra: expansionEra || null,
            updatedAt: new Date(),
          })
          .where(eq(serverProfiles.loginServerAdminId, adminId));

        await appendChangelog("server_profiles", existing[0].id, "update", {
          id: existing[0].id,
          description: description || null,
          website_url: websiteUrl || null,
          discord_url: discordUrl || null,
          expansion_era: expansionEra || null,
        });
      } else {
        const [insertResult] = await db.insert(serverProfiles).values({
          worldServerId: 0,
          loginServerAdminId: adminId,
          description: description || null,
          websiteUrl: websiteUrl || null,
          discordUrl: discordUrl || null,
          expansionEra: expansionEra || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await appendChangelog("server_profiles", Number(insertResult.insertId), "insert", {
          id: Number(insertResult.insertId),
          world_server_id: 0,
          login_server_admin_id: adminId,
          description: description || null,
          website_url: websiteUrl || null,
          discord_url: discordUrl || null,
          expansion_era: expansionEra || null,
        });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Worldserver account update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE — remove a world server admin account
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const adminId = parseInt(id, 10);
    if (isNaN(adminId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const link = await verifyOwnership(adminId, session.accountId);
    if (!link) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Delete profile, link, then admin account
    const profiles = await db.select({ id: serverProfiles.id }).from(serverProfiles).where(eq(serverProfiles.loginServerAdminId, adminId));
    await db.delete(serverProfiles).where(eq(serverProfiles.loginServerAdminId, adminId));
    await db.delete(worldServerAdminLinks).where(eq(worldServerAdminLinks.loginServerAdminId, adminId));
    await db.delete(loginServerAdmins).where(eq(loginServerAdmins.id, adminId));

    // Changelog: local deletes only (not propagated per origin authority)
    for (const p of profiles) {
      await appendChangelog("server_profiles", p.id, "delete", { id: p.id });
    }
    await appendChangelog("login_server_admins", adminId, "delete", { id: adminId });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Worldserver account delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
