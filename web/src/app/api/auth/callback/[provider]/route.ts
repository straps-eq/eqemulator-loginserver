import { NextRequest, NextResponse } from "next/server";
import type { OAuth2Tokens } from "arctic";
import {
  google,
  discord,
  isValidProvider,
  consumeOAuthState,
  fetchGoogleProfile,
  fetchDiscordProfile,
  OAuthProfile,
} from "@/lib/oauth";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { platformAccounts, platformOauthLinks, platformAdmins, worldServerAdminLinks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { generateMfaCode, sendMfaCode } from "@/lib/email";
import { cacheSet } from "@/lib/redis";

const MFA_CODE_TTL_MS = 5 * 60 * 1000;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://eqemulator.dev";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
  const { provider } = await params;

  if (!isValidProvider(provider)) {
    return NextResponse.redirect(`${BASE_URL}/login?error=invalid_provider`);
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`oauth-callback:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.redirect(`${BASE_URL}/login?error=rate_limited`);
  }

  // Validate state
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (!code || !returnedState) {
    return NextResponse.redirect(`${BASE_URL}/login?error=missing_params`);
  }

  const { state: storedState, codeVerifier } = await consumeOAuthState();
  if (!storedState || storedState !== returnedState) {
    return NextResponse.redirect(`${BASE_URL}/login?error=invalid_state`);
  }

  // Exchange code for tokens
  let tokens: OAuth2Tokens;
  let profile: OAuthProfile;

  try {
    if (provider === "google") {
      if (!codeVerifier) {
        return NextResponse.redirect(`${BASE_URL}/login?error=missing_verifier`);
      }
      tokens = await google.validateAuthorizationCode(code, codeVerifier);
      profile = await fetchGoogleProfile(tokens.accessToken());
    } else if (provider === "discord") {
      tokens = await discord.validateAuthorizationCode(code, null);
      profile = await fetchDiscordProfile(tokens.accessToken());
    } else {
      return NextResponse.redirect(`${BASE_URL}/login?error=invalid_provider`);
    }
  } catch (err) {
    console.error(`[oauth] ${provider} token exchange failed:`, err);
    return NextResponse.redirect(`${BASE_URL}/login?error=auth_failed`);
  }

  // Check if this OAuth identity is already linked
  const existingLink = await db
    .select()
    .from(platformOauthLinks)
    .where(
      and(
        eq(platformOauthLinks.provider, provider),
        eq(platformOauthLinks.providerUserId, profile.id)
      )
    )
    .limit(1);

  let accountId: number;
  let accountName: string;

  // If user is already logged in, this is a "Link" action from the account page
  const session = await getSession();
  const isLinkingToExisting = session.isLoggedIn && session.accountId && existingLink.length === 0;

  if (isLinkingToExisting) {
    // Link this provider to the currently logged-in account
    accountId = session.accountId!;
    accountName = session.accountName || "";

    await db.insert(platformOauthLinks).values({
      platformAccountId: accountId,
      provider,
      providerUserId: profile.id,
      providerEmail: profile.email,
      createdAt: new Date(),
    });

    console.log(`[oauth] Linked ${provider} to existing session account ${accountName} (${profile.email})`);

    return NextResponse.redirect(`${BASE_URL}/account`);
  }

  if (existingLink.length > 0) {
    // Returning user — look up their platform account
    const accounts = await db
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.id, existingLink[0].platformAccountId))
      .limit(1);

    if (accounts.length === 0) {
      return NextResponse.redirect(`${BASE_URL}/login?error=account_not_found`);
    }

    accountId = accounts[0].id;
    accountName = accounts[0].username;
  } else {
    // New OAuth link — check if email matches existing account (migration path)
    const emailMatch = await db
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.email, profile.email))
      .limit(1);

    if (emailMatch.length > 0) {
      // Auto-link to existing account
      accountId = emailMatch[0].id;
      accountName = emailMatch[0].username;

      await db.insert(platformOauthLinks).values({
        platformAccountId: accountId,
        provider,
        providerUserId: profile.id,
        providerEmail: profile.email,
        createdAt: new Date(),
      });

      console.log(`[oauth] Auto-linked ${provider} to existing account ${accountName} (email match: ${profile.email})`);
    } else {
      // Brand new user — create platform account + oauth link
      const username = generateUsername(profile.name);

      const result = await db.insert(platformAccounts).values({
        username,
        email: profile.email,
        passwordHash: null,
        emailVerified: 1, // provider verified the email
        createdAt: new Date(),
      });

      accountId = Number(result[0].insertId);
      accountName = username;

      await db.insert(platformOauthLinks).values({
        platformAccountId: accountId,
        provider,
        providerUserId: profile.id,
        providerEmail: profile.email,
        createdAt: new Date(),
      });

      console.log(`[oauth] Created new account ${username} via ${provider} (${profile.email})`);
    }
  }

  // Check if user is admin or server owner — require MFA
  const adminRows = await db
    .select({ role: platformAdmins.role })
    .from(platformAdmins)
    .where(eq(platformAdmins.loginAccountId, accountId));

  const adminRole = adminRows.length > 0 ? adminRows[0].role : null;
  const isAdmin = adminRole === "admin" || adminRole === "moderator";

  const wsLinks = await db
    .select({ id: worldServerAdminLinks.id })
    .from(worldServerAdminLinks)
    .where(eq(worldServerAdminLinks.platformAccountId, accountId))
    .limit(1);

  const isServerOwner = wsLinks.length > 0;

  if (isAdmin || isServerOwner) {
    // Require email MFA before completing login
    const account = await db
      .select({ email: platformAccounts.email })
      .from(platformAccounts)
      .where(eq(platformAccounts.id, accountId))
      .limit(1);

    const email = account[0]?.email || profile.email;
    const mfaCode = generateMfaCode();

    await cacheSet(`mfa:${accountId}:code`, mfaCode, Math.floor(MFA_CODE_TTL_MS / 1000));
    await cacheSet(`mfa:${accountId}:attempts`, "0", Math.floor(MFA_CODE_TTL_MS / 1000));

    const sent = await sendMfaCode(email, mfaCode);
    if (!sent) {
      console.error(`[oauth] Failed to send MFA code to ${email}`);
    }

    session.isLoggedIn = false;
    session.mfaPending = true;
    session.mfaAccountId = accountId;
    session.mfaAccountName = accountName;
    session.mfaIsAdmin = isAdmin;
    session.mfaAdminRole = adminRole as "admin" | "moderator" | undefined;
    await session.save();

    return NextResponse.redirect(`${BASE_URL}/login?mfa=true`);
  }

  // Regular user — direct login
  session.accountId = accountId;
  session.accountName = accountName;
  session.isLoggedIn = true;
  session.isAdmin = false;
  await session.save();

  return NextResponse.redirect(`${BASE_URL}/account`);
  } catch (err) {
    console.error("[oauth-callback] unhandled error:", err);
    return NextResponse.redirect(`${BASE_URL}/login?error=auth_failed`);
  }
}

/** Generate a username from the provider profile name. */
function generateUsername(name: string): string {
  // Clean: remove non-alphanumeric, truncate, ensure min length
  let clean = name.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 25);
  if (clean.length < 3) {
    clean = "user" + Math.random().toString(36).slice(2, 8);
  }
  // Add random suffix to avoid collisions
  return clean + "_" + Math.random().toString(36).slice(2, 6);
}
