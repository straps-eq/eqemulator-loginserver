"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  ChevronDown,
  ChevronUp,
  Download,
  Globe,
  Power,
  RefreshCw,
  Save,
} from "lucide-react";

export interface FederationNodeRow {
  id: number;
  name: string;
  endpointUrl: string;
  nodeTier: string;
  status: string;
  isSelf: boolean;
  isMaster: boolean;
  softwareVersion: string | null;
  federationProtocol: number | null;
  lastHeartbeat: string | null;
  lastStatusAt: string | null;
  updater: {
    channel: string | null;
    auto: boolean | null;
    lastResult: string | null;
    lastCheckAt: string | null;
    lastError: string | null;
    pendingVersion: string | null;
    previousVersion: string | null;
  } | null;
  desiredVersion: string | null;
  behindDesired: boolean;
}

export interface FederationOverview {
  isMaster: boolean;
  desired: {
    desired_version_stable: string | null;
    desired_version_canary: string | null;
    source: "self" | "master";
    updated_at: string | null;
  };
  ownDesired: { stable: string | null; canary: string | null; updatedAt: string | null };
  masterDesired: { stable: string | null; canary: string | null; updatedAt: string | null } | null;
  nodes: FederationNodeRow[];
}

type Notify = (r: { text: string; type: "success" | "error" } | null) => void;

const stepLabels: Record<string, string> = {
  starting: "Starting...",
  backup: "Backing up database...",
  pull: "Pulling new images...",
  config_sync: "Syncing config files...",
  migrate: "Running migrations...",
  restart: "Restarting services...",
  health_check: "Verifying health...",
  nginx: "Restarting nginx...",
  tag_previous: "Tagging :previous images...",
  rollback: "Rolling back...",
  done: "Complete",
  failed: "Failed",
};

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) return "just now";
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function resultClass(r: string | null): string {
  switch (r) {
    case "ok":
    case "up_to_date":
      return "bg-emerald-400/10 text-emerald-400";
    case "failed":
    case "rolled_back":
      return "bg-red-400/10 text-red-400";
    case "needs_operator":
      return "bg-amber-400/10 text-amber-400";
    default:
      return "bg-frost-400/5 text-parchment-400";
  }
}

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/admin/system", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: { error?: string; [k: string]: unknown } = {};
  try { data = await r.json(); } catch {}
  return { ok: r.ok && !data.error, data };
}

function DesiredVersionControl({
  channel,
  value,
  placeholder,
  disabled,
  onSaved,
  notify,
}: {
  channel: "stable" | "canary";
  value: string | null;
  placeholder: string;
  disabled: boolean;
  onSaved: () => void;
  notify: Notify;
}) {
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(value || ""); }, [value]);
  const dirty = (value || "") !== draft.trim();

  return (
    <div className="flex items-center gap-2">
      <label className="w-14 text-[11px] font-display uppercase tracking-wider text-parchment-400">{channel}</label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || saving}
        className="w-32 rounded border border-frost-400/10 bg-[#060a12] px-2 py-1 text-xs font-mono text-parchment-300 placeholder:text-parchment-500 focus:border-frost-400/30 focus:outline-none disabled:opacity-50"
      />
      <button
        onClick={async () => {
          setSaving(true);
          notify(null);
          const r = await post({ action: "set_desired_version", channel, version: draft.trim() });
          setSaving(false);
          if (r.ok) {
            notify({ text: draft.trim() ? `Desired ${channel} version set to ${draft.trim()}` : `Desired ${channel} version cleared`, type: "success" });
            onSaved();
          } else {
            notify({ text: r.data.error || "Failed to save", type: "error" });
          }
        }}
        disabled={disabled || saving || !dirty}
        className="flex items-center gap-1 rounded border border-frost-400/10 px-2 py-1 text-xs text-parchment-400 hover:text-frost-400 hover:border-frost-400/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Save
      </button>
    </div>
  );
}

export function FederationNodesPanel({
  federation,
  busy,
  notify,
  refresh,
}: {
  federation: FederationOverview;
  busy: boolean;
  notify: Notify;
  refresh: () => void;
}) {
  const [legacyOpen, setLegacyOpen] = useState<number | null>(null);
  const [remoteNodeId, setRemoteNodeId] = useState<number | null>(null);
  const [remoteProgress, setRemoteProgress] = useState<string | null>(null);
  const [notifying, setNotifying] = useState<number | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pollRefs = useRef<any[]>([]);
  useEffect(() => () => { pollRefs.current.forEach((id) => clearInterval(id)); }, []);

  const { isMaster, desired, ownDesired, masterDesired, nodes } = federation;

  const pollRemote = (node: FederationNodeRow, label: string) => {
    let retries = 0;
    const poll = setInterval(async () => {
      retries++;
      const stop = (r: { text: string; type: "success" | "error" } | null) => {
        clearInterval(poll);
        pollRefs.current = pollRefs.current.filter((id) => id !== poll);
        setRemoteNodeId(null);
        setRemoteProgress(null);
        if (r) notify(r);
      };
      try {
        const r = await fetch("/api/admin/system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remote_upgrade_status", node_id: node.id }),
        });
        const s = await r.json();
        if (s.step === "done" && !s.running) {
          stop({ text: `${node.name}: ${label} complete`, type: "success" });
          refresh();
        } else if (s.step === "failed" && !s.running) {
          stop({ text: `${node.name}: ${label} failed: ${s.error || "unknown"}`, type: "error" });
        } else if (s.running) {
          setRemoteProgress(stepLabels[s.step] || s.step);
        } else if (s.error) {
          stop({ text: `${node.name}: ${s.error}`, type: "error" });
        }
      } catch {
        if (retries > 60) stop({ text: `Lost connection to ${node.name}`, type: "error" });
      }
    }, 3000);
    pollRefs.current.push(poll);
  };

  const legacyCommand = async (node: FederationNodeRow, kind: "restart" | "force_pull" | "upgrade") => {
    notify(null);
    if (kind === "restart") {
      if (!confirm(`LEGACY: restart loginserver on ${node.name}?\n\nOnly works if that node's operator enabled allow_remote_commands.`)) return;
      const r = await post({ action: "remote_restart", node_id: node.id, service: "loginserver" });
      notify(r.ok ? { text: `${node.name} loginserver restarted`, type: "success" } : { text: `${node.name}: ${r.data.error || "restart failed"}`, type: "error" });
      return;
    }
    const label = kind === "upgrade" ? "image upgrade" : "force pull & restart";
    if (!confirm(`LEGACY: ${label} on ${node.name}?\n\nThis executes on the peer through its upgrade agent (pulls :latest). Prefer "Notify to check" and let the node's updater apply the desired version.\n\nOnly works if that node's operator enabled allow_remote_commands.`)) return;
    setRemoteNodeId(node.id);
    setRemoteProgress("Starting...");
    const r = await post(kind === "upgrade"
      ? { action: "remote_upgrade", node_id: node.id }
      : { action: "remote_force_pull_restart", node_id: node.id, mode: "direct" });
    if (!r.ok && r.data.error) {
      setRemoteNodeId(null);
      setRemoteProgress(null);
      notify({ text: `${node.name}: ${r.data.error}`, type: "error" });
      return;
    }
    pollRemote(node, label);
  };

  const sourceNote = isMaster
    ? "Published to every node in its heartbeat response. Nodes' updaters decide whether and when to apply it."
    : desired.source === "master"
      ? "Following the master. Set a value here to override it for this node only."
      : "Local override for this node's updater (clear both to follow the master again).";

  return (
    <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 overflow-hidden">
      <div className="px-5 py-3 border-b border-frost-400/8">
        <h3 className="text-xs font-display uppercase tracking-wider text-parchment-400">
          Federation Nodes
        </h3>
      </div>

      {/* Desired versions */}
      <div className="px-5 py-4 border-b border-frost-400/8 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-display uppercase tracking-wider text-amber-400">
            Desired version {isMaster ? "(published)" : `(source: ${desired.source})`}
          </p>
          {desired.updated_at && (
            <span className="text-[11px] text-parchment-500">updated {relTime(desired.updated_at)}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <DesiredVersionControl
            channel="stable"
            value={ownDesired.stable}
            placeholder={masterDesired?.stable ? `master: ${masterDesired.stable}` : "e.g. 1.7.0"}
            disabled={busy}
            onSaved={refresh}
            notify={notify}
          />
          <DesiredVersionControl
            channel="canary"
            value={ownDesired.canary}
            placeholder={masterDesired?.canary ? `master: ${masterDesired.canary}` : "e.g. 1.7.1"}
            disabled={busy}
            onSaved={refresh}
            notify={notify}
          />
        </div>
        <p className="text-xs text-parchment-400">{sourceNote}</p>
      </div>

      {/* Nodes table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-frost-400/8 text-[11px] font-display uppercase tracking-wider text-parchment-400">
              <th className="px-5 py-2 font-normal">Node</th>
              <th className="px-3 py-2 font-normal">Tier</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 font-normal">Version</th>
              <th className="px-3 py-2 font-normal">Proto</th>
              <th className="px-3 py-2 font-normal">Heartbeat</th>
              <th className="px-3 py-2 font-normal">Updater</th>
              {isMaster && <th className="px-5 py-2 font-normal text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-frost-400/5">
            {nodes.map((node) => {
              const u = node.updater;
              const isRemoteBusy = remoteNodeId === node.id;
              return [
                <tr key={node.id} className="align-top">
                  <td className="px-5 py-3">
                    <div className="flex items-start gap-2">
                      <Globe className="h-4 w-4 mt-0.5 text-parchment-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm text-parchment-300">{node.name}</span>
                          {node.isSelf && <span className="rounded bg-frost-400/10 px-1.5 py-0.5 text-[11px] text-frost-300">this node</span>}
                          {node.isMaster && <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-amber-400">master</span>}
                        </div>
                        <span className="block text-[11px] text-parchment-500 font-mono truncate max-w-[16rem]">{node.endpointUrl}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-parchment-400 capitalize">{node.nodeTier}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className={`h-2 w-2 rounded-full ${node.status === "active" ? "bg-emerald-400" : "bg-parchment-600"}`} />
                      <span className={`capitalize ${node.status === "active" ? "text-emerald-400" : "text-parchment-400"}`}>{node.status}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {node.softwareVersion ? (
                        <span className={`font-mono px-1.5 py-0.5 rounded text-[11px] ${node.behindDesired ? "bg-amber-400/10 text-amber-400" : "bg-emerald-400/10 text-emerald-400"}`}>
                          v{node.softwareVersion}
                        </span>
                      ) : (
                        <span className="text-parchment-500">unknown</span>
                      )}
                      {node.behindDesired && (
                        <span
                          className="flex items-center gap-1 rounded bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-amber-400"
                          title={`Desired ${u?.channel || "stable"} version is ${node.desiredVersion}`}
                        >
                          <AlertTriangle className="h-2.5 w-2.5" />
                          behind {node.desiredVersion}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-parchment-400">{node.federationProtocol ?? "—"}</td>
                  <td className="px-3 py-3 text-parchment-400 whitespace-nowrap" title={node.lastHeartbeat || ""}>
                    {node.isSelf ? "—" : relTime(node.lastHeartbeat)}
                  </td>
                  <td className="px-3 py-3">
                    {u ? (
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] ${resultClass(u.lastResult)}`} title={u.lastError || ""}>
                            {u.lastResult || "no result"}
                          </span>
                          {u.channel && <span className="text-[11px] text-parchment-400">{u.channel}{u.auto === false ? " · manual" : u.auto ? " · auto" : ""}</span>}
                        </div>
                        <div className="text-[11px] text-parchment-400">checked {relTime(u.lastCheckAt)}</div>
                        {u.pendingVersion && <div className="text-[11px] text-frost-300">pending v{u.pendingVersion}</div>}
                      </div>
                    ) : (
                      <span className="text-parchment-500">not reported</span>
                    )}
                  </td>
                  {isMaster && (
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {!node.isSelf && (
                        isRemoteBusy ? (
                          <span className="inline-flex items-center gap-1.5 text-frost-300">
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            {remoteProgress || "Working..."}
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={async () => {
                                setNotifying(node.id);
                                notify(null);
                                const r = await post({ action: "notify_check", node_id: node.id });
                                setNotifying(null);
                                notify(r.ok
                                  ? { text: `${node.name} notified to check for updates (its updater decides what to do)`, type: "success" }
                                  : { text: r.data.error || `Failed to notify ${node.name}`, type: "error" });
                              }}
                              disabled={busy || notifying === node.id || !!remoteNodeId}
                              className="flex items-center gap-1.5 rounded border border-frost-400/10 px-2.5 py-1.5 text-xs text-parchment-400 hover:text-frost-400 hover:border-frost-400/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Ask this node's updater to check for updates now. Executes nothing on the node."
                            >
                              {notifying === node.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <BellRing className="h-3 w-3" />}
                              Notify to check
                            </button>
                            <button
                              onClick={() => setLegacyOpen(legacyOpen === node.id ? null : node.id)}
                              className="flex items-center gap-1 text-[11px] text-parchment-400 hover:text-parchment-400 transition-colors"
                              title="Advanced / legacy remote commands"
                            >
                              {legacyOpen === node.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              Legacy
                            </button>
                          </div>
                        )
                      )}
                    </td>
                  )}
                </tr>,
                isMaster && legacyOpen === node.id && !node.isSelf ? (
                  <tr key={`${node.id}-legacy`}>
                    <td colSpan={8} className="px-5 pb-4">
                      <div className="rounded border border-amber-400/20 bg-amber-400/5 p-3 space-y-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-parchment-400">
                            <span className="text-amber-300">Advanced / legacy.</span> These commands execute on {node.name} through its
                            upgrade agent and pull <code className="text-parchment-300">:latest</code> images without touching its compose or
                            nginx config. Kept only for peers still on 1.5.x/1.6.x. Peers on 1.7.0+ refuse them unless their operator set
                            <code className="text-parchment-300"> allow_remote_commands = true</code>. Every command is audit logged on both sides.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {node.softwareVersion && (
                            <button
                              onClick={async () => {
                                if (!confirm(`Reset the recorded version (${node.softwareVersion}) of ${node.name}?

Only do this if its operator rolled it back below 1.7.0. Until it reports a version again, its unbound (legacy) signatures are accepted.`)) return;
                                const r = await post({ action: "reset_node_version", node_id: node.id });
                                notify(r.ok
                                  ? { text: `Recorded version of ${node.name} cleared`, type: "success" }
                                  : { text: r.data.error || `Failed to reset ${node.name}`, type: "error" });
                              }}
                              disabled={busy || !!remoteNodeId}
                              className="flex items-center gap-1.5 rounded border border-frost-400/10 px-2.5 py-1.5 text-xs text-parchment-400 hover:text-amber-400 hover:border-amber-400/25 transition-colors disabled:opacity-50"
                              title="Clear the version recorded for this node, after its operator rolled it back below 1.7.0"
                            >
                              <RefreshCw className="h-3 w-3" />
                              Reset recorded version
                            </button>
                          )}
                          <button
                            onClick={() => legacyCommand(node, "restart")}
                            disabled={busy || !!remoteNodeId}
                            className="flex items-center gap-1.5 rounded border border-frost-400/10 px-2.5 py-1.5 text-xs text-parchment-400 hover:text-amber-400 hover:border-amber-400/25 transition-colors disabled:opacity-50"
                          >
                            <Power className="h-3 w-3" />
                            Restart LS
                          </button>
                          <button
                            onClick={() => legacyCommand(node, "force_pull")}
                            disabled={busy || !!remoteNodeId}
                            className="flex items-center gap-1.5 rounded border border-amber-400/15 px-2.5 py-1.5 text-xs text-amber-400 hover:text-amber-300 hover:border-amber-400/30 transition-colors disabled:opacity-50"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Force Pull
                          </button>
                          <button
                            onClick={() => legacyCommand(node, "upgrade")}
                            disabled={busy || !!remoteNodeId}
                            className="flex items-center gap-1.5 rounded border border-amber-400/15 px-2.5 py-1.5 text-xs text-amber-400 hover:text-amber-300 hover:border-amber-400/30 transition-colors disabled:opacity-50"
                          >
                            <Download className="h-3 w-3" />
                            Legacy Upgrade
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
