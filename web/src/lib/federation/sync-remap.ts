/**
 * Pure helpers for applyFullDataSync (no DB access, so they can be unit tested).
 *
 * A peer stores the source node's login_server_admins under its own local ids
 * (matched by account_name + federation_source_node_id), so every column that
 * holds a source admin id has to be translated before it is written locally.
 */

/** Source admin id -> local admin id, from the admin rows applied in the same sync. */
export function buildAdminIdMap(pairs: Array<{ sourceId: unknown; localId: number }>): Map<number, number> {
  const map = new Map<number, number>();
  for (const p of pairs) {
    const src = Number(p.sourceId);
    if (Number.isInteger(src) && src > 0 && p.localId > 0) map.set(src, p.localId);
  }
  return map;
}

/**
 * Translate a source admin id. 0/empty means "no admin" and stays 0; an id we
 * cannot map returns null so the caller leaves the column alone instead of
 * writing an id that points at someone else's admin row.
 */
export function remapAdminId(map: Map<number, number>, sourceId: unknown): number | null {
  const src = Number(sourceId || 0);
  if (!Number.isFinite(src) || src <= 0) return 0;
  return map.get(src) ?? null;
}

/**
 * The source may hold several rows with the same short_name (it has duplicates
 * of its own). Peers keep one row per (short_name, source), so pick a stable
 * winner, the lowest source id, instead of letting the last row overwrite the
 * others every cycle. Rows without a short_name pass through untouched.
 */
export function pickServerWinners<T extends Record<string, unknown>>(servers: T[]): { winners: T[]; skipped: T[] } {
  const best = new Map<string, T>();
  for (const s of servers) {
    const name = s.short_name;
    if (typeof name !== "string" || name === "") continue;
    const cur = best.get(name);
    if (!cur || idOf(s) < idOf(cur)) best.set(name, s);
  }
  const winners: T[] = [];
  const skipped: T[] = [];
  for (const s of servers) {
    const name = s.short_name;
    if (typeof name !== "string" || name === "" || best.get(name) === s) winners.push(s);
    else skipped.push(s);
  }
  return { winners, skipped };
}

function idOf(row: Record<string, unknown>): number {
  const id = Number(row.id);
  return Number.isFinite(id) && id > 0 ? id : Number.MAX_SAFE_INTEGER;
}

/** True when a local row holding a source row's id belongs to a different owner. */
export function isForeignOwner(localOwner: unknown, sourceOwner: unknown): boolean {
  return Number(localOwner) !== Number(sourceOwner);
}
