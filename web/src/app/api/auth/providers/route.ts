import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { platformOauthLinks } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.accountId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const links = await db
    .select({
      provider: platformOauthLinks.provider,
      providerEmail: platformOauthLinks.providerEmail,
      createdAt: platformOauthLinks.createdAt,
    })
    .from(platformOauthLinks)
    .where(eq(platformOauthLinks.platformAccountId, session.accountId));

  return NextResponse.json({ providers: links });
}
