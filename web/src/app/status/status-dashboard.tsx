"use client";

import { useEffect, useState } from "react";
import { Activity, Database, Server, CheckCircle2, XCircle, Clock, Cpu, HardDrive, MemoryStick, Wifi, Timer, Users, Globe, Shield } from "lucide-react";
import Link from "next/link";

interface ServiceStatus {
  name: string;
  status: "up" | "down";
  latencyMs?: number;
}

interface StatusData {
  overall: "operational" | "degraded";
  loginserver: "up" | "down";
  database: "up" | "down";
  services: ServiceStatus[];
  system: {
    cpu: { usagePercent: number; cores: number };
    memory: { totalMb: number; usedMb: number; usagePercent: number };
    disk: { totalGb: number; usedGb: number; usagePercent: number };
    network: { rxMbps: number; txMbps: number };
    uptime: { seconds: number; formatted: string };
    load: { load1: number; load5: number; load15: number };
  };
  summary: {
    connectedWorlds: number;
    totalPlayers: number;
  };
  platform: {
    registeredAccounts: number;
    registeredWorldServers: number;
    serverOperators: number;
  };
  checkedAt: string;
}

function UsageBar({ percent, color = "frost" }: { percent: number; color?: string }) {
  const barColor =
    percent > 90 ? "bg-red-400" :
    percent > 70 ? "bg-amber-400" :
    color === "forest" ? "bg-forest-400" :
    color === "arcane" ? "bg-arcane-400" :
    "bg-frost-400";
  const glowColor =
    percent > 90 ? "rgba(248,113,113,0.3)" :
    percent > 70 ? "rgba(251,191,36,0.3)" :
    "rgba(52,187,250,0.2)";
  return (
    <div className="w-full h-1.5 rounded-full bg-[#151b2a] overflow-hidden">
      <div
        className={`h-full rounded-full ${barColor} transition-all duration-700 ease-out`}
        style={{ width: `${Math.min(percent, 100)}%`, boxShadow: `0 0 8px ${glowColor}` }}
      />
    </div>
  );
}

export function StatusDashboard() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [lastChecked, setLastChecked] = useState<string>("");

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/status");
        if (res.ok) {
          const json = await res.json();
          setData(json);
          setLastChecked(new Date().toLocaleTimeString());
          setError(false);
          setDisabled(false);
        } else if (res.status === 403) {
          setDisabled(true);
          setError(false);
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      }
    };
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, []);

  const serviceIcon = (name: string) => {
    switch (name) {
      case "loginserver": return Server;
      case "database": return Database;
      default: return Activity;
    }
  };

  const serviceLabel = (name: string) => {
    switch (name) {
      case "loginserver": return "Login Server";
      case "database": return "Database";
      default: return name;
    }
  };

  const serviceDesc = (name: string) => {
    switch (name) {
      case "loginserver": return "Handles player authentication and server list delivery via ports 5998/5999/15900";
      case "database": return "Stores account data, server registrations, and platform state";
      default: return "";
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-400/60 block mb-3">
        Infrastructure
      </span>
      <h1 className="font-display text-3xl font-bold text-parchment-100 mb-2">System Status</h1>
      <p className="text-parchment-400 mb-8">
        Real-time health and telemetry of the EQEmulator.dev login infrastructure.
      </p>

      {/* Disabled message */}
      {disabled && (
        <div className="rounded-lg border border-frost-400/10 bg-[#0a0e16]/80 p-8 text-center">
          <Shield className="h-8 w-8 text-parchment-600 mx-auto mb-3" />
          <h2 className="font-display text-lg font-semibold text-parchment-200 mb-2">Status Page Unavailable</h2>
          <p className="text-parchment-500 text-sm">
            The public status page has been disabled by the administrator.
          </p>
        </div>
      )}

      {!disabled && (<>
      {/* Overall status banner */}
      <div className={`rounded-lg border p-5 mb-8 ${
        error
          ? "border-red-400/20 bg-red-400/5"
          : data?.overall === "operational"
            ? "border-emerald-400/20 bg-emerald-400/5"
            : "border-amber-400/20 bg-amber-400/5"
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${
              error ? "bg-red-400" : data?.overall === "operational" ? "bg-emerald-400" : "bg-amber-400"
            }`} />
            <span className="font-display text-base font-semibold text-parchment-100">
              {error ? "Unable to Check Status" : data?.overall === "operational" ? "All Systems Operational" : "Degraded Performance"}
            </span>
          </div>
          {lastChecked && (
            <div className="flex items-center gap-1.5 text-parchment-600">
              <Clock className="h-3 w-3" />
              <span className="text-xs font-mono">{lastChecked}</span>
            </div>
          )}
        </div>
      </div>

      {/* Service cards */}
      <div className="space-y-3 mb-8">
        <h2 className="font-display text-xs tracking-[0.2em] uppercase text-parchment-500 mb-2">Service Health</h2>
        {data?.services?.map((service) => {
          const Icon = serviceIcon(service.name);
          const isUp = service.status === "up";
          return (
            <div
              key={service.name}
              className="rounded-lg border border-frost-400/8 bg-gradient-to-b from-[#171d2d]/90 to-[#131825]/95 p-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`inline-flex items-center justify-center w-9 h-9 rounded border ${
                    isUp ? "border-emerald-400/20 bg-emerald-400/5" : "border-red-400/20 bg-red-400/5"
                  }`}>
                    <Icon className={`h-4 w-4 ${isUp ? "text-emerald-400/70" : "text-red-400/70"}`} />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-semibold text-parchment-200">
                      {serviceLabel(service.name)}
                    </h3>
                    <p className="text-parchment-600 text-xs">{serviceDesc(service.name)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {service.latencyMs !== undefined && (
                    <span className="text-xs font-mono text-parchment-500">
                      {service.latencyMs}ms
                    </span>
                  )}
                  <div className="flex items-center gap-1.5">
                    {isUp ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400" />
                    )}
                    <span className={`text-xs font-display font-medium uppercase tracking-wider ${
                      isUp ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {isUp ? "Operational" : "Down"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {!data && !error && (
          <div className="text-center py-8">
            <p className="text-parchment-500 text-sm">Checking services...</p>
          </div>
        )}
      </div>

      {/* Load average + uptime + summary row */}
      {data?.system && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/80 p-4 text-center">
            <Timer className="h-4 w-4 text-forest-400/50 mx-auto mb-1.5" />
            <span className="font-mono text-lg font-bold text-parchment-100 block">{data.system.uptime.formatted}</span>
            <span className="text-[10px] text-parchment-500 uppercase tracking-[0.2em]">Uptime</span>
          </div>
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/80 p-4 text-center">
            <Activity className="h-4 w-4 text-frost-400/50 mx-auto mb-1.5" />
            <span className="font-mono text-lg font-bold text-parchment-100 block">
              {data.system.load.load1} <span className="text-xs text-parchment-600">/ {data.system.load.load5} / {data.system.load.load15}</span>
            </span>
            <span className="text-[10px] text-parchment-500 uppercase tracking-[0.2em]">Load Avg</span>
          </div>
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/80 p-4 text-center">
            <Users className="h-4 w-4 text-frost-400/50 mx-auto mb-1.5" />
            <span className="font-display text-lg font-bold text-frost-300 block" style={{ textShadow: "0 0 12px rgba(52,187,250,0.2)" }}>
              {data.summary.totalPlayers}
            </span>
            <span className="text-[10px] text-parchment-500 uppercase tracking-[0.2em]">Players</span>
          </div>
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/80 p-4 text-center">
            <Globe className="h-4 w-4 text-forest-400/50 mx-auto mb-1.5" />
            <span className="font-display text-lg font-bold text-parchment-100 block">{data.summary.connectedWorlds}</span>
            <span className="text-[10px] text-parchment-500 uppercase tracking-[0.2em]">Worlds</span>
          </div>
        </div>
      )}

      {/* System resource metrics */}
      {data?.system && (
        <div className="mb-8">
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-parchment-500 mb-3">Server Resources</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* CPU */}
            <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/80 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-frost-400/50" />
                  <span className="text-xs font-display text-parchment-300 uppercase tracking-wider">CPU</span>
                </div>
                <span className="font-mono text-sm font-bold text-parchment-100">{data.system.cpu.usagePercent}%</span>
              </div>
              <UsageBar percent={data.system.cpu.usagePercent} />
              <span className="text-[10px] text-parchment-600 mt-1.5 block">{data.system.cpu.cores} cores</span>
            </div>

            {/* Memory */}
            <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/80 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MemoryStick className="h-4 w-4 text-arcane-400/50" />
                  <span className="text-xs font-display text-parchment-300 uppercase tracking-wider">Memory</span>
                </div>
                <span className="font-mono text-sm font-bold text-parchment-100">{data.system.memory.usagePercent}%</span>
              </div>
              <UsageBar percent={data.system.memory.usagePercent} color="arcane" />
              <span className="text-[10px] text-parchment-600 mt-1.5 block">
                {(data.system.memory.usedMb / 1024).toFixed(1)} / {(data.system.memory.totalMb / 1024).toFixed(1)} GB
              </span>
            </div>

            {/* Disk */}
            <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/80 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-forest-400/50" />
                  <span className="text-xs font-display text-parchment-300 uppercase tracking-wider">Disk</span>
                </div>
                <span className="font-mono text-sm font-bold text-parchment-100">{data.system.disk.usagePercent}%</span>
              </div>
              <UsageBar percent={data.system.disk.usagePercent} color="forest" />
              <span className="text-[10px] text-parchment-600 mt-1.5 block">
                {data.system.disk.usedGb} / {data.system.disk.totalGb} GB
              </span>
            </div>

            {/* Network */}
            <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/80 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wifi className="h-4 w-4 text-frost-400/50" />
                <span className="text-xs font-display text-parchment-300 uppercase tracking-wider">Network I/O</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-parchment-600 block">RX</span>
                  <span className="font-mono text-sm font-bold text-frost-300">{data.system.network.rxMbps} MB/s</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-parchment-600 block">TX</span>
                  <span className="font-mono text-sm font-bold text-arcane-300">{data.system.network.txMbps} MB/s</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Platform stats */}
      {data?.platform && (
        <div className="mb-8">
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-parchment-500 mb-3">Platform</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/60 p-4">
              <span className="text-[10px] font-display text-parchment-600 uppercase tracking-wider block mb-1">Accounts</span>
              <span className="font-display text-lg font-bold text-parchment-100">{data.platform.registeredAccounts.toLocaleString()}</span>
            </div>
            <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/60 p-4">
              <span className="text-[10px] font-display text-parchment-600 uppercase tracking-wider block mb-1">World Servers</span>
              <span className="font-display text-lg font-bold text-parchment-100">{data.platform.registeredWorldServers}</span>
            </div>
            <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/60 p-4">
              <span className="text-[10px] font-display text-parchment-600 uppercase tracking-wider block mb-1">Operators</span>
              <span className="font-display text-lg font-bold text-parchment-100">{data.platform.serverOperators}</span>
            </div>
          </div>
        </div>
      )}

      {/* Info section */}
      <div className="space-y-4 mb-8">
        <h2 className="font-display text-xs tracking-[0.2em] uppercase text-parchment-500">Infrastructure</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/60 p-4">
            <h3 className="font-display text-xs font-semibold text-parchment-300 uppercase tracking-wider mb-2">Login Ports</h3>
            <ul className="text-parchment-500 text-xs space-y-1">
              <li><strong className="text-parchment-300">5998</strong> — Titanium clients</li>
              <li><strong className="text-parchment-300">5999</strong> — SoD+ clients (most common)</li>
              <li><strong className="text-parchment-300">15900</strong> — Larion clients</li>
            </ul>
          </div>
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e16]/60 p-4">
            <h3 className="font-display text-xs font-semibold text-parchment-300 uppercase tracking-wider mb-2">Monitoring</h3>
            <ul className="text-parchment-500 text-xs space-y-1">
              <li>Health checks every <strong className="text-parchment-300">15 seconds</strong></li>
              <li>Prometheus metrics at <strong className="text-parchment-300">/api/metrics</strong></li>
              <li><strong className="text-parchment-300">Open source</strong> infrastructure</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Need help */}
      <div className="rounded-lg border border-frost-400/10 bg-gradient-to-b from-[#171d2d]/90 to-[#131825]/95 p-6 text-center">
        <h2 className="font-display text-base font-semibold text-parchment-100 mb-2">Need Help?</h2>
        <p className="text-parchment-400 text-sm mb-4">
          Join the EQEmulator community Discord for support and discussion.
        </p>
        <a
          href="https://discord.gg/6T4n3DdPVB"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded bg-[#5865F2] px-6 py-2.5 text-xs font-display font-medium tracking-wide uppercase text-white hover:bg-[#4752C4] transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
          EQEmulator Discord
        </a>
      </div>

      <div className="mt-8 text-center">
        <Link
          href="/"
          className="hover-frost inline-flex items-center text-parchment-500 text-sm"
        >
          &larr; Back to Home
        </Link>
      </div>
      </>)}
    </div>
  );
}
