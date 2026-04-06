/**
 * Federation HTTP client — makes signed requests to peer nodes.
 * Supports optional TLS certificate pinning per peer.
 */
import https from "https";
import crypto from "crypto";
import { signRequest } from "./crypto";
import { getSelfNode, getActivePeers, auditLog } from "./node";

/**
 * Create a custom HTTPS agent that pins the server certificate to a known SHA-256 hash.
 * If pinnedHash is null/undefined, returns undefined (no pinning).
 */
function createPinnedAgent(pinnedHash: string | null | undefined): https.Agent | undefined {
  if (!pinnedHash) return undefined;
  return new https.Agent({
    checkServerIdentity: (_host, cert) => {
      const fingerprint = crypto
        .createHash("sha256")
        .update(cert.raw)
        .digest("hex");
      if (fingerprint !== pinnedHash.toLowerCase()) {
        return new Error(
          `TLS certificate mismatch: expected ${pinnedHash}, got ${fingerprint}`
        );
      }
      return undefined;
    },
  });
}

interface FederationResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/** Make a signed GET request to a peer node. */
export async function federationGet<T = unknown>(
  endpointUrl: string,
  path: string,
  tlsCertHash?: string | null
): Promise<FederationResponse<T>> {
  return federationFetch<T>(endpointUrl, path, "GET", undefined, tlsCertHash);
}

/** Make a signed POST request to a peer node. */
export async function federationPost<T = unknown>(
  endpointUrl: string,
  path: string,
  body: unknown,
  tlsCertHash?: string | null
): Promise<FederationResponse<T>> {
  return federationFetch<T>(endpointUrl, path, "POST", body, tlsCertHash);
}

async function federationFetch<T>(
  endpointUrl: string,
  path: string,
  method: string,
  body?: unknown,
  tlsCertHash?: string | null
): Promise<FederationResponse<T>> {
  const self = await getSelfNode();
  if (!self) {
    return { ok: false, status: 0, data: null, error: "Federation not initialized" };
  }

  const timestamp = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : "";

  const signature = await signRequest(
    self.privateKey,
    timestamp,
    method,
    path,
    bodyStr
  );

  const url = `${endpointUrl.replace(/\/$/, "")}${path}`;

  const agent = createPinnedAgent(tlsCertHash);

  try {
    const fetchOptions: RequestInit & { agent?: https.Agent } = {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Federation-PublicKey": self.publicKey,
        "X-Federation-Timestamp": timestamp,
        "X-Federation-Signature": signature,
      },
      body: method !== "GET" ? bodyStr : undefined,
      signal: AbortSignal.timeout(15_000),
    };
    // Node.js fetch supports custom agents via undici dispatcher,
    // but for cert pinning we pass the agent for Node's https module
    if (agent) (fetchOptions as Record<string, unknown>).agent = agent;

    const res = await fetch(url, fetchOptions);

    let data: T | null = null;
    try {
      data = await res.json();
    } catch {
      // non-JSON response
    }

    return { ok: res.ok, status: res.status, data, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : "Fetch failed",
    };
  }
}

/**
 * Broadcast a sync notification to all active peers, telling them to
 * pull fresh data immediately (instead of waiting for their next 60s cycle).
 * Called when local data changes — e.g. a new world server connects.
 */
export async function broadcastSyncNotification(
  reason: string = "data_changed"
): Promise<{ notified: number; errors: string[] }> {
  const self = await getSelfNode();
  if (!self) return { notified: 0, errors: ["Not initialized"] };

  const peers = await getActivePeers();
  let notified = 0;
  const errors: string[] = [];

  for (const peer of peers) {
    try {
      const res = await federationPost(
        peer.endpointUrl,
        "/api/federation/notify_sync",
        { reason },
        peer.tlsCertHash
      );
      if (res.ok) {
        notified++;
      } else {
        errors.push(`${peer.name}: ${res.error}`);
      }
    } catch (err) {
      errors.push(`${peer.name}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  if (notified > 0) {
    console.log(`[federation] broadcast sync notification (${reason}) to ${notified} peer(s)`);
  }
  return { notified, errors };
}

// Only scrypt ($7$) and argon2id ($argon2id$) hashes are allowed across the federation.
const STRONG_HASH_PREFIXES = ["$7$", "$argon2id$"];

/**
 * Broadcast a password hash change to all active peers.
 * Called after a local password update on a synced table.
 * Uses the dedicated password_sync endpoint (Ed25519 authenticated).
 * Refuses to broadcast weak hashes (md5, sha) — only scrypt/argon2 allowed.
 */
export async function broadcastPasswordChange(
  table: string,
  rowId: number,
  passwordHash: string
): Promise<{ sent: number; errors: string[] }> {
  const self = await getSelfNode();
  if (!self) return { sent: 0, errors: ["Not initialized"] };

  // Refuse to broadcast weak hashes
  if (!STRONG_HASH_PREFIXES.some((p) => passwordHash.startsWith(p))) {
    await auditLog(self.id, "password_sync_blocked_weak_hash", { table, rowId });
    return { sent: 0, errors: ["Hash algorithm too weak for federation sync (need scrypt or argon2)"] };
  }

  const peers = await getActivePeers();
  let sent = 0;
  const errors: string[] = [];

  for (const peer of peers) {
    try {
      const res = await federationPost<{ applied: number }>(
        peer.endpointUrl,
        "/api/federation/password_sync",
        { updates: [{ table, row_id: rowId, password_hash: passwordHash }] }
      );
      if (res.ok) {
        sent++;
      } else {
        errors.push(`${peer.name}: ${res.error}`);
      }
    } catch (err) {
      errors.push(`${peer.name}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  await auditLog(self.id, "password_sync_broadcast", { table, rowId, peersSent: sent, errors });
  return { sent, errors };
}
