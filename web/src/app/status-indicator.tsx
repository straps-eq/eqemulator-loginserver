"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function StatusIndicator() {
  const [status, setStatus] = useState<"loading" | "operational" | "degraded" | "down">("loading");

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/status");
        if (res.ok) {
          const data = await res.json();
          setStatus(data.loginserver === "up" ? "operational" : "degraded");
        } else {
          setStatus("degraded");
        }
      } catch {
        setStatus("down");
      }
    };

    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  if (status === "loading") return null;

  const color = status === "operational" ? "bg-emerald-400" : status === "degraded" ? "bg-amber-400" : "bg-red-400";
  const label = status === "operational" ? "All Systems Operational" : status === "degraded" ? "Degraded Performance" : "Service Disruption";

  return (
    <Link href="/status" className="inline-flex items-center gap-2 mt-6 px-3 py-1.5 rounded-full border border-frost-400/8 hover:border-frost-400/15 transition-colors group">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      <span className="text-[10px] font-display tracking-wider uppercase text-parchment-500 group-hover:text-parchment-400 transition-colors">
        {label}
      </span>
    </Link>
  );
}
