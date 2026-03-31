import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";

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
    sameSite: "strict" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  return session;
}

export function defaultSession(): SessionData {
  return {
    isLoggedIn: false,
  };
}
