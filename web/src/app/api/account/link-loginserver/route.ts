import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { loginAccounts, accountLoginLinks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyScryptHash, createScryptHash } from "@/lib/scrypt-verify";
import { validateCredentials, validateExternalCredentials } from "@/lib/loginserver-api";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`link:${ip}`, 15, 15 * 60 * 1000);
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

    // Find the loginserver account locally first
    let lsAccounts = await db
      .select()
      .from(loginAccounts)
      .where(eq(loginAccounts.accountName, username));

    let matched = null;

    if (lsAccounts.length > 0) {
      // Verify password against stored hash
      for (const acct of lsAccounts) {
        if (await verifyScryptHash(password, acct.accountPassword)) {
          matched = acct;
          break;
        }
      }
    }

    // If not found locally, try the loginserver API (checks source_loginserver='local')
    if (!matched) {
      const localResult = await validateCredentials(username, password);
      if (localResult.ok && localResult.data?.data?.account_id) {
        lsAccounts = await db
          .select()
          .from(loginAccounts)
          .where(eq(loginAccounts.accountName, username));

        if (lsAccounts.length > 0) {
          matched = lsAccounts[0];
        }
      }
    }

    // If still not found, try external/LSPX upstream (login.eqemulator.net)
    // This simulates what the EQ client does — authenticates via the upstream
    // loginserver over TCP. If valid, we cache the account locally.
    if (!matched) {
      const extResult = await validateExternalCredentials(username, password);
      if (extResult.ok && extResult.data?.data?.account_id) {
        const upstreamId = extResult.data.data.account_id;

        // Cache the account locally with a scrypt hash of the password
        const hash = await createScryptHash(password);
        try {
          await db.insert(loginAccounts).values({
            id: upstreamId,
            accountName: username,
            accountPassword: hash,
            accountEmail: "",
            sourceLoginserver: "eqemu",
            lastIpAddress: "",
            lastLoginDate: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } catch (insertErr: unknown) {
          // ID conflict — account may already exist with different name or was just synced
          const msg = insertErr instanceof Error ? insertErr.message : "";
          if (!msg.includes("Duplicate")) throw insertErr;
        }

        const cached = await db
          .select()
          .from(loginAccounts)
          .where(eq(loginAccounts.id, upstreamId))
          .limit(1);

        if (cached.length > 0) {
          matched = cached[0];
        }
      }
    }

    if (!matched) {
      return NextResponse.json(
        { error: "Invalid username or password" },
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
