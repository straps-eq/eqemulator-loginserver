import { NextRequest, NextResponse } from "next/server";
import { isDirectInternalRequest } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

/**
 * GET /api/updater/desired — read-only, for this host's updater (deploy.sh).
 *
 * Reachable without auth only from inside the Docker network: anything that
 * came through nginx carries X-Real-IP and gets a 404, so the endpoint is
 * invisible from outside.
 *
 * Response:
 *   desired_version_stable / desired_version_canary  semver or null
 *   source       "self" (master, or a peer's local override) | "master"
 *   updated_at   ISO timestamp of the newest value, or null
 *   check_requested_at  last notify_check from the master (advisory), or null
 */
export async function GET(req: NextRequest) {
  if (!isDirectInternalRequest(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const { getEffectiveDesiredVersions } = await import("@/lib/federation/status");
    const { getConfigString } = await import("@/lib/federation/node");
    const desired = await getEffectiveDesiredVersions();
    const checkRequestedAt = await getConfigString("update_check_requested_at");
    return NextResponse.json({ ...desired, check_requested_at: checkRequestedAt });
  } catch (err) {
    console.error("[updater] desired version lookup failed:", err);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
