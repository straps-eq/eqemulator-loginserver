"use client";

import { useEffect, useState } from "react";
import { Users, Server } from "lucide-react";

export function LiveStats() {
  const [serverCount, setServerCount] = useState(0);
  const [playerCount, setPlayerCount] = useState(0);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/servers");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setServerCount(data.length);
            setPlayerCount(data.reduce((sum: number, s: any) => sum + (s.players_online || 0), 0));
          }
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  if (serverCount === 0 && playerCount === 0) return null;

  return (
    <div className="flex items-center justify-center gap-8 mt-8">
      <div className="flex items-center gap-2.5">
        <Server className="h-4 w-4 text-frost-400" />
        <span className="font-display text-lg font-bold text-parchment-100">{serverCount}</span>
        <span className="text-xs text-parchment-500 uppercase tracking-wide">
          {serverCount === 1 ? "World" : "Worlds"} Online
        </span>
      </div>
      <div className="w-px h-5 bg-frost-400/15" />
      <div className="flex items-center gap-2.5">
        <Users className="h-4 w-4 text-arcane-400" />
        <span className="font-display text-lg font-bold text-parchment-100">{playerCount}</span>
        <span className="text-xs text-parchment-500 uppercase tracking-wide">
          {playerCount === 1 ? "Adventurer" : "Adventurers"} Online
        </span>
      </div>
    </div>
  );
}
