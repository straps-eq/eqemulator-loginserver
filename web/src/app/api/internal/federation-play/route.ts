import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { federationPost } from "@/lib/federation/client";

/**
 * Internal endpoint called by the local loginserver (C++) to forward a
 * federated play request to the master node that owns the world server.
 *
 * Flow: EQ Client → Mesh Loginserver → this endpoint → Master Web App → Master Loginserver → World Server
 *
 * Only accessible from internal Docker network (loginserver container).
 */

// Dedup cache: prevent the same user+server from flooding the peer node
// Key: "accountId:server_short_name", Value: { ts, status }
const recentRequests = new Map<string, { ts: number; status: number; body: object }>();
const DEDUP_WINDOW_MS = 10_000; // 10 seconds

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now();
  recentRequests.forEach((val, key) => {
    if (now - val.ts > DEDUP_WINDOW_MS * 3) recentRequests.delete(key);
  });
}, 30_000);

export async function POST(request: NextRequest) {
  try {
    // Basic internal-only check (Docker network)
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
    const isInternal = ip.startsWith("172.") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip === "127.0.0.1" || ip === "::1" || ip === "";
    if (!isInternal) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { server_short_name, account_id, account_name, login_key, loginserver_name, client_ip } = body;

    if (!server_short_name || !account_id || !account_name || !login_key) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Dedup: if we just forwarded this exact request, return cached result
    const dedupKey = `${account_id}:${server_short_name}`;
    const cached = recentRequests.get(dedupKey);
    if (cached && (Date.now() - cached.ts) < DEDUP_WINDOW_MS) {
      return NextResponse.json(cached.body, { status: cached.status });
    }

    // Find which federation node owns this server
    const [rows] = await pool.execute(
      `SELECT lws.federation_source_node_id, fn.endpoint_url, fn.tls_cert_hash
       FROM login_world_servers lws
       JOIN federation_nodes fn ON fn.id = lws.federation_source_node_id
       WHERE lws.short_name = ? AND lws.federation_source_node_id > 0
       LIMIT 1`,
      [server_short_name]
    ) as unknown as [Array<{ federation_source_node_id: number; endpoint_url: string; tls_cert_hash: string | null }>];

    if (rows.length === 0) {
      return NextResponse.json({ error: "Server not found as federated" }, { status: 404 });
    }

    const { endpoint_url: masterUrl, tls_cert_hash: tlsHash } = rows[0];
    console.log(`[federation-play] Forwarding auth for ${account_name} -> ${server_short_name} via ${masterUrl}`);

    // Forward to master's play_request endpoint using signed federation request
    const result = await federationPost(
      masterUrl,
      "/api/federation/play_request",
      {
        server_short_name,
        account_id,
        account_name,
        login_key,
        loginserver_name: loginserver_name || "eqemu",
        client_ip: client_ip || "0.0.0.0",
      },
      tlsHash
    );

    if (result.ok) {
      console.log(`[federation-play] Auth forwarded successfully for ${account_name}`);
      const respBody = { success: true, ...(result.data as object) };
      recentRequests.set(dedupKey, { ts: Date.now(), status: 200, body: respBody });
      return NextResponse.json(respBody);
    } else {
      console.error(`[federation-play] Master returned ${result.status}: ${result.error}`);
      const respBody = { error: result.error || "Master rejected request" };
      const status = result.status || 502;
      recentRequests.set(dedupKey, { ts: Date.now(), status, body: respBody });
      return NextResponse.json(respBody, { status });
    }
  } catch (error) {
    console.error("[federation-play] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
