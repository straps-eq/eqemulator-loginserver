/**
 * Client filter and order for the server directory (/servers?client=).
 * Pure functions, safe to import from client components and unit tests.
 *
 * The directory is A-Z within three groups, not ranked by population: worlds
 * with players on, then idle or offline worlds, then test/dev worlds. A small
 * world gets the same footing as a busy one; activity shows inline.
 */
import { CLIENT_ORDER, type ClientId } from "./client-probe/labels";

/** Chips always shown; other clients get a chip only when some world supports them. */
export const PRIMARY_CLIENTS: ClientId[] = ["titanium", "rof2", "tob", "eql"];

/** The fields filtering needs, so this module doesn't pull in the DB layer. */
export interface FilterableServer {
  server_long_name: string;
  /** Activity band; "idle" (or missing) sorts into the quiet group. */
  activity?: string;
  server_status?: number;
  is_offline?: boolean;
  client_support?: { supported: string[]; unreachable: boolean } | null;
}

/** ?client= value -> client id, or null for "All" (also for unknown values). */
export function parseClientFilter(value: unknown): ClientId | null {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  return CLIENT_ORDER.find((c) => c === v) ?? null;
}

export function supportsClient(server: FilterableServer, client: ClientId): boolean {
  return !!server.client_support && server.client_support.supported.indexOf(client) !== -1;
}

/** No probe result yet, or the probe never reached the world: we can't say what it takes. */
export function isUnchecked(server: FilterableServer): boolean {
  const s = server.client_support;
  return !s || (s.unreachable && s.supported.length === 0);
}

export function filterByClient<T extends FilterableServer>(servers: T[], client: ClientId | null): T[] {
  return client ? servers.filter((s) => supportsClient(s, client)) : servers;
}

/**
 * Test, dev and installer worlds, matched the way the loginserver tags them in
 * the in-game list (|T| / |D| / |I|): a leading |x| tag, a [bracketed] tag, or
 * the word test/dev/installer in the name.
 */
export function isTestServer(name: string): boolean {
  const n = name.trim();
  return /^\|[A-Za-z*]\|/.test(n) || /\[[^\]]*\b(test|dev|beta)\b[^\]]*\]/i.test(n) || /\b(test|dev|installer)\b/i.test(n);
}

/** A–Z, with test/dev worlds after all the others. */
export function byName(a: FilterableServer, b: FilterableServer): number {
  const ta = isTestServer(a.server_long_name), tb = isTestServer(b.server_long_name);
  if (ta !== tb) return ta ? 1 : -1;
  return a.server_long_name.localeCompare(b.server_long_name, "en", { sensitivity: "base" });
}

/** Online with players on (any band above Idle). */
export function isActive(s: FilterableServer): boolean {
  const online = (s.server_status ?? -1) >= 0 && !s.is_offline;
  return online && !!s.activity && s.activity !== "idle";
}

/**
 * Directory order: active worlds A–Z, then idle / offline / locked worlds
 * A–Z, then test/dev worlds A–Z (a test world stays last even when busy).
 */
export function byListing(a: FilterableServer, b: FilterableServer): number {
  const ta = isTestServer(a.server_long_name), tb = isTestServer(b.server_long_name);
  if (ta !== tb) return ta ? 1 : -1;
  const aa = isActive(a), ab = isActive(b);
  if (aa !== ab) return aa ? -1 : 1;
  return a.server_long_name.localeCompare(b.server_long_name, "en", { sensitivity: "base" });
}

/** Chips to show, in release order, with how many worlds support each. */
export function clientChips(servers: FilterableServer[], active: ClientId | null): { id: ClientId; count: number }[] {
  return CLIENT_ORDER.map((id) => ({ id, count: servers.filter((s) => supportsClient(s, id)).length }))
    .filter(({ id, count }) => PRIMARY_CLIENTS.indexOf(id) !== -1 || count > 0 || id === active);
}

/** Directory URL for a client filter ("All" is the bare path). */
export function directoryHref(client: ClientId | null): string {
  return client ? `/servers?client=${client}` : "/servers";
}
