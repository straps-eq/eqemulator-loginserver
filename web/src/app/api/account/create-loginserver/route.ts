import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { loginAccounts, accountLoginLinks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createAccount } from "@/lib/loginserver-api";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`create-ls:${ip}`, 10, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
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

    // Check if username already exists locally (includes LSPX-cached accounts)
    const existing = await db
      .select({ id: loginAccounts.id })
      .from(loginAccounts)
      .where(eq(loginAccounts.accountName, username));

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "This username is already taken. If it's yours, use 'Link Existing Account' instead." },
        { status: 400 }
      );
    }

    // Create via loginserver API
    const result = await createAccount(username, password);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Failed to create loginserver account" },
        { status: 400 }
      );
    }

    const loginAccountId = result.data?.data?.account_id;
    if (!loginAccountId) {
      return NextResponse.json(
        { error: "Account created but no ID returned" },
        { status: 500 }
      );
    }

    // Link to platform account
    await db.insert(accountLoginLinks).values({
      platformAccountId: session.accountId,
      loginAccountId,
      linkedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      loginAccountId,
      loginAccountName: username,
    });
  } catch (error) {
    console.error("Create loginserver account error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
