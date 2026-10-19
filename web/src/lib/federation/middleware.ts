/**
 * Federation request authentication middleware.
 * Verifies Ed25519 signatures on incoming federation API requests.
 */
import { NextRequest } from "next/server";
import { verifySignature } from "./crypto";
import { getNodeByPublicKey, getSelfNode, updatePeerHeartbeat, auditLog } from "./node";
import { rateLimit } from "@/lib/rate-limit";
import { cacheSetNX } from "@/lib/redis";
import { compareVersions } from "@/lib/version";

/** Peers reporting this version or later must send recipient-bound signatures. */
const RECIPIENT_BINDING_MIN_VERSION = "1.7.0";
/** Throttle the "unbound signature" warning to once per node per interval. */
const UNBOUND_WARN_INTERVAL_MS = 15 * 60 * 1000;
const unboundWarnedAt = new Map<number, number>();

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes
const NONCE_TTL_SECONDS = 360; // 6 minutes — slightly longer than drift window

export interface AuthenticatedNode {
  id: number;
  name: string;
  publicKey: string;
  isMaster: number;
  isApproved: number;
  status: string;
  nodeTier: string;
  softwareVersion: string | null;
  /** True if the request carried a valid recipient-bound signature. */
  recipientBound: boolean;
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

  // Rate limit: 600 requests per minute per node (high to avoid play_request floods blocking sync/admin ops)
  const rl = await rateLimit(`federation:${node.id}`, 600, 60_000);
  if (!rl.ok) {
    return { node: null, error: "Rate limited", status: 429 };
  }

  // Recipient binding (security M1). A bound request names the recipient's
  // public key in X-Federation-Recipient and in the signed message; it must be us.
  const url = new URL(req.url);
  const path = url.pathname + url.search;
  const method = req.method;
  const recipient = req.headers.get("x-federation-recipient")?.trim().toLowerCase() || null;
  let legacyDowngrade = false;
  if (recipient) {
    const self = await getSelfNode();
    if (!self || recipient !== self.publicKey.toLowerCase()) {
      await auditLog(node.id, "recipient_mismatch", { method, path, timestamp });
      return { node: null, error: "Request was signed for a different recipient", status: 401 };
    }
  } else {
    // Transition: unbound signatures are accepted only from peers that report
    // a version older than 1.7.0 (or have not reported one yet).
    if (node.softwareVersion && compareVersions(node.softwareVersion, RECIPIENT_BINDING_MIN_VERSION) >= 0) {
      // A node that rolled back below 1.7.0 can only reach us with a legacy
      // GET heartbeat, which carries no version. Answer that one read-only
      // request, but never lower the recorded version on an unbound request:
      // unbound heartbeats can be replayed from another peer within the nonce
      // window, and clearing the version would switch binding off for this
      // node. An operator resets it from the admin dashboard instead.
      if (method === "GET" && url.pathname === "/api/federation/heartbeat") {
        legacyDowngrade = true;
      } else {
        await auditLog(node.id, "unbound_signature_rejected", { method, path, softwareVersion: node.softwareVersion });
        return { node: null, error: "Recipient-bound signature required", status: 401 };
      }
    }
    const last = unboundWarnedAt.get(node.id) || 0;
    if (Date.now() - last > UNBOUND_WARN_INTERVAL_MS) {
      unboundWarnedAt.set(node.id, Date.now());
      console.warn(
        `[federation] accepting unbound (legacy) signature from "${node.name}" (id ${node.id}, version ${node.softwareVersion || "unknown"}) — upgrade it to >= ${RECIPIENT_BINDING_MIN_VERSION}`
      );
    }
  }

  // Verify signature
  const valid = await verifySignature(
    publicKeyHex,
    signature,
    timestamp,
    method,
    path,
    body,
    recipient
  );

  if (!valid) {
    await auditLog(node.id, "signature_verification_failed", {
      method,
      path,
      timestamp,
    });
    return { node: null, error: "Invalid signature", status: 401 };
  }

  // Replay protection: atomically claim this signature (SET NX EX). If it was
  // already claimed, this is a replay (also closes the exists-then-set race).
  const nonceKey = `nonce:${signature}`;
  if (!(await cacheSetNX(nonceKey, "1", NONCE_TTL_SECONDS))) {
    await auditLog(node.id, "replay_detected", { timestamp });
    return { node: null, error: "Replay detected", status: 401 };
  }

  if (legacyDowngrade) {
    const last = unboundWarnedAt.get(-node.id) || 0;
    if (Date.now() - last > UNBOUND_WARN_INTERVAL_MS) {
      unboundWarnedAt.set(-node.id, Date.now());
      await auditLog(node.id, "unbound_heartbeat_from_bound_node", { recordedVersion: node.softwareVersion });
      console.warn(
        `[federation] "${node.name}" (id ${node.id}) sent a legacy heartbeat but is recorded as ${node.softwareVersion}; if it was rolled back, reset its recorded version from the admin dashboard`
      );
    }
  }

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
      nodeTier: node.nodeTier,
      softwareVersion: node.softwareVersion ?? null,
      recipientBound: !!recipient,
    },
    error: null,
    status: 200,
  };
}
