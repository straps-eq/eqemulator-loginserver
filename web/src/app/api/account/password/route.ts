import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { platformAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { verifyPassword, hashPassword } from "@/lib/password";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session.isLoggedIn || !session.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`password:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 }
      );
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current and new password are required" },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Verify current password against platform account
    const accounts = await db
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.id, session.accountId));

    if (accounts.length === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    if (!verifyPassword(currentPassword, accounts[0].passwordHash)) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 }
      );
    }

    // Update platform account password
    await db
      .update(platformAccounts)
      .set({ passwordHash: hashPassword(newPassword) })
      .where(eq(platformAccounts.id, session.accountId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Password change error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
