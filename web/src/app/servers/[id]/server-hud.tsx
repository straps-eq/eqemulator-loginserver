"use client";

import { useEffect, useState, useRef } from "react";
import { Users, Shield, ShieldCheck, Globe, MessageCircle, Activity } from "lucide-react";

interface ServerInfo {
  longName: string;
  shortName: string;
  ipAddress: string;
  isTrusted: boolean;
  isClaimed?: boolean;
  tagDescription: string;
  websiteUrl?: string | null;
  discordUrl?: string | null;
  expansionEra?: string | null;
  description?: string | null;
}

interface Props {
  serverId: number;
  info: ServerInfo;
  initialPlayers: number;
  initialStatus: number;
}

function AnimatedNumber({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);
  const startRef = useRef<number>(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    startRef.current = ref.current;
    const startTime = performance.now();
    const diff = value - startRef.current;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startRef.current + diff * eased);
      setDisplay(current);
      ref.current = current;
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  return <>{display}</>;
}

function UptimeRing({ percent }: { percent: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const color = percent >= 99 ? "#4d8a5c" : percent >= 95 ? "#e5ad2e" : "#c0392b";

  return (
    <svg width="84" height="84" className="transform -rotate-90">
      <circle
        cx="42" cy="42" r={radius}
        fill="none"
        stroke="rgba(52,187,250,0.06)"
        strokeWidth="4"
      />
      <circle
        cx="42" cy="42" r={radius}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-1000 ease-out"
        style={{ filter: `drop-shadow(0 0 6px ${color}40)` }}
      />
    </svg>
  );
}

function ensureProtocol(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `https://${url}`;
}

export function ServerHUD({ serverId, info, initialPlayers, initialStatus }: Props) {
  const [players, setPlayers] = useState(initialPlayers);
  const [status, setStatus] = useState(initialStatus);
  const [uptime, setUptime] = useState<number | null>(null);
  const [avgPlayers, setAvgPlayers] = useState<number | null>(null);
  const [peakPlayers, setPeakPlayers] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Fetch history stats (from Prometheus)
    fetch(`/api/servers/${serverId}/history?days=30`)
      .then((r) => r.json())
      .then((data) => {
        if (data.stats) {
          setAvgPlayers(data.stats.avg);
          setPeakPlayers(data.stats.max);
          if (data.stats.uptime_pct !== undefined && data.stats.uptime_pct !== null) {
            setUptime(data.stats.uptime_pct);
          }
        }
      })
      .catch(() => {});

    // Poll live data
    const poll = async () => {
      try {
        const res = await fetch("/api/servers");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const match = data.find(
              (s: any) => s.server_short_name === info.shortName || s.server_long_name === info.longName
            );
            if (match) {
              setPlayers(match.players_online ?? 0);
              setStatus(match.server_status ?? 0);
            }
          }
        }
      } catch {}
    };
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [serverId, info.shortName, info.longName]);

  const isOnline = status > 0;

  return (
    <div className={`relative overflow-hidden rounded-lg border transition-all duration-700 ${
      mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
    } ${isOnline ? "border-frost-400/15" : "border-obsidian-600/50"}`}>
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0c1019] via-[#111825] to-[#0e1420]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(52,187,250,0.06)_0%,_transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(129,140,248,0.04)_0%,_transparent_50%)]" />

      {/* Scan line effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(52,187,250,0.15) 2px, rgba(52,187,250,0.15) 3px)",
          }}
        />
        {isOnline && (
          <div className="absolute w-full h-px bg-gradient-to-r from-transparent via-frost-400/20 to-transparent animate-pulse" style={{ top: "50%" }} />
        )}
      </div>

      {/* Corner accents */}
      <div className="absolute top-0 left-0 w-16 h-px bg-gradient-to-r from-frost-400/30 to-transparent" />
      <div className="absolute top-0 left-0 h-16 w-px bg-gradient-to-b from-frost-400/30 to-transparent" />
      <div className="absolute bottom-0 right-0 w-16 h-px bg-gradient-to-l from-frost-400/30 to-transparent" />
      <div className="absolute bottom-0 right-0 h-16 w-px bg-gradient-to-t from-frost-400/30 to-transparent" />

      <div className="relative p-6 sm:p-8">
        {/* Header — Status + Name + Server Class */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="relative">
                <div className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-forest-500" : "bg-red-500/60"}`} />
                {isOnline && (
                  <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-forest-500 animate-ping opacity-40" />
                )}
              </div>
              <span className={`font-display text-[10px] tracking-[0.25em] uppercase ${isOnline ? "text-forest-400" : "text-red-400/60"}`}>
                {isOnline ? "Systems Online" : "Offline"}
              </span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-parchment-100 mt-2">
              {info.longName}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-parchment-600 text-xs font-mono">{info.shortName}</p>
              {info.isClaimed && (
                <span className="text-[9px] font-display uppercase tracking-wider text-forest-400 bg-forest-400/10 border border-forest-400/20 px-1.5 py-0.5 rounded">
                  Claimed
                </span>
              )}
            </div>
          </div>
          <div className="text-right flex flex-col items-end gap-1 mt-1">
            <div className="flex items-center gap-2">
              {info.isTrusted ? (
                <ShieldCheck className="h-5 w-5 text-forest-400" style={{ filter: "drop-shadow(0 0 4px rgba(77,138,92,0.4))" }} />
              ) : (
                <Shield className="h-5 w-5 text-parchment-600" />
              )}
              <span className={`font-display text-lg sm:text-xl font-bold ${info.isTrusted ? "text-forest-400" : "text-parchment-500"}`}>
                {info.isTrusted ? "Verified" : "Unverified"}
              </span>
            </div>
            <span className="text-[10px] text-parchment-600 uppercase tracking-[0.2em]">Server Status</span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {/* Online Players — glowing hero box */}
          <div className={`relative rounded-lg border border-frost-400/20 bg-[#070a11]/90 p-5 sm:p-6 flex flex-col items-center justify-center transition-all duration-500 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`} style={{ transitionDelay: "200ms", boxShadow: "0 0 20px rgba(52,187,250,0.08), inset 0 0 20px rgba(52,187,250,0.04)" }}>
            <Users className="h-5 w-5 text-frost-400/50 mb-3" />
            <span className="font-display text-3xl sm:text-4xl font-bold text-frost-300" style={{ textShadow: "0 0 20px rgba(52,187,250,0.3)" }}>
              <AnimatedNumber value={players} />
            </span>
            <span className="text-xs text-frost-400/60 uppercase tracking-[0.2em] mt-2">Online</span>
          </div>

          {/* Uptime */}
          <div className={`relative rounded-lg border border-frost-400/10 bg-[#070a11]/90 p-5 sm:p-6 flex flex-col items-center transition-all duration-500 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`} style={{ transitionDelay: "350ms" }}>
            <div className="relative mb-2">
              <UptimeRing percent={uptime ?? (isOnline ? 100 : 0)} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-display text-base font-bold text-parchment-100">
                  {uptime !== null ? `${uptime}%` : (isOnline ? "100%" : "—")}
                </span>
              </div>
            </div>
            <span className="text-xs text-parchment-500 uppercase tracking-[0.2em]">Uptime</span>
          </div>

          {/* Avg Players */}
          <div className={`relative rounded-lg border border-frost-400/10 bg-[#070a11]/90 p-5 sm:p-6 flex flex-col items-center justify-center transition-all duration-500 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`} style={{ transitionDelay: "500ms" }}>
            <Users className="h-5 w-5 text-arcane-400/40 mb-3" />
            <span className="font-display text-2xl sm:text-3xl font-bold text-parchment-100">
              {avgPlayers !== null ? <AnimatedNumber value={avgPlayers} /> : "—"}
            </span>
            <span className="text-xs text-parchment-500 uppercase tracking-[0.2em] mt-2">Avg Players</span>
          </div>

          {/* Peak Players */}
          <div className={`relative rounded-lg border border-frost-400/10 bg-[#070a11]/90 p-5 sm:p-6 flex flex-col items-center justify-center transition-all duration-500 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`} style={{ transitionDelay: "650ms" }}>
            <Activity className="h-5 w-5 text-frost-400/40 mb-3" />
            <span className="font-display text-2xl sm:text-3xl font-bold text-parchment-100">
              {peakPlayers !== null ? <AnimatedNumber value={peakPlayers} /> : "—"}
            </span>
            <span className="text-xs text-parchment-500 uppercase tracking-[0.2em] mt-2">Peak</span>
          </div>
        </div>

        {/* Bottom info row */}
        <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 pt-4 border-t border-frost-400/6 transition-all duration-500 ${mounted ? "opacity-100" : "opacity-0"}`} style={{ transitionDelay: "800ms" }}>
          {info.expansionEra && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-parchment-500">Era</span>
              <span className="text-parchment-300">{info.expansionEra}</span>
            </div>
          )}
          {info.tagDescription && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-parchment-500">Tag</span>
              <span className="text-parchment-300">{info.tagDescription}</span>
            </div>
          )}
          <div className="flex-1" />
          {info.websiteUrl && (
            <a href={ensureProtocol(info.websiteUrl)} target="_blank" rel="noopener noreferrer"
              className="hover-frost flex items-center gap-1.5 text-frost-400/70 text-xs transition-colors">
              <Globe className="h-3 w-3" /> Website
            </a>
          )}
          {info.discordUrl && (
            <a href={ensureProtocol(info.discordUrl)} target="_blank" rel="noopener noreferrer"
              className="hover-frost flex items-center gap-1.5 text-frost-400/70 text-xs transition-colors">
              <MessageCircle className="h-3 w-3" /> Discord
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
