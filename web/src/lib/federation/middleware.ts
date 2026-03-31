/**
 * Federation request authentication middleware.
 * Verifies Ed25519 signatures on incoming federation API requests.
 */
import { NextRequest } from "next/server";
import { verifySignature } from "./crypto";
import { getNodeByPublicKey, updatePeerHeartbeat, auditLog } from "./node";
import { rateLimit } from "@/lib/rate-limit";
import { cacheExists, cacheSet } from "@/lib/redis";

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes
const NONCE_TTL_SECONDS = 360; // 6 minutes — slightly longer than drift window

export interface AuthenticatedNode {
  id: number;
  name: string;
  publicKey: string;
  isMaster: number;
  isApproved: number;
  status: string;
}

/**
 * Authenticate a federation request.
 * Checks:
 * 1. Required headers present (X-Federation-PublicKey, X-Federation-Timestamp, X-Federation-Signature)
 * 2. Timestamp within 5-minute window (replay protection)
 * 3. Node is known, approved, and active
 * 4. Rate limit per node
 * 5. Signature is valid
 *
 * Returns the authenticated node, or null with an error message.
 */
export async function authenticateFederationRequest(
  req: NextRequest,
  body: string
): Promise<{ node: AuthenticatedNode | null; error: string | null; status: number }> {
  const publicKeyHex = req.headers.get("x-federation-publickey");
  const timestamp = req.headers.get("x-federation-timestamp");
  const signature = req.headers.get("x-federation-signature");

  if (!publicKeyHex || !timestamp || !signature) {
    return { node: null, error: "Missing federation auth headers", status: 401 };
  }

  // Replay protection
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
    return { node: null, error: "Timestamp out of range", status: 401 };
  }

  // Look up node
  const node = await getNodeByPublicKey(publicKeyHex);
  if (!node) {
    return { node: null, error: "Unknown node", status: 403 };
  }
  if (!node.isApproved) {
    return { node: null, error: "Node not approved", status: 403 };
  }
  if (node.status !== "active") {
    return { node: null, error: `Node is ${node.status}`, status: 403 };
  }

  // Rate limit: 120 requests per minute per node
  const rl = await rateLimit(`federation:${node.id}`, 120, 60_000);
  if (!rl.ok) {
    return { node: null, error: "Rate limited", status: 429 };
  }

  // Replay protection: reject if this exact signature was already used (Redis-backed)
  const nonceKey = `nonce:${signature}`;
  if (await cacheExists(nonceKey)) {
    await auditLog(node.id, "replay_detected", { timestamp });
    return { node: null, error: "Replay detected", status: 401 };
  }

  // Verify signature
  const path = new URL(req.url).pathname;
  const method = req.method;
  const valid = await verifySignature(
    publicKeyHex,
    signature,
    timestamp,
    method,
    path,
    body
  );

  if (!valid) {
    await auditLog(node.id, "signature_verification_failed", {
      method,
      path,
      timestamp,
    });
    return { node: null, error: "Invalid signature", status: 401 };
  }

  // Cache signature to prevent replay within the window (Redis-backed)
  await cacheSet(nonceKey, "1", NONCE_TTL_SECONDS);

  // Update heartbeat
  await updatePeerHeartbeat(node.id);

  return {
    node: {
      id: node.id,
      name: node.name,
      publicKey: node.publicKey,
      isMaster: node.isMaster,
      isApproved: node.isApproved,
      status: node.status,
    },
    error: null,
    status: 200,
  };
}
