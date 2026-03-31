import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import {
  platformAccounts,
  platformAdmins,
  accountLoginLinks,
  worldServerAdminLinks,
  loginWorldServers,
  loginServerAdmins,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

async function requireAdmin() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.accountId || !session.isAdmin) {
    return null;
  }
  return session;
}

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get all platform accounts
    const accounts = await db
      .select({
        id: platformAccounts.id,
        username: platformAccounts.username,
        email: platformAccounts.email,
        emailVerified: platformAccounts.emailVerified,
        createdAt: platformAccounts.createdAt,
      })
      .from(platformAccounts);

    // Get admin roles
    const admins = await db
      .select({
        loginAccountId: platformAdmins.loginAccountId,
        role: platformAdmins.role,
      })
      .from(platformAdmins);
    const adminMap = new Map(admins.map((a) => [a.loginAccountId, a.role]));

    // Get login links (platform account -> loginserver account)
    const loginLinks = await db
      .select({
        platformAccountId: accountLoginLinks.platformAccountId,
        loginAccountId: accountLoginLinks.loginAccountId,
      })
      .from(accountLoginLinks);
    const loginLinkMap = new Map<number, number[]>();
    for (const l of loginLinks) {
      const arr = loginLinkMap.get(l.platformAccountId) || [];
      arr.push(l.loginAccountId);
      loginLinkMap.set(l.platformAccountId, arr);
    }

    // Get worldserver admin links
    const wsLinks = await db
      .select({
        platformAccountId: worldServerAdminLinks.platformAccountId,
        loginServerAdminId: worldServerAdminLinks.loginServerAdminId,
      })
      .from(worldServerAdminLinks);
    const wsLinkMap = new Map<number, number[]>();
    for (const l of wsLinks) {
      const arr = wsLinkMap.get(l.platformAccountId) || [];
      arr.push(l.loginServerAdminId);
      wsLinkMap.set(l.platformAccountId, arr);
    }

    // Get worldserver admin names
    const wsAdmins = await db
      .select({
        id: loginServerAdmins.id,
        accountName: loginServerAdmins.accountName,
      })
      .from(loginServerAdmins);
    const wsAdminMap = new Map(wsAdmins.map((a) => [a.id, a.accountName]));

    // Get connected world servers
    const worldServers = await db
      .select({
        id: loginWorldServers.id,
        longName: loginWorldServers.longName,
        shortName: loginWorldServers.shortName,
        loginServerAdminId: loginWorldServers.loginServerAdminId,
      })
      .from(loginWorldServers);

    // Enrich accounts
    const enriched = accounts.map((acct) => ({
      ...acct,
      role: adminMap.get(acct.id) || null,
      linkedLoginAccounts: loginLinkMap.get(acct.id)?.length || 0,
      worldServerAdmins: (wsLinkMap.get(acct.id) || []).map((adminId) => ({
        adminId,
        accountName: wsAdminMap.get(adminId) || "unknown",
        servers: worldServers
          .filter((ws) => ws.loginServerAdminId === adminId)
          .map((ws) => ({ id: ws.id, longName: ws.longName, shortName: ws.shortName })),
      })),
    }));

    return NextResponse.json({
      accounts: enriched,
      stats: {
        totalAccounts: accounts.length,
        verifiedAccounts: accounts.filter((a) => a.emailVerified).length,
        totalAdmins: admins.length,
        totalWorldServers: worldServers.length,
        totalWorldServerAdmins: wsAdmins.length,
      },
    });
  } catch (error) {
    console.error("Admin accounts list error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
