import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function proxyToAgent(path: string): Promise<any> {
  const token = process.env.UPGRADE_AGENT_TOKEN || "";
  try {
    const res = await fetch(`http://upgrade-agent:9090${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return await res.json();
    return { error: `Agent returned ${res.status}` };
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { error: "Upgrade agent request timed out (20s)" };
    }
    return { error: "Upgrade agent not reachable" };
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn || !session.isAdmin || session.adminRole !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();
  const service = searchParams.get("service") || "loginserver";
  const tail = searchParams.get("tail") || "200";
  const since = searchParams.get("since") || "";

  params.set("service", service);
  params.set("tail", tail);
  if (since) params.set("since", since);

  const qs = params.toString() ? `?${params.toString()}` : "";
  const result = await proxyToAgent(`/container-logs${qs}`);
  if (result.error) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
