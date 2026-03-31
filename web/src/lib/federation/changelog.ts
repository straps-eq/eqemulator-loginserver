/**
 * Federation changelog — tracks changes to synced tables for delta-based replication.
 */
import { db } from "@/lib/db";
import { federationChangelog, federationNodes, federationAuditLog } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getSelfNode } from "./node";

type Operation = "insert" | "update" | "delete";

// Fields that must never appear in changelog payloads
const SENSITIVE_FIELDS = new Set([
  "account_password",
  "private_key",
  "bootstrap_token",
  "session_secret",
  "verification_token",
  "password_hash",
]);

/** Remove sensitive fields from a payload before storing in changelog. */
function stripSensitive(payload: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SENSITIVE_FIELDS.has(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Append a changelog entry for a synced table mutation.
 * Call this after any insert/update/delete on a synced table.
 * No-ops if federation is not initialized.
 * Sensitive fields (passwords, tokens) are automatically stripped from the payload.
 */
export async function appendChangelog(
  tableName: string,
  rowId: number,
  operation: Operation,
  payload: Record<string, unknown>,
  originNodeId?: number
) {
  const self = await getSelfNode();
  if (!self) return; // federation not initialized

  const safePayload = stripSensitive(payload);

  await db.insert(federationChangelog).values({
    tableName,
    rowId,
    operation,
    originNodeId: originNodeId ?? self.id,
    payload: safePayload,
    createdAt: new Date(),
  });
}

/** Get changelog entries with id > sinceSeq, up to limit. */
export async function getChangesSince(sinceSeq: number, limit = 500) {
  return db
    .select()
    .from(federationChangelog)
    .where(sql`${federationChangelog.id} > ${sinceSeq}`)
    .orderBy(federationChangelog.id)
    .limit(limit);
}

/** Get the latest changelog sequence number. */
export async function getLatestSeq(): Promise<number> {
  const rows = await db
    .select({ maxId: sql<number>`COALESCE(MAX(${federationChangelog.id}), 0)` })
    .from(federationChangelog);
  return rows[0]?.maxId ?? 0;
}

/**
 * Prune old changelog entries that all peers have already synced past.
 * Safety: only deletes entries with id <= the minimum lastSyncSeq across all active peers.
 * Also respects a minimum retention period (default 7 days).
 * Returns the number of deleted rows.
 */
export async function pruneChangelog(retentionDays = 7): Promise<number> {
  const self = await getSelfNode();
  if (!self) return 0;

  // Find the minimum sync cursor across all active, approved peers
  const peers = await db
    .select({ minSeq: sql<number>`COALESCE(MIN(${federationNodes.lastSyncSeq}), 0)` })
    .from(federationNodes)
    .where(
      and(
        eq(federationNodes.isSelf, 0),
        eq(federationNodes.isApproved, 1),
        eq(federationNodes.status, "active")
      )
    );

  const safePruneSeq = peers[0]?.minSeq ?? 0;
  if (safePruneSeq <= 0) return 0; // no peers or no progress — don't prune

  // Also enforce time-based retention
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(federationChangelog)
    .where(
      sql`${federationChangelog.id} <= ${safePruneSeq}
        AND ${federationChangelog.createdAt} < ${cutoffDate}`
    );

  return (result as unknown as { rowsAffected: number })?.rowsAffected ?? 0;
}

/**
 * Prune old audit log entries beyond the retention period.
 * Unlike changelog pruning, audit logs don't need peer sync safety —
 * they're local-only and used for forensics.
 * Default retention: 90 days.
 */
export async function pruneAuditLog(retentionDays = 90): Promise<number> {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(federationAuditLog)
    .where(sql`${federationAuditLog.createdAt} < ${cutoffDate}`);

  return (result as unknown as { rowsAffected: number })?.rowsAffected ?? 0;
}
