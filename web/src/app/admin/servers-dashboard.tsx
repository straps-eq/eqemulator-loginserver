"use client";

import { useEffect, useState } from "react";
import { Server, Save, RefreshCw } from "lucide-react";

interface ServerInfo {
  server_long_name: string;
  server_short_name: string;
  players_online: number;
  server_status: number;
  db_id?: number | null;
  display_tier?: string;
  tier_override?: boolean;
  is_trusted?: boolean;
}

interface TierConfig {
  tier_high_min_players: string;
  tier_medium_min_players: string;
}

export function ServersDashboard() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [config, setConfig] = useState<TierConfig>({ tier_high_min_players: "400", tier_medium_min_players: "100" });
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [message, setMessage] = useState("");

  async function fetchData() {
    try {
      const [serversRes, configRes] = await Promise.all([
        fetch("/api/servers"),
        fetch("/api/admin/server-tiers"),
      ]);
      if (serversRes.ok) {
        const data = await serversRes.json();
        setServers(Array.isArray(data) ? data : []);
      }
      if (configRes.ok) {
        const data = await configRes.json();
        if (data.config) setConfig(data.config);
        if (data.overrides) setOverrides(data.overrides);
      }
    } catch {}
  }

  useEffect(() => { fetchData(); }, []);

  async function saveConfig() {
    setSavingConfig(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/server-tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_config", config }),
      });
      const data = await res.json();
      setMessage(res.ok ? "Thresholds saved" : data.error || "Failed");
    } catch { setMessage("Error saving config"); }
    setSavingConfig(false);
  }

  async function saveTierOverride(dbId: number, tier: string) {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/server-tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_tier", db_id: dbId, tier: tier || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Tier updated for server ${dbId}`);
        fetchData();
      } else {
        setMessage(data.error || "Failed");
      }
    } catch { setMessage("Error saving tier"); }
    setSaving(false);
  }

  const sorted = [...servers].sort((a, b) => b.players_online - a.players_online);

  const tierColors: Record<string, string> = {
    high: "text-forest-400",
    medium: "text-amber-400",
    low: "text-parchment-600",
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded bg-frost-400/5 border border-frost-400/10 px-4 py-2 text-xs text-frost-300">
          {message}
        </div>
      )}

      {/* Population threshold config */}
      <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/60 p-5">
        <h3 className="text-xs font-display uppercase tracking-wider text-parchment-400 mb-4">
          Auto-Tier Population Thresholds
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[10px] font-display uppercase tracking-wider text-parchment-600 mb-1.5">
              High Population (min players)
            </label>
            <input
              type="number"
              value={config.tier_high_min_players}
              onChange={(e) => setConfig({ ...config, tier_high_min_players: e.target.value })}
              className="w-full rounded border border-frost-400/10 bg-[#0a0e17] px-3 py-2 text-sm text-parchment-200 focus:border-frost-400/30 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-display uppercase tracking-wider text-parchment-600 mb-1.5">
              Medium Population (min players)
            </label>
            <input
              type="number"
              value={config.tier_medium_min_players}
              onChange={(e) => setConfig({ ...config, tier_medium_min_players: e.target.value })}
              className="w-full rounded border border-frost-400/10 bg-[#0a0e17] px-3 py-2 text-sm text-parchment-200 focus:border-frost-400/30 focus:outline-none"
            />
          </div>
        </div>
        <p className="text-[10px] text-parchment-700 mb-3">
          Servers below Medium threshold default to Low Population. Manual overrides take priority over auto-classification.
        </p>
        <button
          onClick={saveConfig}
          disabled={savingConfig}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-display text-frost-300 border border-frost-400/15 hover:bg-frost-400/5 transition-colors disabled:opacity-50"
        >
          <Save className="h-3 w-3" />
          {savingConfig ? "Saving..." : "Save Thresholds"}
        </button>
      </div>

      {/* Server tier list */}
      <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/60 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-frost-400/8">
          <h3 className="text-xs font-display uppercase tracking-wider text-parchment-400">
            Server Population ({sorted.length})
          </h3>
          <button onClick={fetchData} className="text-parchment-600 hover:text-frost-400 transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Header */}
        <div className="grid grid-cols-[1fr_80px_90px_140px] gap-x-3 px-4 py-2 border-b border-frost-400/6 bg-[#0c1019]/60">
          <span className="text-[10px] text-parchment-700 uppercase tracking-wider font-display">Server</span>
          <span className="text-[10px] text-parchment-700 uppercase tracking-wider font-display text-right">Players</span>
          <span className="text-[10px] text-parchment-700 uppercase tracking-wider font-display text-center">Current</span>
          <span className="text-[10px] text-parchment-700 uppercase tracking-wider font-display text-center">Override</span>
        </div>

        {sorted.length === 0 ? (
          <div className="px-4 py-8 text-center text-parchment-700 text-sm">No servers connected</div>
        ) : (
          sorted.map((server, i) => {
            const tier = server.display_tier || "low";
            const dbId = server.db_id;
            const currentOverride = dbId ? (overrides[String(dbId)] || "") : "";

            return (
              <div
                key={`${server.server_short_name}-${i}`}
                className={`grid grid-cols-[1fr_80px_90px_140px] gap-x-3 px-4 py-2.5 items-center ${
                  i < sorted.length - 1 ? "border-b border-frost-400/5" : ""
                }`}
              >
                <div className="min-w-0">
                  <span className="text-sm text-parchment-200 truncate block">{server.server_long_name}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-display font-bold text-frost-300">{server.players_online}</span>
                </div>
                <div className="text-center">
                  <span className={`text-xs font-display font-semibold capitalize ${tierColors[tier] || "text-parchment-600"}`}>
                    {tier}
                  </span>
                  {server.tier_override && (
                    <span className="text-[8px] text-amber-400/60 block">manual</span>
                  )}
                </div>
                <div className="text-center">
                  {dbId ? (
                    <select
                      value={currentOverride}
                      onChange={(e) => saveTierOverride(dbId, e.target.value)}
                      disabled={saving}
                      className="w-full rounded border border-frost-400/10 bg-[#0a0e17] px-2 py-1 text-xs text-parchment-300 focus:border-frost-400/30 focus:outline-none"
                    >
                      <option value="">Auto</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  ) : (
                    <span className="text-[10px] text-parchment-700">No profile</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
