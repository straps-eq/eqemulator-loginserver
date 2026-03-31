import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { loginServerAdmins, worldServerAdminLinks, loginWorldServers, serverProfiles } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createScryptHash } from "@/lib/scrypt-verify";
import { rateLimit } from "@/lib/rate-limit";
import { appendChangelog } from "@/lib/federation/changelog";
import { encryptString, decryptString } from "@/lib/federation/crypto";

// GET — list the current user's world server admin accounts + any connected servers
export async function GET() {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get all linked admin accounts for this platform user
    const links = await db
      .select()
      .from(worldServerAdminLinks)
      .where(eq(worldServerAdminLinks.platformAccountId, session.accountId));

    if (links.length === 0) {
      return NextResponse.json({ accounts: [] });
    }

    const adminIds = links.map((l) => l.loginServerAdminId);

    // Get admin account details
    const admins = await db
      .select({
        id: loginServerAdmins.id,
        accountName: loginServerAdmins.accountName,
        registrationDate: loginServerAdmins.registrationDate,
      })
      .from(loginServerAdmins)
      .where(inArray(loginServerAdmins.id, adminIds));

    // Get any world servers linked to these admin accounts (exclude IP addresses)
    const servers = await db
      .select({
        id: loginWorldServers.id,
        longName: loginWorldServers.longName,
        shortName: loginWorldServers.shortName,
        tagDescription: loginWorldServers.tagDescription,
        loginServerListTypeId: loginWorldServers.loginServerListTypeId,
        loginServerAdminId: loginWorldServers.loginServerAdminId,
        isServerTrusted: loginWorldServers.isServerTrusted,
      })
      .from(loginWorldServers)
      .where(inArray(loginWorldServers.loginServerAdminId, adminIds));

    // Build a map of admin ID → decrypted password from links
    const passwordMap = new Map<number, string>();
    for (const l of links) {
      try {
        const decrypted = l.accountPassword ? await decryptString(l.accountPassword) : "";
        passwordMap.set(l.loginServerAdminId, decrypted);
      } catch {
        passwordMap.set(l.loginServerAdminId, "");
      }
    }

    // Get server profiles for these admin accounts
    const profiles = await db
      .select()
      .from(serverProfiles)
      .where(inArray(serverProfiles.loginServerAdminId, adminIds));

    const profileMap = new Map(profiles.map((p) => [p.loginServerAdminId, p]));

    // Combine into response
    const accounts = admins.map((admin) => ({
      ...admin,
      password: passwordMap.get(admin.id) || "",
      servers: servers.filter((s) => s.loginServerAdminId === admin.id),
      profile: profileMap.get(admin.id) || null,
    }));

    return NextResponse.json({ accounts });
  } catch (error) {
    console.error("Worldserver accounts list error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST — create a new world server admin account
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.isLoggedIn || !session.accountId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`ws-create:${ip}`, 5, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 }
      );
    }

    const { accountName, password } = await request.json();

    if (!accountName || !password) {
      return NextResponse.json(
        { error: "Account name and password are required" },
        { status: 400 }
      );
    }

    if (accountName.length < 3 || accountName.length > 30) {
      return NextResponse.json(
        { error: "Account name must be 3-30 characters" },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_]+$/.test(accountName)) {
      return NextResponse.json(
        { error: "Account name may only contain letters, numbers, and underscores" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check if account name already exists
    const existing = await db
      .select({ id: loginServerAdmins.id })
      .from(loginServerAdmins)
      .where(eq(loginServerAdmins.accountName, accountName));

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "An account with that name already exists" },
        { status: 409 }
      );
    }

    // Hash password in $7$ escrypt format (compatible with loginserver C++)
    const hashedPassword = await createScryptHash(password);

    // Insert admin account
    const result = await db.insert(loginServerAdmins).values({
      accountName,
      accountPassword: hashedPassword,
      firstName: "",
      lastName: "",
      email: "",
      registrationDate: new Date(),
      registrationIpAddress: ip,
    });

    const adminId = Number(result[0].insertId);

    // Federation changelog (exclude IP — PII should not propagate)
    await appendChangelog("login_server_admins", adminId, "insert", {
      id: adminId,
      account_name: accountName,
      account_password: hashedPassword,
      first_name: "",
      last_name: "",
      email: "",
      registration_date: new Date().toISOString(),
    });

    // Link to platform account (encrypt password for operator retrieval)
    const encryptedPassword = await encryptString(password);
    await db.insert(worldServerAdminLinks).values({
      platformAccountId: session.accountId,
      loginServerAdminId: adminId,
      accountPassword: encryptedPassword,
      linkedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      adminId,
      accountName,
    });
  } catch (error) {
    console.error("Worldserver account create error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
