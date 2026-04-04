import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { platformOauthLinks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { isValidProvider } from "@/lib/oauth";

// Unlink a provider
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const session = await getSession();
  if (!session.isLoggedIn || !session.accountId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { provider } = await params;
  if (!isValidProvider(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  // Check how many providers are linked — must keep at least 1
  const allLinks = await db
    .select({ id: platformOauthLinks.id })
    .from(platformOauthLinks)
    .where(eq(platformOauthLinks.platformAccountId, session.accountId));

  if (allLinks.length <= 1) {
    return NextResponse.json(
      { error: "Cannot unlink your only sign-in method" },
      { status: 400 }
    );
  }

  await db
    .delete(platformOauthLinks)
    .where(
      and(
        eq(platformOauthLinks.platformAccountId, session.accountId),
        eq(platformOauthLinks.provider, provider)
      )
    );

  return NextResponse.json({ success: true });
}
