/**
 * Federation node management — handles self-identity, peer lookup, and initialization.
 */
import { db } from "@/lib/db";
import { federationNodes, federationConfig, federationAuditLog } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateKeyPair, generateBootstrapToken, hashToken, encryptPrivateKey, decryptPrivateKey } from "./crypto";

/** Validate an endpoint URL — must be valid URL, HTTPS required in production. */
function validateEndpointUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: "URL must use http or https protocol" };
    }
    if (
      process.env.NODE_ENV === "production" &&
      parsed.protocol !== "https:" &&
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1"
    ) {
      return { valid: false, error: "HTTPS is required for federation endpoints in production" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

export interface SelfNode {
  id: number;
  name: string;
  endpointUrl: string;
  publicKey: string;
  privateKey: string;
  isMaster: boolean;
  nodeTier: "official" | "mesh";
}

/** Cache the self node in memory with a TTL to avoid repeated DB queries. */
const SELF_NODE_CACHE_TTL_MS = 60_000; // 60 seconds
let selfNodeCache: SelfNode | null = null;
let selfNodeCacheExpiry = 0;

/** Get this node's identity, or null if federation is not initialized. */
export async function getSelfNode(): Promise<SelfNode | null> {
  if (selfNodeCache && Date.now() < selfNodeCacheExpiry) return selfNodeCache;

  const rows = await db
    .select()
    .from(federationNodes)
    .where(eq(federationNodes.isSelf, 1))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  if (!row.privateKey) return null;

  // Decrypt private key (handles both encrypted and legacy plaintext)
  const decryptedKey = await decryptPrivateKey(row.privateKey);

  selfNodeCache = {
    id: row.id,
    name: row.name,
    endpointUrl: row.endpointUrl,
    publicKey: row.publicKey,
    privateKey: decryptedKey,
    isMaster: row.isMaster === 1,
    nodeTier: (row.nodeTier as "official" | "mesh") || "mesh",
  };
  selfNodeCacheExpiry = Date.now() + SELF_NODE_CACHE_TTL_MS;
  return selfNodeCache;
}

/** Clear the cached self node (call after config changes). */
export function clearSelfNodeCache() {
  selfNodeCache = null;
  selfNodeCacheExpiry = 0;
}

/** Initialize this node as the master. Creates keypair and default config. */
export async function initializeAsMaster(
  name: string,
  endpointUrl: string
): Promise<SelfNode> {
  const urlCheck = validateEndpointUrl(endpointUrl);
  if (!urlCheck.valid) throw new Error(urlCheck.error!);

  const existing = await getSelfNode();
  if (existing) throw new Error("Node already initialized");

  const kp = await generateKeyPair();
  const encPrivKey = await encryptPrivateKey(kp.privateKey);

  const [result] = await db.insert(federationNodes).values({
    name,
    endpointUrl,
    publicKey: kp.publicKey,
    privateKey: encPrivKey,
    isSelf: 1,
    isMaster: 1,
    isApproved: 1,
    status: "active",
    nodeTier: "official",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const nodeId = result.insertId;

  // Seed default federation config
  const defaults: Record<string, unknown> = {
    sync_interval_seconds: 30,
    sync_tables: [
      "login_accounts",
      "login_world_servers",
      "login_server_admins",
      "server_profiles",
    ],
    delete_propagation: { enabled: false, grace_hours: 48 },
    rate_limits: { per_node_per_minute: 120, burst: 20 },
  };

  for (const [key, value] of Object.entries(defaults)) {
    await db.insert(federationConfig).values({
      configKey: key,
      configValue: value,
      version: 1,
      updatedAt: new Date(),
    });
  }

  await auditLog(nodeId, "node_initialized", { role: "master", name, endpointUrl });

  clearSelfNodeCache();
  return (await getSelfNode())!;
}

/** Initialize this node as a peer by registering with an existing master. */
export async function initializeAsPeer(
  name: string,
  endpointUrl: string,
  masterUrl: string,
  bootstrapToken: string
): Promise<SelfNode> {
  const selfUrlCheck = validateEndpointUrl(endpointUrl);
  if (!selfUrlCheck.valid) throw new Error(selfUrlCheck.error!);
  const masterUrlCheck = validateEndpointUrl(masterUrl);
  if (!masterUrlCheck.valid) throw new Error(`Master URL: ${masterUrlCheck.error}`);

  const existing = await getSelfNode();
  if (existing) throw new Error("Node already initialized");

  const kp = await generateKeyPair();
  const encPrivKey = await encryptPrivateKey(kp.privateKey);

  // Register with the master
  const regUrl = `${masterUrl.replace(/\/$/, "")}/api/federation/register`;
  const res = await fetch(regUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: bootstrapToken,
      public_key: kp.publicKey,
      name,
      endpoint_url: endpointUrl,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(`Master registration failed: ${err.error || res.statusText}`);
  }

  const data = await res.json();
  // data: { node_id, master: { public_key, endpoint_url, name }, config: [...], peers: [...] }

  // Store self — new peers default to 'mesh' tier (master can promote to 'official')
  await db.insert(federationNodes).values({
    name,
    endpointUrl,
    publicKey: kp.publicKey,
    privateKey: encPrivKey,
    isSelf: 1,
    isMaster: 0,
    isApproved: 1,
    status: "active",
    nodeTier: "mesh",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Store the master as a peer (master is always official tier)
  await db.insert(federationNodes).values({
    name: data.master.name,
    endpointUrl: data.master.endpoint_url,
    publicKey: data.master.public_key,
    isSelf: 0,
    isMaster: 1,
    isApproved: 1,
    status: "active",
    nodeTier: "official",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Store other peers
  for (const peer of data.peers || []) {
    await db.insert(federationNodes).values({
      name: peer.name,
      endpointUrl: peer.endpoint_url,
      publicKey: peer.public_key,
      isSelf: 0,
      isMaster: 0,
      isApproved: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Store config received from master
  for (const c of data.config || []) {
    await db.insert(federationConfig).values({
      configKey: c.key,
      configValue: c.value,
      version: c.version,
      updatedAt: new Date(),
    });
  }

  await auditLog(0, "node_initialized", {
    role: "peer",
    name,
    endpointUrl,
    masterUrl,
    assignedNodeId: data.node_id,
  });

  clearSelfNodeCache();
  return (await getSelfNode())!;
}

/** Get all approved, active peer nodes (excluding self). */
export async function getActivePeers() {
  return db
    .select()
    .from(federationNodes)
    .where(
      and(
        eq(federationNodes.isSelf, 0),
        eq(federationNodes.isApproved, 1),
        eq(federationNodes.status, "active")
      )
    );
}

/** Get a peer node by its public key. */
export async function getNodeByPublicKey(publicKey: string) {
  const rows = await db
    .select()
    .from(federationNodes)
    .where(eq(federationNodes.publicKey, publicKey))
    .limit(1);
  return rows[0] || null;
}

/** Create a bootstrap token for a new peer. */
export async function createPeerInvite(
  name: string,
  endpointUrl: string
): Promise<{ nodeId: number; token: string }> {
  const urlCheck = validateEndpointUrl(endpointUrl);
  if (!urlCheck.valid) throw new Error(urlCheck.error!);

  const token = await generateBootstrapToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Use a random placeholder for public_key (avoid leaking any token material)
  const placeholder = `pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const [result] = await db.insert(federationNodes).values({
    name,
    endpointUrl,
    publicKey: placeholder,
    isSelf: 0,
    isMaster: 0,
    isApproved: 0,
    status: "active",
    bootstrapToken: tokenHash, // store hash, not plaintext
    bootstrapExpiresAt: expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const self = await getSelfNode();
  await auditLog(self?.id || 0, "peer_invite_created", { name, endpointUrl, nodeId: result.insertId });

  // Return the raw token to the admin — it is never stored in plaintext
  return { nodeId: result.insertId, token };
}

/** Complete peer registration — called when peer sends its public key with a valid bootstrap token. */
export async function completePeerRegistration(
  token: string,
  publicKey: string
): Promise<{ success: boolean; error?: string; nodeId?: number }> {
  // Validate Ed25519 public key format: 64 hex characters (32 bytes)
  if (!/^[0-9a-f]{64}$/i.test(publicKey)) {
    return { success: false, error: "Invalid public key format" };
  }

  // Hash the token to match what's stored in DB
  const tokenHash = await hashToken(token);

  const rows = await db
    .select()
    .from(federationNodes)
    .where(eq(federationNodes.bootstrapToken, tokenHash))
    .limit(1);

  if (rows.length === 0) return { success: false, error: "Invalid token" };

  const node = rows[0];
  if (node.bootstrapExpiresAt && new Date(node.bootstrapExpiresAt) < new Date()) {
    return { success: false, error: "Token expired" };
  }
  if (node.isApproved) {
    return { success: false, error: "Already registered" };
  }

  await db
    .update(federationNodes)
    .set({
      publicKey,
      isApproved: 1,
      bootstrapToken: null,
      bootstrapExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(federationNodes.id, node.id));

  const self = await getSelfNode();
  await auditLog(self?.id || 0, "peer_registered", { nodeId: node.id, name: node.name });

  return { success: true, nodeId: node.id };
}

/** Update a peer's sync cursor. */
export async function updatePeerSyncSeq(nodeId: number, seq: number) {
  await db
    .update(federationNodes)
    .set({ lastSyncSeq: seq, lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(federationNodes.id, nodeId));
}

/** Update a peer's heartbeat timestamp. */
export async function updatePeerHeartbeat(nodeId: number) {
  await db
    .update(federationNodes)
    .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(federationNodes.id, nodeId));
}

/** Get all federation config entries. */
export async function getAllConfig() {
  return db.select().from(federationConfig);
}

/** Get config entries with version > sinceVersion. */
export async function getConfigSince(sinceVersion: number) {
  return db
    .select()
    .from(federationConfig)
    .where(sql`${federationConfig.version} > ${sinceVersion}`);
}

/** Update a config value (master only). Increments version. */
export async function setConfig(key: string, value: unknown) {
  const existing = await db
    .select()
    .from(federationConfig)
    .where(eq(federationConfig.configKey, key))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(federationConfig)
      .set({
        configValue: value,
        version: existing[0].version + 1,
        updatedAt: new Date(),
      })
      .where(eq(federationConfig.configKey, key));
  } else {
    await db.insert(federationConfig).values({
      configKey: key,
      configValue: value,
      version: 1,
      updatedAt: new Date(),
    });
  }
}

/** Write to the federation audit log. */
export async function auditLog(nodeId: number, action: string, detail?: unknown) {
  await db.insert(federationAuditLog).values({
    nodeId,
    action,
    detail: detail || null,
    createdAt: new Date(),
  });
}
