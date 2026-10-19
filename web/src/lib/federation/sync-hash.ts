/**
 * Content hashing for the full-table `sync_data` export.
 *
 * The export includes columns that change on every login (last_login_date,
 * updated_at, last_ip_address). Hashing those made every login on the
 * exporting node look like a federation-wide data change, so receivers
 * re-applied ~10k rows every cycle. The "stable" hash covers only identity and
 * credential columns; the "volatile" hash covers the rest so receivers can
 * refresh login timestamps on a slower cadence without counting them as changes.
 */
import crypto from "crypto";

/** Columns excluded from the stable hash, per exported collection. */
export const VOLATILE_COLUMNS: Record<string, readonly string[]> = {
  accounts: ["last_login_date", "updated_at", "last_ip_address"],
  servers: ["last_login_date", "last_ip_address", "updated_at"],
  admins: ["last_login_date", "updated_at", "last_ip_address"],
  profiles: ["updated_at"],
  platform_accounts: ["updated_at", "last_login_at", "last_login_date"],
  oauth_links: ["updated_at", "last_used_at"],
  login_links: [],
  ws_admin_links: [],
  platform_admins: ["updated_at"],
};

/** Collections covered by the hash, in a fixed order. */
const COLLECTIONS = Object.keys(VOLATILE_COLUMNS);

type Rows = Array<Record<string, unknown>> | undefined | null;
export type SyncCollections = Partial<Record<string, Rows>>;

function project(rows: Rows, cols: readonly string[], keep: boolean): unknown[] {
  if (!Array.isArray(rows)) return [];
  const set = new Set(cols);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(row).sort()) {
      if (set.has(k) === keep) {
        const v = row[k];
        // Normalise Date objects (sender side) and ISO strings (receiver side)
        // to the same representation.
        out[k] = v instanceof Date ? v.toISOString() : v;
      }
    }
    return out;
  });
}

function digest(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

/** Hash over identity/credential columns only. Unchanged by logins. */
export function computeStableHash(data: SyncCollections): string {
  const parts: Record<string, unknown[]> = {};
  for (const c of COLLECTIONS) parts[c] = project(data[c], VOLATILE_COLUMNS[c], false);
  return digest(parts);
}

/** Hash over volatile columns only (with row keys so reorders are detected). */
export function computeVolatileHash(data: SyncCollections): string {
  const parts: Record<string, unknown[]> = {};
  for (const c of COLLECTIONS) {
    const cols = VOLATILE_COLUMNS[c];
    if (cols.length === 0) continue;
    parts[c] = project(data[c], [...cols, "id", "short_name", "account_name"], true);
  }
  return digest(parts);
}

/**
 * Conditional sync_data. The puller sends the stable hash it last applied as
 * `if_stable` (plus `if_volatile` when a volatile refresh is due) and a random
 * `nonce` in the signed query string. If nothing it asked about changed, the
 * exporter answers with a small signed "unchanged" body carrying only live
 * servers instead of every row. Older exporters ignore the query and send the
 * full payload as before.
 */
export interface SyncCondition {
  stable: string;
  volatile: string | null;
  nonce: string;
}

const HASH_RE = /^[0-9a-f]{32}$/;

/** Parse the conditional query; null (send everything) if anything is off. */
export function parseSyncCondition(params: URLSearchParams): SyncCondition | null {
  const stable = params.get("if_stable");
  const volatile = params.get("if_volatile");
  const nonce = params.get("nonce");
  if (!stable || !HASH_RE.test(stable) || !nonce || !HASH_RE.test(nonce)) return null;
  if (volatile !== null && !HASH_RE.test(volatile)) return null;
  return { stable, volatile, nonce };
}

/** True only if every hash the puller sent matches the current export. */
export function isUnchanged(cond: SyncCondition | null, stableHash: string, volatileHash: string): boolean {
  if (!cond || cond.stable !== stableHash) return false;
  return cond.volatile === null || cond.volatile === volatileHash;
}

/**
 * Message the exporter signs for an "unchanged" answer. Bound to the puller's
 * nonce and public key so an old answer cannot be replayed to suppress a later
 * sync. `body` is the JSON of the answer without its `signature` field.
 */
export function unchangedSignatureMessage(nonce: string, requesterPublicKey: string, body: string): string {
  return `sync_data_unchanged\n${nonce}\n${requesterPublicKey.toLowerCase()}\n${body}`;
}
