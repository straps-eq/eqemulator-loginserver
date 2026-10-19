/**
 * Session identity check. Sessions are stateless cookies that carry accountId
 * and accountName. Federation sync can move a local platform account to a new
 * id when the master owns its old one, after which an old cookie's accountId
 * would name a different person. The cookie stays valid only while
 * platform_accounts(id).username still equals the name it was issued for.
 */

/** Returns the username for an id, null if there is no such row; may throw. */
export type UsernameLookup = (accountId: number) => Promise<string | null>;

export function createIdentityChecker(lookup: UsernameLookup, ttlMs = 30_000, now: () => number = Date.now, maxEntries = 5000) {
  const cache = new Map<number, { username: string | null; expires: number }>();

  /** false only when the row exists and its username differs from `accountName`. */
  return async function identityMatches(accountId: number, accountName: string): Promise<boolean> {
    const t = now();
    let entry = cache.get(accountId);
    if (!entry || entry.expires <= t) {
      let username: string | null;
      try {
        username = await lookup(accountId);
      } catch {
        return true; // DB trouble: keep today's behaviour rather than log everyone out
      }
      if (cache.size >= maxEntries) cache.clear();
      entry = { username, expires: t + ttlMs };
      cache.set(accountId, entry);
    }
    if (entry.username === null) return true; // row missing: unchanged behaviour
    return entry.username === accountName;
  };
}
