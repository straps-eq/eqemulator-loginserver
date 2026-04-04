import * as arctic from "arctic";
import { cookies } from "next/headers";
import crypto from "crypto";

const BASE = process.env.NEXT_PUBLIC_BASE_URL || "https://eqemulator.dev";

// ── Provider instances ──

export const google = new arctic.Google(
  process.env.GOOGLE_CLIENT_ID || "",
  process.env.GOOGLE_CLIENT_SECRET || "",
  `${BASE}/api/auth/callback/google`
);

export const discord = new arctic.Discord(
  process.env.DISCORD_CLIENT_ID || "",
  process.env.DISCORD_CLIENT_SECRET || "",
  `${BASE}/api/auth/callback/discord`
);

export type OAuthProvider = "google" | "discord";

const PROVIDERS = new Set<OAuthProvider>(["google", "discord"]);

export function isValidProvider(p: string): p is OAuthProvider {
  return PROVIDERS.has(p as OAuthProvider);
}

// ── State + PKCE helpers ──

const STATE_COOKIE = "oauth_state";
const VERIFIER_COOKIE = "oauth_code_verifier";
const COOKIE_MAX_AGE = 600; // 10 minutes

export async function storeOAuthState(state: string, codeVerifier?: string) {
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  if (codeVerifier) {
    cookieStore.set(VERIFIER_COOKIE, codeVerifier, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });
  }
}

export async function consumeOAuthState(): Promise<{
  state: string | null;
  codeVerifier: string | null;
}> {
  const cookieStore = await cookies();
  const state = cookieStore.get(STATE_COOKIE)?.value || null;
  const codeVerifier = cookieStore.get(VERIFIER_COOKIE)?.value || null;

  // Clear cookies
  cookieStore.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });
  cookieStore.set(VERIFIER_COOKIE, "", { maxAge: 0, path: "/" });

  return { state, codeVerifier };
}

export function generateState(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ── Profile fetching ──

export interface OAuthProfile {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

export async function fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google profile fetch failed: ${res.status}`);
  const data = await res.json();
  return {
    id: data.sub || data.id,
    email: data.email,
    name: data.name || data.email.split("@")[0],
    avatar: data.picture,
  };
}

export async function fetchDiscordProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord profile fetch failed: ${res.status}`);
  const data = await res.json();
  return {
    id: data.id,
    email: data.email,
    name: data.global_name || data.username,
    avatar: data.avatar
      ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`
      : undefined,
  };
}
