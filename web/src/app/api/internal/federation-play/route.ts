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
      return NextResponse.json({ success: true, ...(result.data as object) });
    } else {
      console.error(`[federation-play] Master returned ${result.status}: ${result.error}`);
      return NextResponse.json(
        { error: result.error || "Master rejected request" },
        { status: result.status || 502 }
      );
    }
  } catch (error) {
    console.error("[federation-play] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
