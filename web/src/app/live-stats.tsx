"use client";

import { useEffect, useState } from "react";
import { Server } from "lucide-react";

export function LiveStats() {
  // Worlds online only: the public site shows activity bands, not player counts.
  const [serverCount, setServerCount] = useState(0);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/servers");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setServerCount(data.filter((s: any) => s.server_status >= 0 && !s.is_offline).length);
          }
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, []);

  if (serverCount === 0) return null;

  return (
    <div className="flex items-center justify-center gap-8 mt-8">
      <div className="flex items-center gap-2.5">
        <Server className="h-4 w-4 text-frost-400" />
        <span className="font-display text-lg font-bold text-parchment-100">{serverCount}</span>
        <span className="text-xs text-parchment-500 uppercase tracking-wide">
          {serverCount === 1 ? "World" : "Worlds"} Online
        </span>
      </div>
    </div>
  );
}
