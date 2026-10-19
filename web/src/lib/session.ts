import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";
import { createIdentityChecker } from "@/lib/session-identity";

export interface SessionData {
  accountId?: number;
  accountName?: string;
  isLoggedIn: boolean;
  isAdmin?: boolean;
  adminRole?: "admin" | "moderator";
  // MFA pending state — set after password validation, before code verification
  mfaPending?: boolean;
  mfaAccountId?: number;
  mfaAccountName?: string;
  mfaIsAdmin?: boolean;
  mfaAdminRole?: "admin" | "moderator";
}

const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "eqemu_session",
  cookieOptions: {
    secure: true,
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

// A cookie's accountId can come to name a different account after federation
// sync relocates a local platform account (see session-identity.ts).
const identityMatches = createIdentityChecker(async (accountId) => {
  const { pool } = await import("@/lib/db");
  const [rows] = await pool.execute(
    `SELECT username FROM platform_accounts WHERE id = ? LIMIT 1`, [accountId]
  ) as unknown as [Array<{ username: string }>];
  return rows.length > 0 ? rows[0].username : null;
});

const warnedSessions = new Set<string>();

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  // On a mismatch treat the session as logged out, in memory only: server
  // components cannot set cookies, so no save()/destroy() here.
  if (session.isLoggedIn && session.accountId && session.accountName &&
      !(await identityMatches(session.accountId, session.accountName))) {
    const key = `${session.accountId}:${session.accountName}`;
    if (!warnedSessions.has(key)) {
      if (warnedSessions.size > 1000) warnedSessions.clear();
      warnedSessions.add(key);
      console.warn(`[session] account id ${session.accountId} no longer belongs to "${session.accountName}"; treating session as logged out`);
    }
    session.isLoggedIn = false;
    session.accountId = undefined;
    session.accountName = undefined;
    session.isAdmin = undefined;
    session.adminRole = undefined;
  }
  if (session.mfaPending && session.mfaAccountId && session.mfaAccountName &&
      !(await identityMatches(session.mfaAccountId, session.mfaAccountName))) {
    session.mfaPending = undefined;
    session.mfaAccountId = undefined;
    session.mfaAccountName = undefined;
    session.mfaIsAdmin = undefined;
    session.mfaAdminRole = undefined;
  }
  return session;
}

export function defaultSession(): SessionData {
  return {
    isLoggedIn: false,
  };
}
