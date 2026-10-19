"use client";

import { useCallback, useEffect, useState } from "react";
import { Radar, RefreshCw } from "lucide-react";
import { CLIENT_LABELS, CLIENT_ORDER, type ClientId } from "@/lib/client-probe/labels";

interface ProbeRow {
  world_server_id: number;
  client: string;
  status: string;
  detail: string;
  last_checked: string;
  last_supported_at: string | null;
}

interface ProbeStatusData {
  enabled: boolean;
  reason: string;
  intervalHours: number;
  clients: string[];
  account: string;
  running: boolean;
  lastRun: { trigger: string; started_at: string; finished_at: string | null; error: string | null } | null;
  lastResultAt: string | null;
  optedOut: number[];
  worlds: Array<{ id: number; long_name: string; short_name: string }>;
  results: ProbeRow[];
}

const statusStyle: Record<string, string> = {
  supported: "text-forest-400",
  blocked: "text-amber-400",
  unsupported: "text-parchment-600",
  error: "text-red-400/80",
  unreachable: "text-red-400/60",
};

const statusMark: Record<string, string> = {
  supported: "yes",
  blocked: "blocked",
  unsupported: "no",
  error: "error",
  unreachable: "down",
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/system", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/** Admin view of the client probe: state, per-world results, "Probe now". */
export function ClientProbePanel() {
  const [data, setData] = useState<ProbeStatusData | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await post({ action: "client_probe_status" });
    if (r.ok) setData(r.data as ProbeStatusData);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a cycle runs.
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [data?.running, load]);

  const probeNow = async (worldServerId?: number) => {
    setMessage(null);
    const r = await post({ action: "client_probe_run", ...(worldServerId ? { world_server_id: worldServerId } : {}) });
    setMessage(r.ok ? "Probe started" : (r.data as { error?: string }).error || "Could not start the probe");
    void load();
  };

  const toggleOptOut = async (worldServerId: number, optOut: boolean) => {
    const r = await post({ action: "client_probe_optout", world_server_id: worldServerId, opt_out: optOut });
    if (!r.ok) setMessage((r.data as { error?: string }).error || "Could not save");
    void load();
  };

  if (!data) return null;

  const byWorld = new Map<number, Map<string, ProbeRow>>();
  for (const r of data.results) {
    const id = Number(r.world_server_id);
    if (!byWorld.has(id)) byWorld.set(id, new Map());
    byWorld.get(id)!.set(r.client, r);
  }
  const worldName = (id: number) => data.worlds.find((w) => Number(w.id) === id)?.long_name || `World #${id}`;
  const worldIds = Array.from(byWorld.keys()).sort((a, b) => worldName(a).localeCompare(worldName(b)));

  return (
    <div className="rounded-lg border border-frost-400/8 bg-[#202842]/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-display uppercase tracking-wider text-parchment-400 flex items-center gap-2">
          <Radar className="h-3.5 w-3.5" /> Client Probe
        </h3>
        <button
          onClick={() => probeNow()}
          disabled={data.running}
          className="flex items-center gap-1.5 rounded border border-frost-400/10 px-3 py-1.5 text-xs text-parchment-500 hover:text-frost-400 hover:border-frost-400/25 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${data.running ? "animate-spin" : ""}`} />
          {data.running ? "Probing..." : "Probe now"}
        </button>
      </div>
      <p className="text-xs text-parchment-600 mb-3">
        {data.enabled ? "Scheduled" : "Not scheduled"} ({data.reason}) · every {data.intervalHours}h · account{" "}
        <code className="text-parchment-500">{data.account}</code>
        {data.lastResultAt && <> · last result {new Date(data.lastResultAt).toLocaleString()}</>}
        {data.lastRun?.error && <span className="text-red-400/80"> · last run failed: {data.lastRun.error}</span>}
      </p>
      {message && <p className="text-xs text-frost-400/80 mb-3">{message}</p>}

      {worldIds.length === 0 ? (
        <p className="text-xs text-parchment-600">No results yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-parchment-600 text-left">
                <th className="py-1 pr-3 font-normal">World</th>
                {CLIENT_ORDER.map((c) => (
                  <th key={c} className="py-1 px-2 font-normal text-center">{CLIENT_LABELS[c]}</th>
                ))}
                <th className="py-1 pl-2" />
              </tr>
            </thead>
            <tbody>
              {worldIds.map((id) => {
                const rows = byWorld.get(id)!;
                const optedOut = data.optedOut.indexOf(id) !== -1;
                return (
                  <tr key={id} className="border-t border-frost-400/5">
                    <td className="py-1.5 pr-3 text-parchment-300 truncate max-w-[14rem]">{worldName(id)}</td>
                    {CLIENT_ORDER.map((c: ClientId) => {
                      const r = rows.get(c);
                      return (
                        <td
                          key={c}
                          className={`py-1.5 px-2 text-center ${r ? statusStyle[r.status] || "" : "text-parchment-700"}`}
                          title={r ? `${r.status}: ${r.detail} (${new Date(r.last_checked).toLocaleString()})` : "not checked"}
                        >
                          {r ? statusMark[r.status] || r.status : "-"}
                        </td>
                      );
                    })}
                    <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                      <button onClick={() => probeNow(id)} disabled={data.running} className="text-frost-400/70 hover:text-frost-300 disabled:opacity-50 mr-3">
                        probe
                      </button>
                      <button onClick={() => toggleOptOut(id, !optedOut)} className="text-parchment-600 hover:text-parchment-300">
                        {optedOut ? "opted out (undo)" : "opt out"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
