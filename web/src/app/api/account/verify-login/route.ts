import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { cacheGet, cacheSet } from "@/lib/redis";

const MAX_ATTEMPTS = 5;

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`mfa-verify:${ip}`, 10, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 }
      );
    }

    const session = await getSession();
    if (!session.mfaPending || !session.mfaAccountId) {
      return NextResponse.json(
        { error: "No pending verification. Please log in again." },
        { status: 400 }
      );
    }

    const { code } = await request.json();
    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: "Please enter a valid 6-digit code" },
        { status: 400 }
      );
    }

    const accountId = session.mfaAccountId;

    // Check attempt count
    const attemptsStr = await cacheGet(`mfa:${accountId}:attempts`);
    const attempts = parseInt(attemptsStr || "0", 10);
    if (attempts >= MAX_ATTEMPTS) {
      // Clear MFA state — force re-login
      session.mfaPending = false;
      session.mfaAccountId = undefined;
      session.mfaAccountName = undefined;
      session.mfaIsAdmin = undefined;
      session.mfaAdminRole = undefined;
      await session.save();
      return NextResponse.json(
        { error: "Too many failed attempts. Please log in again." },
        { status: 429 }
      );
    }

    // Get stored code
    const storedCode = await cacheGet(`mfa:${accountId}:code`);
    if (!storedCode) {
      session.mfaPending = false;
      session.mfaAccountId = undefined;
      session.mfaAccountName = undefined;
      session.mfaIsAdmin = undefined;
      session.mfaAdminRole = undefined;
      await session.save();
      return NextResponse.json(
        { error: "Verification code expired. Please log in again." },
        { status: 400 }
      );
    }

    // Constant-time comparison to prevent timing attacks
    if (code.length !== storedCode.length || !timingSafeEqual(code, storedCode)) {
      await cacheSet(`mfa:${accountId}:attempts`, String(attempts + 1), 300);
      return NextResponse.json(
        { error: "Invalid verification code", attempts_remaining: MAX_ATTEMPTS - attempts - 1 },
        { status: 401 }
      );
    }

    // Code valid — complete login
    session.accountId = session.mfaAccountId;
    session.accountName = session.mfaAccountName;
    session.isLoggedIn = true;
    session.isAdmin = session.mfaIsAdmin || false;
    session.adminRole = session.mfaAdminRole;
    session.mfaPending = undefined;
    session.mfaAccountId = undefined;
    session.mfaAccountName = undefined;
    session.mfaIsAdmin = undefined;
    session.mfaAdminRole = undefined;
    await session.save();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("MFA verification error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** Constant-time string comparison to prevent timing attacks on MFA codes. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
