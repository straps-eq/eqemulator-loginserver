import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { platformAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendVerificationEmail } from "@/lib/email";
import { hashPassword } from "@/lib/password";

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`register:${ip}`, 3, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many registration attempts. Try again later." },
        { status: 429 }
      );
    }

    const { username, password, email, turnstileToken } = await request.json();

    // Verify captcha
    const captchaValid = await verifyTurnstile(turnstileToken || "", ip);
    if (!captchaValid) {
      return NextResponse.json(
        { error: "Captcha verification failed. Please try again." },
        { status: 400 }
      );
    }

    if (!username || !password || !email) {
      return NextResponse.json(
        { error: "Username, email, and password are required" },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address" },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 30) {
      return NextResponse.json(
        { error: "Username must be 3–30 characters" },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json(
        { error: "Username may only contain letters, numbers, and underscores" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check if username already taken
    const existing = await db
      .select({ id: platformAccounts.id })
      .from(platformAccounts)
      .where(eq(platformAccounts.username, username));

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 400 }
      );
    }

    // Check if email already used
    const existingEmail = await db
      .select({ id: platformAccounts.id })
      .from(platformAccounts)
      .where(eq(platformAccounts.email, email));

    if (existingEmail.length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      );
    }

    // Create platform account (no loginserver account — that's separate)
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const result = await db.insert(platformAccounts).values({
      username,
      email,
      passwordHash: hashPassword(password),
      emailVerified: 0,
      verificationToken: token,
      verificationExpiresAt: expiresAt,
      createdAt: new Date(),
    });

    // Send verification email (non-blocking)
    sendVerificationEmail(email, token).catch((err) =>
      console.error("[register] Failed to send verification email:", err)
    );

    return NextResponse.json({ success: true, needsVerification: true });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
