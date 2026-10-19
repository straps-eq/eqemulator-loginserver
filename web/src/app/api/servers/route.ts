import { NextResponse } from "next/server";
import { getPublicServerList } from "@/lib/public-servers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getPublicServerList());
  } catch (err) {
    console.error("[/api/servers] Error:", err);
    return NextResponse.json({ error: "Internal server error", detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
