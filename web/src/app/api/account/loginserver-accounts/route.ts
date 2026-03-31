import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { loginAccounts, accountLoginLinks } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get all linked loginserver accounts
    const links = await db
      .select()
      .from(accountLoginLinks)
      .where(eq(accountLoginLinks.platformAccountId, session.accountId));

    if (links.length === 0) {
      return NextResponse.json([]);
    }

    // Fetch loginserver account details
    const accounts = [];
    for (const link of links) {
      const lsAccounts = await db
        .select({
          id: loginAccounts.id,
          accountName: loginAccounts.accountName,
          sourceLoginserver: loginAccounts.sourceLoginserver,
          lastLoginDate: loginAccounts.lastLoginDate,
          createdAt: loginAccounts.createdAt,
        })
        .from(loginAccounts)
        .where(eq(loginAccounts.id, link.loginAccountId));

      if (lsAccounts.length > 0) {
        accounts.push({
          ...lsAccounts[0],
          linkedAt: link.linkedAt,
        });
      }
    }

    return NextResponse.json(accounts);
  } catch (error) {
    console.error("List loginserver accounts error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
