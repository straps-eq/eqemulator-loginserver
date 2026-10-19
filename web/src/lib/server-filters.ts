/**
 * Client filter and sort for the server directory (/servers?client=&sort=).
 * Pure functions, safe to import from client components and unit tests.
 */
import { CLIENT_ORDER, type ClientId } from "./client-probe/labels";

export type ServerSort = "players" | "name";

/** Chips always shown; other clients get a chip only when some world supports them. */
export const PRIMARY_CLIENTS: ClientId[] = ["titanium", "rof2", "tob"];

/** The fields filtering needs, so this module doesn't pull in the DB layer. */
export interface FilterableServer {
  server_long_name: string;
  players_online?: number;
  client_support?: { supported: string[]; unreachable: boolean } | null;
}

/** ?client= value -> client id, or null for "All" (also for unknown values). */
export function parseClientFilter(value: unknown): ClientId | null {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  return CLIENT_ORDER.find((c) => c === v) ?? null;
}

/** ?sort= value; anything unrecognized keeps the default (players online). */
export function parseSort(value: unknown): ServerSort {
  return value === "name" ? "name" : "players";
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

/** Most players first; hidden counts sort as 0. Stable for ties. */
export function byPlayers(a: FilterableServer, b: FilterableServer): number {
  return (b.players_online ?? 0) - (a.players_online ?? 0);
}

export function byName(a: FilterableServer, b: FilterableServer): number {
  return a.server_long_name.localeCompare(b.server_long_name, "en", { sensitivity: "base" });
}

/** Chips to show, in release order, with how many worlds support each. */
export function clientChips(servers: FilterableServer[], active: ClientId | null): { id: ClientId; count: number }[] {
  return CLIENT_ORDER.map((id) => ({ id, count: servers.filter((s) => supportsClient(s, id)).length }))
    .filter(({ id, count }) => PRIMARY_CLIENTS.indexOf(id) !== -1 || count > 0 || id === active);
}

/** Directory URL for a filter/sort pair, leaving defaults out of the query. */
export function directoryHref(client: ClientId | null, sort: ServerSort): string {
  const q = new URLSearchParams();
  if (client) q.set("client", client);
  if (sort !== "players") q.set("sort", sort);
  const qs = q.toString();
  return qs ? `/servers?${qs}` : "/servers";
}
