"use client";

import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw,
  ArrowUpCircle,
  CheckCircle2,
  AlertTriangle,
  Download,
  Power,
  Database,
  Globe,
  Server,
  Shield,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface ServiceInfo {
  status: string;
  image?: string;
  started_at?: string;
}

interface SystemData {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseNotes: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  services: Record<string, ServiceInfo> | null;
  agentConnected: boolean;
}

export function SystemDashboard() {
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [upgradeProgress, setUpgradeProgress] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/system");
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    // Poll every 10s while on this tab
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const stepLabels: Record<string, string> = {
    starting: "Starting upgrade...",
    backup: "Backing up database...",
    pull: "Pulling new images...",
    migrate: "Running migrations...",
    restart: "Restarting services...",
    nginx: "Restarting nginx...",
    done: "Upgrade complete!",
    failed: "Upgrade failed",
  };

  const pollUpgradeStatus = () => {
    let retries = 0;
    const poll = setInterval(async () => {
      retries++;
      try {
        const r = await fetch("/api/admin/system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "upgrade_status" }),
        });
        if (!r.ok) throw new Error("not ready");
        const status = await r.json();

        if (status.step === "done" && !status.running) {
          clearInterval(poll);
          setUpgradeProgress(null);
          setActionLoading(null);
          const res = status.result;
          setActionResult({
            text: res
              ? `Upgraded successfully! Backup: ${res.backup} (${Math.round(res.backup_size / 1024)}KB), ${res.migrations} migrations applied.`
              : "Upgrade completed successfully.",
            type: "success",
          });
          fetchData();
        } else if (status.step === "failed" && !status.running) {
          clearInterval(poll);
          setUpgradeProgress(null);
          setActionLoading(null);
          setActionResult({ text: `Upgrade failed: ${status.error || "unknown error"}`, type: "error" });
        } else if (status.running) {
          setUpgradeProgress(stepLabels[status.step] || `Step: ${status.step}...`);
        }
      } catch {
        // Web is probably restarting — keep polling
        if (retries > 120) {
          clearInterval(poll);
          setUpgradeProgress(null);
          setActionLoading(null);
          setActionResult({ text: "Lost connection during upgrade. Check server logs and refresh.", type: "error" });
        } else {
          setUpgradeProgress(`Waiting for services to come back... (${retries}s)`);
        }
      }
    }, 2000);
  };

  const doAction = async (action: string, extra?: Record<string, unknown>) => {
    setActionLoading(action);
    setActionResult(null);

    if (action === "upgrade") {
      setUpgradeProgress("Starting upgrade...");
      try {
        await fetch("/api/admin/system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "upgrade" }),
        });
      } catch {
        // Expected — web may restart before response arrives
      }
      // Poll upgrade status regardless of whether the POST succeeded
      pollUpgradeStatus();
      return;
    }

    try {
      const res = await fetch("/api/admin/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const result = await res.json();

      if (result.error) {
        setActionResult({ text: result.error, type: "error" });
      } else {
        setActionResult({ text: result.message || "Done", type: "success" });
        fetchData();
      }
    } catch {
      setActionResult({ text: "Request failed — is the upgrade agent running?", type: "error" });
    }
    setActionLoading(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <RefreshCw className="h-5 w-5 animate-spin text-frost-400/50" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-6 text-center">
        <p className="text-sm text-red-400">Failed to load system data</p>
      </div>
    );
  }

  const serviceIcons: Record<string, typeof Server> = {
    web: Globe,
    loginserver: Shield,
    mariadb: Database,
    redis: Server,
    nginx: Server,
  };

  const statusColor = (status: string) => {
    if (status === "running") return "text-emerald-400";
    if (status === "restarting") return "text-amber-400";
    return "text-red-400";
  };

  const statusDot = (status: string) => {
    if (status === "running") return "bg-emerald-400";
    if (status === "restarting") return "bg-amber-400 animate-pulse";
    return "bg-red-400";
  };

  return (
    <div className="space-y-8">
      {/* Version & Update */}
      <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xs font-display uppercase tracking-wider text-parchment-400 mb-3">
              Version
            </h3>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-frost-400/10 px-3 py-1 text-sm font-mono text-frost-300">
                v{data.currentVersion}
              </span>
              {data.updateAvailable ? (
                <span className="flex items-center gap-1.5 rounded-full bg-amber-400/10 px-3 py-1 text-sm text-amber-400">
                  <ArrowUpCircle className="h-3.5 w-3.5" />
                  v{data.latestVersion} available
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm text-emerald-400/70">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Up to date
                </span>
              )}
            </div>
            {data.publishedAt && data.updateAvailable && (
              <p className="mt-2 text-xs text-parchment-600">
                Released {new Date(data.publishedAt).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data.releaseUrl && data.updateAvailable && (
              <a
                href={data.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded border border-frost-400/10 px-3 py-1.5 text-xs text-parchment-500 hover:text-frost-400 hover:border-frost-400/25 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                GitHub
              </a>
            )}
            <button
              onClick={() => fetchData()}
              className="rounded border border-frost-400/10 p-2 text-parchment-500 hover:text-frost-400 hover:border-frost-400/25 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Release Notes */}
        {data.releaseNotes && data.updateAvailable && (
          <div className="mt-4 border-t border-frost-400/8 pt-4">
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="flex items-center gap-1.5 text-xs font-display uppercase tracking-wider text-parchment-500 hover:text-parchment-300 transition-colors"
            >
              {showNotes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Release Notes
            </button>
            {showNotes && (
              <pre className="mt-3 max-h-64 overflow-y-auto rounded bg-[#060a12] p-4 text-xs text-parchment-400 whitespace-pre-wrap font-mono leading-relaxed">
                {data.releaseNotes}
              </pre>
            )}
          </div>
        )}

        {/* Upgrade Button */}
        {data.updateAvailable && (
          <div className="mt-4 border-t border-frost-400/8 pt-4">
            {upgradeProgress ? (
              <div className="flex items-center gap-3 rounded bg-frost-400/5 p-3">
                <RefreshCw className="h-4 w-4 animate-spin text-frost-400" />
                <span className="text-sm text-frost-300">{upgradeProgress}</span>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (confirm(`Upgrade to v${data.latestVersion}?\n\nThis will:\n1. Back up the database\n2. Pull new Docker images\n3. Run migrations\n4. Restart web + loginserver\n\nThe site will be briefly unavailable.`)) {
                    doAction("upgrade");
                  }
                }}
                disabled={!!actionLoading || !data.agentConnected}
                className="flex items-center gap-2 rounded bg-amber-500/20 border border-amber-500/30 px-4 py-2 text-sm font-display text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="h-4 w-4" />
                Upgrade to v{data.latestVersion}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Agent Status */}
      {!data.agentConnected && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-amber-300 font-medium">Upgrade agent not connected</p>
            <p className="text-xs text-parchment-500 mt-1">
              The upgrade agent sidecar is required for upgrades and service restarts.
              Make sure <code className="text-parchment-400">eqemu-upgrade-agent</code> is running.
            </p>
          </div>
        </div>
      )}

      {/* Service Health */}
      <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 overflow-hidden">
        <div className="px-5 py-3 border-b border-frost-400/8">
          <h3 className="text-xs font-display uppercase tracking-wider text-parchment-400">
            Service Health
          </h3>
        </div>
        {data.services ? (
          <div className="divide-y divide-frost-400/5">
            {Object.entries(data.services).map(([name, svc]) => {
              const Icon = serviceIcons[name] || Server;
              return (
                <div key={name} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-parchment-600" />
                    <div>
                      <span className="text-sm text-parchment-300 capitalize">{name}</span>
                      {svc.image && (
                        <p className="text-[10px] text-parchment-700 font-mono truncate max-w-xs">
                          {svc.image}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <div className={`h-2 w-2 rounded-full ${statusDot(svc.status)}`} />
                      <span className={`text-xs capitalize ${statusColor(svc.status)}`}>
                        {svc.status}
                      </span>
                    </div>
                    {data.agentConnected && (
                      <button
                        onClick={() => {
                          if (confirm(`Restart ${name}?`)) {
                            doAction("restart", { service: name });
                          }
                        }}
                        disabled={!!actionLoading}
                        className="rounded border border-frost-400/10 p-1.5 text-parchment-600 hover:text-frost-400 hover:border-frost-400/25 transition-colors disabled:opacity-50"
                        title={`Restart ${name}`}
                      >
                        <Power className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-parchment-600">
            Service status unavailable (upgrade agent not connected)
          </div>
        )}
      </div>

      {/* Quick Actions */}
      {data.agentConnected && (
        <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 p-5">
          <h3 className="text-xs font-display uppercase tracking-wider text-parchment-400 mb-3">
            Quick Actions
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => doAction("backup")}
              disabled={!!actionLoading}
              className="flex items-center gap-1.5 rounded border border-frost-400/10 px-3 py-1.5 text-xs text-parchment-500 hover:text-frost-400 hover:border-frost-400/25 transition-colors disabled:opacity-50"
            >
              <Database className="h-3 w-3" />
              Backup Database
            </button>
            <button
              onClick={() => doAction("pull")}
              disabled={!!actionLoading}
              className="flex items-center gap-1.5 rounded border border-frost-400/10 px-3 py-1.5 text-xs text-parchment-500 hover:text-frost-400 hover:border-frost-400/25 transition-colors disabled:opacity-50"
            >
              <Download className="h-3 w-3" />
              Pull Latest Images
            </button>
            <button
              onClick={() => doAction("migrate")}
              disabled={!!actionLoading}
              className="flex items-center gap-1.5 rounded border border-frost-400/10 px-3 py-1.5 text-xs text-parchment-500 hover:text-frost-400 hover:border-frost-400/25 transition-colors disabled:opacity-50"
            >
              <ArrowUpCircle className="h-3 w-3" />
              Run Migrations
            </button>
          </div>
        </div>
      )}

      {/* Action Result */}
      {actionResult && (
        <div
          className={`rounded-lg border p-4 ${
            actionResult.type === "success"
              ? "border-emerald-400/20 bg-emerald-400/5"
              : "border-red-400/20 bg-red-400/5"
          }`}
        >
          <div className="flex items-start gap-2">
            {actionResult.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
            )}
            <p className={`text-sm ${actionResult.type === "success" ? "text-emerald-300" : "text-red-300"}`}>
              {actionResult.text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
