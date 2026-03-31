import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { platformAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`resend-verify:${ip}`, 3, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Try again in 15 minutes." },
        { status: 429 }
      );
    }

    const { username } = await request.json();

    if (!username || typeof username !== "string") {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 }
      );
    }

    // Find account by username
    const accounts = await db
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.username, username));

    if (accounts.length === 0) {
      // Don't reveal whether account exists
      return NextResponse.json({ success: true });
    }

    const account = accounts[0];

    if (account.emailVerified) {
      return NextResponse.json({ success: true, alreadyVerified: true });
    }

    // Generate new token and expiry
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db
      .update(platformAccounts)
      .set({
        verificationToken: token,
        verificationExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(platformAccounts.id, account.id));

    // Send verification email
    await sendVerificationEmail(account.email, token);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Resend verification error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
