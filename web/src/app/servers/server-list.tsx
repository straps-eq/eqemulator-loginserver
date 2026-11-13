"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { serverPath } from "@/lib/slug";
import type { PublicServer } from "@/lib/public-servers";
import { WifiOff, ShieldCheck, Info } from "lucide-react";
import { ClientSupportInline } from "@/components/client-badges";
import { ActivityBadge } from "@/components/activity-badge";
import { CLIENT_LABELS, CLIENT_TITLES, type ClientId } from "@/lib/client-probe/labels";
import {
  byListing,
  isActive,
  isTestServer,
  clientChips,
  directoryHref,
  filterByClient,
  isUnchecked,
  parseClientFilter,
} from "@/lib/server-filters";

type ServerData = PublicServer;

/** Full client name for captions; ToB is introduced by its full name. */
function clientName(c: ClientId): string {
  if (c === "tob") return "The Outer Brood (ToB)";
  if (c === "eql") return "the EverQuest Legends client (EQL)";
  return `${CLIENT_TITLES[c]} (${CLIENT_LABELS[c]})`;
}

/** Clients whose filter chip gets a gold star. */
const STARRED: ClientId[] = ["tob", "eql"];

export function ServerList({ initial }: { initial: ServerData[] }) {
  const [servers, setServers] = useState<ServerData[]>(initial);
  // ?client= is the source of truth, read during SSR too, so shared filtered
  // links render filtered without JS
  const searchParams = useSearchParams();
  const client = parseClientFilter(searchParams.get("client"));
  const onlineCount = servers.filter((s) => s.server_status >= 0 && !s.is_offline).length;

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/servers");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setServers(data);
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, []);

  // Filter in place: the chips are real links (so they work without JS and
  // can be shared), but a plain click just swaps the URL in place (Next syncs
  // replaceState into useSearchParams) without a server round trip.
  const choose = (e: MouseEvent<HTMLAnchorElement>, nextClient: ClientId | null) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.history.replaceState(null, "", directoryHref(nextClient));
  };

  const visible = filterByClient(servers, client);
  const uncheckedCount = client ? servers.filter(isUnchecked).length : 0;
  const chips = clientChips(servers, client);

  // A-Z, not ranked by population, so a small world gets the same footing as a
  // busy one: worlds with players on, then idle/offline worlds, then test/dev.
  const sorted = [...visible].sort(byListing);
  // Three quiet sections in one table: active worlds, then idle/offline, then
  // test/dev (byListing already orders them that way).
  const sections = [
    { key: "active", label: null as string | null, servers: sorted.filter((s) => !isTestServer(s.server_long_name) && isActive(s)) },
    { key: "quiet", label: "Idle", servers: sorted.filter((s) => !isTestServer(s.server_long_name) && !isActive(s)) },
    { key: "test", label: "Test & dev", servers: sorted.filter((s) => isTestServer(s.server_long_name)) },
  ].filter((g) => g.servers.length > 0);

  return (
    <>
      <div className="mb-8">
        <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-400/60 block mb-3">
          Server Directory
        </span>
        <h1 className="font-display text-3xl font-bold text-parchment-100">EQEmu Server List</h1>
        <p className="text-parchment-500 mt-2 text-sm">
          <span className="text-frost-400">{onlineCount}</span> world{onlineCount !== 1 ? "s" : ""} online, listed A to Z.
          Activity shows how busy each world is right now: Low, Medium or High. Idle worlds, then test servers, are listed below.
        </p>
      </div>

      {servers.length > 0 && (
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Filter by game client" className="flex flex-wrap items-center gap-2">
            {[{ id: null as ClientId | null, count: servers.length }, ...chips].map(({ id, count }) => {
              const active = client === id;
              return (
                <a
                  key={id ?? "all"}
                  href={directoryHref(id)}
                  onClick={(e) => choose(e, id)}
                  aria-current={active ? "true" : undefined}
                  title={id ? `Worlds that work with ${clientName(id)}` : "Every world in the directory"}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-display tracking-wider transition-colors duration-200 ${
                    active
                      ? "border-transparent bg-gradient-to-b from-[#f4d590] to-[#d4a650] text-[#1b2350] font-semibold shadow-[0_4px_14px_rgba(242,207,134,0.25)]"
                      : "border-frost-400/20 bg-[#202842]/70 text-parchment-200 hover:border-frost-400/40 hover:text-frost-200"
                  }`}
                >
                  {id && STARRED.indexOf(id) !== -1 && (
                    <span aria-hidden="true" className={active ? "text-[#1b2350]" : "text-[#f4d590]"}>★</span>
                  )}
                  {id ? CLIENT_LABELS[id] : "All"}
                  <span className={active ? "text-[#1b2350]/70" : "text-parchment-400"}>{count}</span>
                </a>
              );
            })}
          </nav>
        </div>
      )}

      {client && servers.length > 0 && (
        <div className="mb-4 space-y-1 text-sm">
          {visible.length > 0 && (
            <p className="text-parchment-300">
              Showing {visible.length} world{visible.length !== 1 ? "s" : ""} that work{visible.length === 1 ? "s" : ""} with {clientName(client)}.
              We check each world regularly, so this list keeps itself up to date.
            </p>
          )}
          {uncheckedCount > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-parchment-500">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-frost-400/60" aria-hidden="true" />
              <span>
                Some servers haven&apos;t been checked yet, so they aren&apos;t shown here.{" "}
                <a href={directoryHref(null)} onClick={(e) => choose(e, null)} className="text-frost-400 hover:text-frost-300">
                  See all servers
                </a>
              </span>
            </p>
          )}
        </div>
      )}

      {servers.length === 0 ? (
        <div className="rounded-lg border border-frost-400/10 bg-[#202842]/80 p-14 text-center">
          <WifiOff className="h-10 w-10 text-parchment-700 mx-auto mb-4" />
          <h3 className="font-display text-lg font-semibold text-parchment-300 mb-2">No Worlds Online</h3>
          <p className="text-parchment-500 text-sm">
            No world servers are currently connected to the login server.
          </p>
        </div>
      ) : visible.length === 0 && client ? (
        <div className="rounded-lg border border-frost-400/10 bg-[#202842]/80 p-14 text-center">
          <h3 className="font-display text-lg font-semibold text-parchment-300 mb-2">No {CLIENT_LABELS[client]} worlds found yet</h3>
          <p className="text-parchment-500 text-sm mb-5">
            We haven&apos;t found a world that works with {clientName(client)} yet. New worlds are checked regularly, so check back soon.
          </p>
          <a
            href={directoryHref(null)}
            onClick={(e) => choose(e, null)}
            className="rounded border border-frost-400/25 bg-frost-400/5 px-6 py-2.5 text-xs font-display font-medium tracking-wider uppercase text-frost-300 hover:bg-frost-400/10 hover:border-frost-400/40 transition-all duration-300"
          >
            See all servers
          </a>
        </div>
      ) : (
        <div className="rounded-lg border border-frost-400/10 bg-[#202842]/60 overflow-hidden">
          {/* Column header */}
          <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_90px] gap-x-4 px-4 py-2 border-b border-frost-400/5 bg-[#1b2238]/40">
            <span className="text-[10px] text-parchment-700 uppercase tracking-[0.15em] font-display">Server</span>
            <span className="text-[10px] text-parchment-700 uppercase tracking-[0.15em] font-display text-right sm:text-left">Activity</span>
            <span className="text-[10px] text-parchment-700 uppercase tracking-[0.15em] font-display text-center hidden sm:block">Status</span>
          </div>

          {sections.map((section) => (
            <div key={section.key}>
              {/* Section bar: a dark strip, not a new card */}
              {section.label && (
                <div className="flex items-center gap-2 px-4 py-1.5 bg-[#141a2c]/80 border-y border-frost-400/5">
                  <span className="text-[10px] text-parchment-500 uppercase tracking-[0.2em] font-display">{section.label}</span>
                  <span className="text-[10px] text-parchment-700">{section.servers.length}</span>
                </div>
              )}
          {/* Server rows */}
          {section.servers.map((server, i) => {
            const isOnline = server.server_status >= 0 && !server.is_offline;
            const isLocked = server.server_status === -2;

            return (
              <Link
                key={`${server.server_short_name}-${i}`}
                href={serverPath(server.server_long_name)}
                scroll={false}
                className={`grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_90px] gap-x-4 px-4 py-3 items-center transition-colors duration-200 hover:bg-frost-400/[0.03] focus-visible:outline-none focus-visible:bg-frost-400/[0.06] ${
                  i < section.servers.length - 1 ? "border-b border-frost-400/5" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-2 w-2 rounded-full flex-shrink-0 ${isOnline ? "bg-forest-500" : isLocked ? "bg-amber-400" : "bg-parchment-800"}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm font-semibold text-parchment-100 truncate">
                        {server.server_long_name}
                      </span>
                      {server.is_trusted && (
                        <ShieldCheck className="h-3.5 w-3.5 text-forest-400 flex-shrink-0" style={{ filter: "drop-shadow(0 0 3px rgba(77,138,92,0.4))" }} />
                      )}
                    </div>
                    {server.tag_description && (
                      <span className="text-[11px] text-parchment-600 truncate block">{server.tag_description}</span>
                    )}
                    <ClientSupportInline summary={server.client_support} />
                  </div>
                </div>
                <div className="text-right sm:text-left">
                  {isOnline ? (
                    <ActivityBadge activity={server.activity} />
                  ) : (
                    <span className={`text-xs font-display sm:hidden ${isLocked ? "text-amber-400" : "text-red-400/70"}`}>
                      {isLocked ? "Locked" : "Offline"}
                    </span>
                  )}
                </div>
                <div className="text-center hidden sm:block">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-display ${isOnline ? "text-forest-400" : isLocked ? "text-amber-400" : "text-red-400/70"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-forest-400" : isLocked ? "bg-amber-400" : "bg-red-400/70"}`} />
                    {isOnline ? "Online" : isLocked ? "Locked" : "Offline"}
                  </span>
                </div>
              </Link>
            );
          })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
