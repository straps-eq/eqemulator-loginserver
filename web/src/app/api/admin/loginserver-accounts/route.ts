import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import {
  loginAccounts,
  platformAdmins,
  platformAccounts,
  accountLoginLinks,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { updatePassword } from "@/lib/loginserver-api";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.accountId) {
    return null;
  }
  const adminCheck = await db
    .select({ role: platformAdmins.role })
    .from(platformAdmins)
    .where(eq(platformAdmins.loginAccountId, session.accountId));
  if (adminCheck.length === 0 || (adminCheck[0].role !== "admin" && adminCheck[0].role !== "moderator")) {
    return null;
  }
  return session;
}

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get all loginserver accounts (exclude password hash and IPs)
    const accounts = await db
      .select({
        id: loginAccounts.id,
        accountName: loginAccounts.accountName,
        accountEmail: loginAccounts.accountEmail,
        sourceLoginserver: loginAccounts.sourceLoginserver,
        lastLoginDate: loginAccounts.lastLoginDate,
        createdAt: loginAccounts.createdAt,
      })
      .from(loginAccounts)
      .orderBy(sql`${loginAccounts.id} DESC`);

    // Get platform account links
    const links = await db
      .select({
        loginAccountId: accountLoginLinks.loginAccountId,
        platformAccountId: accountLoginLinks.platformAccountId,
      })
      .from(accountLoginLinks);

    // Get platform account names for linked accounts
    const platformAccountsList = await db
      .select({
        id: platformAccounts.id,
        username: platformAccounts.username,
      })
      .from(platformAccounts);
    const platformMap = new Map(platformAccountsList.map((a) => [a.id, a.username]));

    const linkMap = new Map<number, { platformAccountId: number; platformUsername: string }>();
    for (const l of links) {
      linkMap.set(l.loginAccountId, {
        platformAccountId: l.platformAccountId,
        platformUsername: platformMap.get(l.platformAccountId) || "unknown",
      });
    }

    // Enrich accounts
    const enriched = accounts.map((acct) => {
      const link = linkMap.get(acct.id);
      return {
        ...acct,
        linkedPlatformAccount: link || null,
      };
    });

    // Stats
    const totalAccounts = accounts.length;
    const lspxAccounts = accounts.filter((a) => a.sourceLoginserver === "eqemu").length;
    const localAccounts = accounts.filter((a) => a.sourceLoginserver === "local").length;
    const linkedAccounts = linkMap.size;

    return NextResponse.json({
      accounts: enriched,
      stats: {
        totalAccounts,
        lspxAccounts,
        localAccounts,
        linkedAccounts,
      },
    });
  } catch (error) {
    console.error("Admin loginserver accounts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { action, accountId } = body;

    if (!action || !accountId) {
      return NextResponse.json({ error: "Missing action or accountId" }, { status: 400 });
    }

    // Verify the account exists
    const [account] = await db
      .select({ id: loginAccounts.id, accountName: loginAccounts.accountName })
      .from(loginAccounts)
      .where(eq(loginAccounts.id, accountId));

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    switch (action) {
      case "reset_password": {
        const { newPassword } = body;
        if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
          return NextResponse.json({ error: "Password must be 8-128 characters" }, { status: 400 });
        }
        const result = await updatePassword(account.accountName, newPassword);
        if (!result.ok) {
          return NextResponse.json({ error: result.error || "Failed to update password" }, { status: 500 });
        }
        return NextResponse.json({ success: true, message: "Password reset" });
      }

      case "delete": {
        // Don't allow deleting your own loginserver account
        const selfLinks = await db
          .select({ loginAccountId: accountLoginLinks.loginAccountId })
          .from(accountLoginLinks)
          .where(eq(accountLoginLinks.platformAccountId, session.accountId!));
        if (selfLinks.some((l) => l.loginAccountId === accountId)) {
          return NextResponse.json({ error: "Cannot delete your own linked loginserver account" }, { status: 400 });
        }

        // Remove platform link if exists
        await db
          .delete(accountLoginLinks)
          .where(eq(accountLoginLinks.loginAccountId, accountId));

        // Delete the loginserver account
        await db
          .delete(loginAccounts)
          .where(eq(loginAccounts.id, accountId));

        return NextResponse.json({ success: true, message: "Account deleted" });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Admin loginserver accounts action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
