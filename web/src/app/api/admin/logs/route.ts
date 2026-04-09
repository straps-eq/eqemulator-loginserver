import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function proxyToAgent(path: string): Promise<any> {
  const token = process.env.UPGRADE_AGENT_TOKEN || "";
  try {
    const res = await fetch(`http://upgrade-agent:9090${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return await res.json();
    return { error: `Agent returned ${res.status}` };
  } catch (err) {
    return { error: "Upgrade agent not reachable" };
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn || !session.isAdmin || session.adminRole !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Forward query params to agent
  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();
  searchParams.forEach((val, key) => {
    params.set(key, val);
  });
  const qs = params.toString() ? `?${params.toString()}` : "";

  const result = await proxyToAgent(`/logs${qs}`);
  if (result.error) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
