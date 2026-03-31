import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { platformAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`verify-email:${ip}`, 10, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 }
      );
    }

    const { token } = await request.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "Invalid verification token" },
        { status: 400 }
      );
    }

    // Find account with this token
    const accounts = await db
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.verificationToken, token));

    if (accounts.length === 0) {
      return NextResponse.json(
        { error: "Invalid or expired verification link" },
        { status: 400 }
      );
    }

    const account = accounts[0];

    if (account.emailVerified) {
      return NextResponse.json({ success: true, alreadyVerified: true });
    }

    // Check expiration
    if (
      account.verificationExpiresAt &&
      new Date(account.verificationExpiresAt) < new Date()
    ) {
      return NextResponse.json(
        { error: "Verification link has expired. Please register again." },
        { status: 400 }
      );
    }

    // Mark as verified
    await db
      .update(platformAccounts)
      .set({
        emailVerified: 1,
        verificationToken: null,
        verificationExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(platformAccounts.id, account.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Email verification error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
