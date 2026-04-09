"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, AlertTriangle, CheckCircle2, Info } from "lucide-react";

interface LogEvent {
  ts: string;
  level: "info" | "warn" | "error";
  source: string;
  category: string;
  message: string;
}

interface LogSummary {
  total: number;
  errors: number;
  warnings: number;
}

interface LogsResponse {
  events: LogEvent[];
  summary: LogSummary;
  buffer_size: number;
  error?: string;
}

const LEVEL_OPTIONS = ["all", "error", "warn", "info"] as const;
const SOURCE_OPTIONS = ["all", "loginserver", "web", "agent"] as const;

export function LogsDashboard() {
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (levelFilter !== "all") params.set("level", levelFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      params.set("limit", "200");
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/admin/logs${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const result = await res.json();
      if (result.error) {
        setError(result.error);
      } else {
        setData(result);
        setError(null);
      }
    } catch {
      setError("Failed to fetch logs");
    }
    setLoading(false);
  }, [levelFilter, sourceFilter]);

  useEffect(() => {
    fetchLogs();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 10_000);
    return () => clearInterval(interval);
  }, [fetchLogs, autoRefresh]);

  const levelIcon = (level: string) => {
    if (level === "error") return <AlertTriangle className="h-3 w-3 text-red-400 flex-shrink-0" />;
    if (level === "warn") return <AlertTriangle className="h-3 w-3 text-amber-400 flex-shrink-0" />;
    return <CheckCircle2 className="h-3 w-3 text-emerald-400/60 flex-shrink-0" />;
  };

  const levelDot = (level: string) => {
    if (level === "error") return "bg-red-400";
    if (level === "warn") return "bg-amber-400";
    return "bg-emerald-400/50";
  };

  const sourceBadge = (source: string) => {
    const colors: Record<string, string> = {
      loginserver: "bg-blue-400/10 text-blue-400",
      web: "bg-purple-400/10 text-purple-400",
      agent: "bg-amber-400/10 text-amber-400",
    };
    return colors[source] || "bg-frost-400/10 text-frost-400";
  };

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return ts;
    }
  };

  const formatDate = (ts: string) => {
    try {
      const d = new Date(ts);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return "Today";
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <RefreshCw className="h-5 w-5 animate-spin text-frost-400/50" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary + Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {data?.summary && (
            <>
              <div className="flex items-center gap-1.5 text-xs">
                <div className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-red-400 font-mono">{data.summary.errors}</span>
                <span className="text-parchment-600">errors</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <div className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-amber-400 font-mono">{data.summary.warnings}</span>
                <span className="text-parchment-600">warnings</span>
              </div>
              <span className="text-[10px] text-parchment-700">last hour</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Filters */}
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="rounded border border-frost-400/10 bg-[#0a0e17] px-2 py-1 text-xs text-parchment-400 focus:outline-none focus:border-frost-400/30"
          >
            {LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l === "all" ? "All Levels" : l.charAt(0).toUpperCase() + l.slice(1)}
              </option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded border border-frost-400/10 bg-[#0a0e17] px-2 py-1 text-xs text-parchment-400 focus:outline-none focus:border-frost-400/30"
          >
            {SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All Sources" : s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition-colors ${
              autoRefresh
                ? "border-emerald-400/20 text-emerald-400/80 hover:text-emerald-300"
                : "border-frost-400/10 text-parchment-600 hover:text-parchment-400"
            }`}
          >
            <RefreshCw className={`h-3 w-3 ${autoRefresh ? "animate-spin" : ""}`} style={autoRefresh ? { animationDuration: "3s" } : {}} />
            {autoRefresh ? "Live" : "Paused"}
          </button>
          {/* Manual refresh */}
          <button
            onClick={fetchLogs}
            className="rounded border border-frost-400/10 p-1.5 text-parchment-600 hover:text-frost-400 hover:border-frost-400/25 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-amber-300">{error}</p>
            <p className="text-xs text-parchment-600 mt-1">
              Make sure the upgrade agent is running.
            </p>
          </div>
        </div>
      )}

      {/* Event list */}
      <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 overflow-hidden">
        <div className="px-5 py-3 border-b border-frost-400/8 flex items-center justify-between">
          <h3 className="text-xs font-display uppercase tracking-wider text-parchment-400">
            Recent Events
          </h3>
          {data && (
            <span className="text-[10px] text-parchment-700">
              {data.events.length} shown / {data.buffer_size} buffered
            </span>
          )}
        </div>

        {data && data.events.length > 0 ? (
          <div className="divide-y divide-frost-400/5 max-h-[600px] overflow-y-auto">
            {data.events.map((event, i) => {
              const showDate = i === 0 || formatDate(event.ts) !== formatDate(data.events[i - 1]?.ts);
              return (
                <div key={`${event.ts}-${i}`}>
                  {showDate && (
                    <div className="px-5 py-1.5 bg-[#060a12]/80 border-b border-frost-400/5">
                      <span className="text-[10px] font-display uppercase tracking-wider text-parchment-600">
                        {formatDate(event.ts)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-start gap-3 px-5 py-2 hover:bg-frost-400/[0.02] transition-colors">
                    <div className="flex items-center gap-2 pt-0.5 flex-shrink-0">
                      <div className={`h-1.5 w-1.5 rounded-full ${levelDot(event.level)}`} />
                    </div>
                    <span className="text-[10px] text-parchment-700 font-mono w-16 flex-shrink-0 pt-0.5">
                      {formatTime(event.ts)}
                    </span>
                    <span
                      className={`text-[10px] font-display uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${sourceBadge(event.source)}`}
                    >
                      {event.source}
                    </span>
                    <span className="text-xs text-parchment-400 break-all">
                      {event.message}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-12 text-center">
            <Info className="h-5 w-5 text-parchment-700 mx-auto mb-2" />
            <p className="text-sm text-parchment-600">
              {error ? "Unable to load events" : "No events yet — logs will appear as activity occurs"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
