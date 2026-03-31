"use client";

import { useEffect, useState } from "react";
import { Users, Wifi } from "lucide-react";

interface Props {
  serverId: number;
  shortName: string;
  longName: string;
  initialPlayers: number;
  initialZones: number;
  initialStatus: number;
}

export function ServerDetailLive({ serverId, shortName, longName, initialPlayers, initialZones, initialStatus }: Props) {
  const [players, setPlayers] = useState(initialPlayers);
  const [zones, setZones] = useState(initialZones);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/servers");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const match = data.find(
              (s: any) => s.server_short_name === shortName || s.server_long_name === longName
            );
            if (match) {
              setPlayers(match.players_online ?? 0);
              setZones(match.zones_booted ?? 0);
              setStatus(match.server_status ?? 0);
            }
          }
        }
      } catch {}
    };

    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [shortName, longName]);

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded border border-frost-400/8 bg-gradient-to-b from-[#171d2d]/90 to-[#131825]/95 p-5 text-center">
        <Users className="h-5 w-5 text-frost-400 mx-auto mb-2" />
        <div className="font-display text-2xl font-bold text-parchment-100">{players}</div>
        <div className="text-xs text-parchment-500 uppercase tracking-wide mt-1">Players Online</div>
      </div>
      <div className="rounded border border-frost-400/8 bg-gradient-to-b from-[#171d2d]/90 to-[#131825]/95 p-5 text-center">
        <Wifi className="h-5 w-5 text-arcane-400 mx-auto mb-2" />
        <div className="font-display text-2xl font-bold text-parchment-100">{zones}</div>
        <div className="text-xs text-parchment-500 uppercase tracking-wide mt-1">Zones Booted</div>
      </div>
      <div className="rounded border border-frost-400/8 bg-gradient-to-b from-[#171d2d]/90 to-[#131825]/95 p-5 text-center">
        <div className={`h-5 w-5 rounded-full mx-auto mb-2 ${status > 0 ? "bg-forest-500 shadow-[0_0_10px_rgba(77,138,92,0.5)]" : "bg-obsidian-600"}`} />
        <div className="font-display text-2xl font-bold text-parchment-100">{status > 0 ? "Up" : "Down"}</div>
        <div className="text-xs text-parchment-500 uppercase tracking-wide mt-1">Status</div>
      </div>
    </div>
  );
}
