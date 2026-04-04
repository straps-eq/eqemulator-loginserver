import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { platformAccounts, platformAdmins, worldServerAdminLinks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { verifyPassword } from "@/lib/password";
import { generateMfaCode, sendMfaCode } from "@/lib/email";
import { cacheSet } from "@/lib/redis";

const MFA_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`login:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again later." },
        { status: 429 }
      );
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    // Look up platform account
    const accounts = await db
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.username, username));

    if (accounts.length === 0) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    const account = accounts[0];

    if (!account.passwordHash) {
      return NextResponse.json(
        { error: "This account uses Google or Discord sign-in. Please use the OAuth buttons above." },
        { status: 400 }
      );
    }

    if (!verifyPassword(password, account.passwordHash)) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    // Check email verification
    if (!account.emailVerified) {
      return NextResponse.json(
        { error: "Please verify your email before logging in. Check your inbox for a verification link." },
        { status: 403 }
      );
    }

    // Check admin status
    const adminRows = await db
      .select({ role: platformAdmins.role })
      .from(platformAdmins)
      .where(eq(platformAdmins.loginAccountId, account.id));

    const adminRole = adminRows.length > 0 ? adminRows[0].role : null;
    const isAdmin = adminRole === "admin" || adminRole === "moderator";

    // Check if user is a server owner (has world server admin links)
    const wsLinks = await db
      .select({ id: worldServerAdminLinks.id })
      .from(worldServerAdminLinks)
      .where(eq(worldServerAdminLinks.platformAccountId, account.id))
      .limit(1);

    const isServerOwner = wsLinks.length > 0;

    // Admin and server owner accounts require email MFA
    if (isAdmin || isServerOwner) {
      const code = generateMfaCode();

      // Store code in cache with 5-min TTL (key includes attempt counter)
      await cacheSet(`mfa:${account.id}:code`, code, Math.floor(MFA_CODE_TTL_MS / 1000));
      await cacheSet(`mfa:${account.id}:attempts`, "0", Math.floor(MFA_CODE_TTL_MS / 1000));

      // Send code via email
      const sent = await sendMfaCode(account.email, code);
      if (!sent) {
        console.error(`[login] Failed to send MFA code to ${account.email}`);
      }

      // Set MFA pending session — NOT logged in yet
      const session = await getSession();
      session.isLoggedIn = false;
      session.mfaPending = true;
      session.mfaAccountId = account.id;
      session.mfaAccountName = account.username;
      session.mfaIsAdmin = isAdmin;
      session.mfaAdminRole = adminRole as "admin" | "moderator" | undefined;
      await session.save();

      // Mask email for display: j***@example.com
      const [local, domain] = account.email.split("@");
      const masked = local[0] + "***@" + domain;

      return NextResponse.json({
        mfa_required: true,
        email_hint: masked,
      });
    }

    // Regular users — direct login (no MFA)
    const session = await getSession();
    session.accountId = account.id;
    session.accountName = account.username;
    session.isLoggedIn = true;
    session.isAdmin = false;
    await session.save();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
