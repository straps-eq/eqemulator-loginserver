import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { loginAccounts, accountLoginLinks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyScryptHash } from "@/lib/scrypt-verify";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`link:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 }
      );
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Loginserver username and password are required" },
        { status: 400 }
      );
    }

    // Find the loginserver account
    const lsAccounts = await db
      .select()
      .from(loginAccounts)
      .where(eq(loginAccounts.accountName, username));

    if (lsAccounts.length === 0) {
      return NextResponse.json(
        { error: "Loginserver account not found" },
        { status: 404 }
      );
    }

    // Verify password against stored hash
    let matched = null;
    for (const acct of lsAccounts) {
      if (await verifyScryptHash(password, acct.accountPassword)) {
        matched = acct;
        break;
      }
    }

    if (!matched) {
      return NextResponse.json(
        { error: "Invalid password for that loginserver account" },
        { status: 401 }
      );
    }

    // Check if already linked to someone
    const existingLink = await db
      .select()
      .from(accountLoginLinks)
      .where(eq(accountLoginLinks.loginAccountId, matched.id));

    if (existingLink.length > 0) {
      if (existingLink[0].platformAccountId === session.accountId) {
        return NextResponse.json(
          { error: "This loginserver account is already linked to your account" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "This loginserver account is already claimed by another user" },
        { status: 400 }
      );
    }

    // Create the link (do NOT change source_loginserver — world servers use it as part of player identity)
    await db.insert(accountLoginLinks).values({
      platformAccountId: session.accountId,
      loginAccountId: matched.id,
      linkedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      loginAccountId: matched.id,
      loginAccountName: matched.accountName,
      converted: matched.sourceLoginserver !== "local",
    });
  } catch (error) {
    console.error("Link loginserver error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
