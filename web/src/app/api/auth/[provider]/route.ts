import { NextRequest, NextResponse } from "next/server";
import * as arctic from "arctic";
import {
  google,
  discord,
  isValidProvider,
  storeOAuthState,
} from "@/lib/oauth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  if (!isValidProvider(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  const state = arctic.generateState();
  const codeVerifier = arctic.generateCodeVerifier();

  if (provider === "google") {
    const url = google.createAuthorizationURL(state, codeVerifier, [
      "openid",
      "email",
      "profile",
    ]);
    await storeOAuthState(state, codeVerifier);
    return NextResponse.redirect(url.toString());
  }

  if (provider === "discord") {
    const url = discord.createAuthorizationURL(state, null, [
      "identify",
      "email",
    ]);
    await storeOAuthState(state);
    return NextResponse.redirect(url.toString());
  }

  return NextResponse.json({ error: "Provider not configured" }, { status: 400 });
}
