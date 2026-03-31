import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import {
  platformAccounts,
  platformAdmins,
  accountLoginLinks,
  worldServerAdminLinks,
  serverProfiles,
  loginServerAdmins,
} from "@/db/schema";
import { eq } from "drizzle-orm";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.accountId || !session.isAdmin) {
    return null;
  }
  return session;
}

// PUT — admin actions on an account
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const accountId = parseInt(id, 10);
    if (isNaN(accountId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const body = await request.json();

    if (body.action === "verify_email") {
      await db
        .update(platformAccounts)
        .set({ emailVerified: 1, verificationToken: null })
        .where(eq(platformAccounts.id, accountId));
      return NextResponse.json({ success: true });
    }

    if (body.action === "unverify_email") {
      await db
        .update(platformAccounts)
        .set({ emailVerified: 0 })
        .where(eq(platformAccounts.id, accountId));
      return NextResponse.json({ success: true });
    }

    if (body.action === "set_role") {
      const { role } = body;
      if (role === null) {
        // Remove admin
        await db.delete(platformAdmins).where(eq(platformAdmins.loginAccountId, accountId));
        return NextResponse.json({ success: true });
      }
      if (role !== "admin" && role !== "moderator") {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      const existing = await db
        .select()
        .from(platformAdmins)
        .where(eq(platformAdmins.loginAccountId, accountId));
      if (existing.length > 0) {
        await db
          .update(platformAdmins)
          .set({ role })
          .where(eq(platformAdmins.loginAccountId, accountId));
      } else {
        await db.insert(platformAdmins).values({
          loginAccountId: accountId,
          role,
          createdAt: new Date(),
        });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Admin account update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE — delete a platform account
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const accountId = parseInt(id, 10);
    if (isNaN(accountId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    // Don't allow self-deletion
    if (accountId === session.accountId) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    // Delete related data
    await db.delete(platformAdmins).where(eq(platformAdmins.loginAccountId, accountId));
    await db.delete(accountLoginLinks).where(eq(accountLoginLinks.platformAccountId, accountId));

    // Delete worldserver admin links (but not the admin accounts themselves)
    await db.delete(worldServerAdminLinks).where(eq(worldServerAdminLinks.platformAccountId, accountId));

    // Delete platform account
    await db.delete(platformAccounts).where(eq(platformAccounts.id, accountId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin account delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
