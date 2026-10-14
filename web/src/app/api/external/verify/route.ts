import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loginAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyScryptHash } from "@/lib/scrypt-verify";
import { validateCredentials, validateExternalCredentials } from "@/lib/loginserver-api";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

const API_KEY = process.env.EXTERNAL_AUTH_API_KEY || "";

/**
 * External credential verification endpoint.
 *
 * Allows a trusted third-party website to verify a loginserver
 * account's credentials without creating any session.
 *
 * Requires a valid API key in the Authorization header:
 *   Authorization: Bearer <EXTERNAL_AUTH_API_KEY>
 *
 * POST /api/external/verify
 * Body: { "username": "...", "password": "..." }
 *
 * 200: { "success": true,  "account_id": 123, "account_name": "foo" }
 * 401: { "success": false, "error": "..." }
 */
export async function POST(request: NextRequest) {
  try {
    // ── API key check ──
    if (!API_KEY) {
      return NextResponse.json(
        { success: false, error: "External auth not configured" },
        { status: 503 }
      );
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token || token !== API_KEY) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // ── Rate limit per IP ──
    const ip = getClientIp(request);
    const rl = await rateLimit(`ext-verify:${ip}`, 30, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: "Rate limited", retry_after_ms: rl.retryAfterMs },
        { status: 429 }
      );
    }

    // ── Parse body ──
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { success: false, error: "username and password are required" },
        { status: 400 }
      );
    }

    // ── 1. Try local DB hash verification ──
    const lsAccounts = await db
      .select({
        id: loginAccounts.id,
        accountName: loginAccounts.accountName,
        accountPassword: loginAccounts.accountPassword,
      })
      .from(loginAccounts)
      .where(eq(loginAccounts.accountName, username));

    for (const acct of lsAccounts) {
      if (await verifyScryptHash(password, acct.accountPassword)) {
        return NextResponse.json({
          success: true,
          account_id: acct.id,
          account_name: acct.accountName,
        });
      }
    }

    // ── 2. Try loginserver API (local source) ──
    const localResult = await validateCredentials(username, password);
    if (localResult.ok && localResult.data?.data?.account_id) {
      return NextResponse.json({
        success: true,
        account_id: localResult.data.data.account_id,
        account_name: username,
      });
    }

    // ── 3. Try external/LSPX upstream ──
    const extResult = await validateExternalCredentials(username, password);
    if (extResult.ok && extResult.data?.data?.account_id) {
      return NextResponse.json({
        success: true,
        account_id: extResult.data.data.account_id,
        account_name: username,
      });
    }

    // ── All methods failed ──
    return NextResponse.json(
      { success: false, error: "Invalid credentials" },
      { status: 401 }
    );
  } catch (error) {
    console.error("External verify error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
