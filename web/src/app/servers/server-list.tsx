"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WifiOff, ShieldCheck } from "lucide-react";

interface ServerData {
  server_long_name: string;
  server_short_name: string;
  server_list_type_id: number;
  server_status: number;
  zones_booted: number;
  players_online: number;
  world_id: number;
  db_id?: number | null;
  is_trusted?: boolean;
  is_claimed?: boolean;
  tag_description?: string | null;
  display_tier?: string;
  tier_override?: boolean;
  show_player_count?: boolean;
}

const tierOrder = ["high", "medium", "low"] as const;

const tierMeta: Record<string, { label: string; accent: string; headerBg: string; headerBorder: string }> = {
  high:   { label: "High Population",   accent: "text-forest-400",     headerBg: "bg-forest-400/[0.04]", headerBorder: "border-forest-400/10" },
  medium: { label: "Medium Population", accent: "text-amber-400/80",   headerBg: "bg-amber-400/[0.03]",  headerBorder: "border-amber-400/8" },
  low:    { label: "Low Population",    accent: "text-parchment-500",  headerBg: "bg-[#0c1019]/60",      headerBorder: "border-frost-400/6" },
};

export function ServerList({ initial }: { initial: ServerData[] }) {
  const router = useRouter();
  const [servers, setServers] = useState<ServerData[]>(initial);
  const totalPlayers = servers.reduce((sum, s) => sum + s.players_online, 0);

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

  // Group by population tier, sort by players within each group
  const grouped = tierOrder.map((tier) => ({
    tier,
    servers: servers
      .filter((s) => (s.display_tier || "low") === tier)
      .sort((a, b) => b.players_online - a.players_online),
  })).filter((g) => g.servers.length > 0);

  return (
    <>
      <div className="mb-8">
        <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-400/60 block mb-3">
          Server Directory
        </span>
        <h1 className="font-display text-3xl font-bold text-parchment-100">Active Servers</h1>
        <p className="text-parchment-500 mt-2 text-sm">
          {servers.length} world{servers.length !== 1 ? "s" : ""} connected · <span className="text-frost-400">{totalPlayers}</span> adventurer{totalPlayers !== 1 ? "s" : ""} online
        </p>
      </div>

      {servers.length === 0 ? (
        <div className="rounded-lg border border-frost-400/10 bg-[#0a0e17]/80 p-14 text-center">
          <WifiOff className="h-10 w-10 text-parchment-700 mx-auto mb-4" />
          <h3 className="font-display text-lg font-semibold text-parchment-300 mb-2">No Worlds Online</h3>
          <p className="text-parchment-500 text-sm">
            No world servers are currently connected to the login server.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ tier, servers: tierServers }) => {
            const meta = tierMeta[tier] || tierMeta.standard;
            const tierPlayers = tierServers.reduce((sum, s) => sum + s.players_online, 0);

            return (
              <div key={tier} className="rounded-lg border border-frost-400/10 bg-[#0a0e17]/60 overflow-hidden">
                {/* Tier section header */}
                <div className={`flex items-center justify-between px-4 py-2.5 border-b ${meta.headerBorder} ${meta.headerBg}`}>
                  <div className="flex items-center gap-2.5">
                    <span className={`font-display text-xs font-semibold uppercase tracking-[0.2em] ${meta.accent}`}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-parchment-700">
                      {tierServers.length} server{tierServers.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <span className="text-[10px] text-parchment-600">
                    {tierPlayers} player{tierPlayers !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Column header */}
                <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_90px_90px] gap-x-4 px-4 py-2 border-b border-frost-400/5 bg-[#0c1019]/40">
                  <span className="text-[10px] text-parchment-700 uppercase tracking-[0.15em] font-display">Server</span>
                  <span className="text-[10px] text-parchment-700 uppercase tracking-[0.15em] font-display text-right">Players</span>
                  <span className="text-[10px] text-parchment-700 uppercase tracking-[0.15em] font-display text-center hidden sm:block">Status</span>
                </div>

                {/* Server rows */}
                {tierServers.map((server, i) => {
                  const isOnline = server.server_status > 0;
                  const hideCount = server.show_player_count === false;

                  return (
                    <div
                      key={`${server.server_short_name}-${i}`}
                      className={`grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_90px_90px] gap-x-4 px-4 py-3 items-center transition-colors duration-200 hover:bg-frost-400/[0.03] ${
                        server.db_id ? "cursor-pointer" : ""
                      } ${i < tierServers.length - 1 ? "border-b border-frost-400/5" : ""}`}
                      onClick={() => server.server_short_name && router.push(`/servers/${encodeURIComponent(server.server_short_name)}`, { scroll: false })}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`h-2 w-2 rounded-full flex-shrink-0 ${isOnline ? "bg-forest-500" : "bg-parchment-800"}`} />
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
                        </div>
                      </div>
                      <div className="text-right">
                        {hideCount ? (
                          <span className="text-xs text-parchment-700 font-display">—</span>
                        ) : (
                          <span className={`font-display text-sm font-bold ${server.players_online > 0 ? "text-frost-300" : "text-parchment-700"}`}>
                            {server.players_online}
                          </span>
                        )}
                      </div>
                      <div className="text-center hidden sm:block">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-display ${isOnline ? "text-forest-400" : "text-red-400/70"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-forest-400" : "bg-red-400/70"}`} />
                          {isOnline ? "Online" : "Offline"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
