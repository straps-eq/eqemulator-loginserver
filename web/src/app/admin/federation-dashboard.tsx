"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Network,
  Shield,
  Globe,
  RefreshCw,
  Plus,
  Copy,
  Check,
  XCircle,
  CheckCircle2,
  Pause,
  Ban,
  Play,
  Settings,
  Activity,
  Database,
  Clock,
} from "lucide-react";

interface NodeInfo {
  id: number;
  name: string;
  endpointUrl: string;
  publicKey: string;
  fingerprint: string | null;
  isSelf: number;
  isMaster: number;
  isApproved: number;
  status: string;
  nodeTier: string;
  lastSyncSeq: number;
  lastSyncAt: string | null;
  lastHeartbeatAt: string | null;
  hasPendingToken: boolean;
  bootstrapExpiresAt: string | null;
  createdAt: string | null;
}

interface ConfigEntry {
  key: string;
  value: unknown;
  version: number;
}

interface AuditEntry {
  id: number;
  nodeId: number | null;
  action: string;
  detail: unknown;
  createdAt: string | null;
}

interface FederationData {
  initialized: boolean;
  self: {
    id: number;
    name: string;
    endpointUrl: string;
    publicKey: string;
    isMaster: boolean;
  } | null;
  nodes: NodeInfo[];
  config: ConfigEntry[];
  changelog: { latestSeq: number; totalEntries: number };
  recentAudit: AuditEntry[];
}

export function FederationDashboard({ adminRole }: { adminRole: "admin" | "moderator" }) {
  const isMasterAdmin = adminRole === "admin";
  const [data, setData] = useState<FederationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [initForm, setInitForm] = useState({ name: "", endpoint_url: "" });
  const [joinForm, setJoinForm] = useState({ name: "", endpoint_url: "", master_url: "", bootstrap_token: "" });
  const [initMode, setInitMode] = useState<"master" | "join">(isMasterAdmin ? "master" : "join");
  const [peerForm, setPeerForm] = useState({ name: "", endpoint_url: "" });
  const [showAddPeer, setShowAddPeer] = useState(false);
  const [copiedToken, setCopiedToken] = useState<number | null>(null);
  const [syncResult, setSyncResult] = useState<{
    peersChecked: number;
    changesApplied: number;
    errors: string[];
  } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/federation");
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const doAction = async (body: Record<string, unknown>) => {
    const key = body.action as string;
    setActionLoading(key);
    try {
      const res = await fetch("/api/admin/federation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        alert(result.error || "Action failed");
      } else if (key === "sync") {
        setSyncResult(result);
      }
      await fetchData();
    } catch {
      alert("Request failed");
    }
    setActionLoading(null);
  };

  const copyToClipboard = (text: string, nodeId: number) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(nodeId);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-5 w-5 animate-spin text-frost-400/50" />
      </div>
    );
  }

  // Not initialized — show init/join form
  if (!data?.initialized) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-lg font-semibold text-parchment-200 flex items-center gap-2">
            <Network className="h-5 w-5 text-frost-400/60" />
            Federation Setup
          </h2>
          <p className="mt-1 text-sm text-parchment-600">
            Configure this node to participate in the federated network.
          </p>
        </div>

        {/* Instructions */}
        <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 p-5 space-y-3 max-w-2xl">
          <h3 className="text-xs font-display uppercase tracking-wider text-parchment-400">How Federation Works</h3>
          <div className="space-y-2 text-xs text-parchment-500 leading-relaxed">
            <p>
              The federation is a network of nodes that sync account data, server listings, and profiles in real time.
              There are two ways to set up this node:
            </p>
            <div className="pl-3 border-l-2 border-frost-400/10 space-y-2">
              <p>
                <strong className="text-parchment-300">Create New Federation (Master)</strong> — Initializes this node as the
                authoritative master. It generates a new keypair and becomes the source of truth. Only
                master admins (role: <span className="text-amber-400/80">admin</span>) can do this.
              </p>
              <p>
                <strong className="text-parchment-300">Join Existing Federation</strong> — Registers this node as a peer of an
                existing master. You&apos;ll need a bootstrap token from the master node&apos;s admin panel. All admin
                roles can join an existing federation.
              </p>
            </div>
            <p>
              Once initialized, this node will sync with peers automatically. Master nodes sync bidirectionally with
              other official nodes. Mesh nodes receive data read-only.
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 max-w-lg">
          {isMasterAdmin && (
            <button
              onClick={() => setInitMode("master")}
              className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${
                initMode === "master"
                  ? "bg-frost-400/20 border border-frost-400/30 text-frost-300"
                  : "bg-[#0a0e17]/30 border border-frost-400/8 text-parchment-600 hover:text-parchment-400"
              }`}
            >
              New Federation (Master)
            </button>
          )}
          <button
            onClick={() => setInitMode("join")}
            className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${
              initMode === "join"
                ? "bg-frost-400/20 border border-frost-400/30 text-frost-300"
                : "bg-[#0a0e17]/30 border border-frost-400/8 text-parchment-600 hover:text-parchment-400"
            }`}
          >
            Join Existing Federation
          </button>
        </div>

        {initMode === "master" ? (
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 p-6 space-y-4 max-w-lg">
            <div>
              <label className="block text-[10px] font-display uppercase tracking-wider text-parchment-600 mb-1">
                Node Name
              </label>
              <input
                type="text"
                value={initForm.name}
                onChange={(e) => setInitForm({ ...initForm, name: e.target.value })}
                placeholder="e.g. EQEmulator Primary"
                className="w-full rounded border border-frost-400/10 bg-[#080b12]/60 px-3 py-2 text-sm text-parchment-300 placeholder-parchment-700 focus:border-frost-400/30 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-display uppercase tracking-wider text-parchment-600 mb-1">
                Endpoint URL
              </label>
              <input
                type="text"
                value={initForm.endpoint_url}
                onChange={(e) =>
                  setInitForm({ ...initForm, endpoint_url: e.target.value })
                }
                placeholder="e.g. https://eqemulator.dev"
                className="w-full rounded border border-frost-400/10 bg-[#080b12]/60 px-3 py-2 text-sm text-parchment-300 placeholder-parchment-700 focus:border-frost-400/30 focus:outline-none"
              />
            </div>
            <button
              onClick={() =>
                doAction({
                  action: "initialize",
                  name: initForm.name,
                  endpoint_url: initForm.endpoint_url,
                })
              }
              disabled={
                !initForm.name ||
                !initForm.endpoint_url ||
                actionLoading === "initialize"
              }
              className="flex items-center gap-2 rounded bg-frost-400/20 border border-frost-400/30 px-4 py-2 text-sm text-frost-300 hover:bg-frost-400/30 transition-colors disabled:opacity-50"
            >
              {actionLoading === "initialize" ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Shield className="h-3.5 w-3.5" />
              )}
              Initialize as Master
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 p-6 space-y-4 max-w-lg">
            <p className="text-xs text-parchment-600">
              Get a bootstrap token from the master node&apos;s admin panel, then fill in the details below.
            </p>
            <div>
              <label className="block text-[10px] font-display uppercase tracking-wider text-parchment-600 mb-1">
                Node Name
              </label>
              <input
                type="text"
                value={joinForm.name}
                onChange={(e) => setJoinForm({ ...joinForm, name: e.target.value })}
                placeholder="e.g. EQEmulator EU"
                className="w-full rounded border border-frost-400/10 bg-[#080b12]/60 px-3 py-2 text-sm text-parchment-300 placeholder-parchment-700 focus:border-frost-400/30 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-display uppercase tracking-wider text-parchment-600 mb-1">
                This Node&apos;s Endpoint URL
              </label>
              <input
                type="text"
                value={joinForm.endpoint_url}
                onChange={(e) => setJoinForm({ ...joinForm, endpoint_url: e.target.value })}
                placeholder="e.g. https://eu.eqemulator.dev"
                className="w-full rounded border border-frost-400/10 bg-[#080b12]/60 px-3 py-2 text-sm text-parchment-300 placeholder-parchment-700 focus:border-frost-400/30 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-display uppercase tracking-wider text-parchment-600 mb-1">
                Master Node URL
              </label>
              <input
                type="text"
                value={joinForm.master_url}
                onChange={(e) => setJoinForm({ ...joinForm, master_url: e.target.value })}
                placeholder="e.g. https://eqemulator.dev"
                className="w-full rounded border border-frost-400/10 bg-[#080b12]/60 px-3 py-2 text-sm text-parchment-300 placeholder-parchment-700 focus:border-frost-400/30 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-display uppercase tracking-wider text-parchment-600 mb-1">
                Bootstrap Token
              </label>
              <input
                type="text"
                value={joinForm.bootstrap_token}
                onChange={(e) => setJoinForm({ ...joinForm, bootstrap_token: e.target.value })}
                placeholder="Paste token from master admin"
                className="w-full rounded border border-frost-400/10 bg-[#080b12]/60 px-3 py-2 text-sm font-mono text-parchment-300 placeholder-parchment-700 focus:border-frost-400/30 focus:outline-none"
              />
            </div>
            <button
              onClick={() =>
                doAction({
                  action: "join_federation",
                  name: joinForm.name,
                  endpoint_url: joinForm.endpoint_url,
                  master_url: joinForm.master_url,
                  bootstrap_token: joinForm.bootstrap_token,
                })
              }
              disabled={
                !joinForm.name ||
                !joinForm.endpoint_url ||
                !joinForm.master_url ||
                !joinForm.bootstrap_token ||
                actionLoading === "join_federation"
              }
              className="flex items-center gap-2 rounded bg-frost-400/20 border border-frost-400/30 px-4 py-2 text-sm text-frost-300 hover:bg-frost-400/30 transition-colors disabled:opacity-50"
            >
              {actionLoading === "join_federation" ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Globe className="h-3.5 w-3.5" />
              )}
              Join Federation
            </button>
          </div>
        )}
      </div>
    );
  }

  // Initialized — show dashboard
  const selfNode = data.nodes.find((n) => n.isSelf);
  const peerNodes = data.nodes.filter((n) => !n.isSelf);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-parchment-200 flex items-center gap-2">
            <Network className="h-5 w-5 text-frost-400/60" />
            Federation
          </h2>
          <p className="mt-1 text-sm text-parchment-600">
            {data.self?.isMaster ? "Master node" : "Peer node"} —{" "}
            {data.self?.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => doAction({ action: "sync" })}
            disabled={actionLoading === "sync"}
            className="flex items-center gap-1.5 rounded border border-frost-400/10 bg-[#0a0e17]/60 px-3 py-1.5 text-xs text-parchment-400 hover:text-frost-400 hover:border-frost-400/25 transition-colors disabled:opacity-50"
          >
            {actionLoading === "sync" ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Sync Now
          </button>
          <button
            onClick={() => {
              setLoading(true);
              fetchData();
            }}
            className="rounded border border-frost-400/10 bg-[#0a0e17]/60 p-1.5 text-parchment-500 hover:text-frost-400 hover:border-frost-400/25 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className="rounded-lg border border-frost-400/15 bg-frost-400/5 p-3 text-sm">
          <div className="flex items-center gap-2 text-frost-300">
            <Activity className="h-3.5 w-3.5" />
            <span>
              Sync complete: {syncResult.peersChecked} peers checked,{" "}
              {syncResult.changesApplied} changes applied
            </span>
          </div>
          {syncResult.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              {syncResult.errors.map((e, i) => (
                <div key={i} className="text-xs text-red-400/80">
                  {e}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<Network className="h-4 w-4" />}
          label="Peers"
          value={peerNodes.filter((n) => n.isApproved && n.status === "active").length}
        />
        <StatCard
          icon={<Database className="h-4 w-4" />}
          label="Changelog Entries"
          value={data.changelog.totalEntries}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Latest Seq"
          value={data.changelog.latestSeq}
        />
        <StatCard
          icon={<Shield className="h-4 w-4" />}
          label="Audit Events"
          value={data.recentAudit.length}
        />
      </div>

      {/* Self Node */}
      {selfNode && (
        <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="h-4 w-4 text-frost-400/60" />
            <span className="text-[10px] font-display uppercase tracking-wider text-parchment-600">
              This Node
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-parchment-600">Name:</span>{" "}
              <span className="text-parchment-300">{selfNode.name}</span>
            </div>
            <div>
              <span className="text-parchment-600">Role:</span>{" "}
              <span className="text-amber-400/80">
                {selfNode.isMaster ? "Master" : "Peer"}
              </span>
              <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${
                selfNode.nodeTier === "official"
                  ? "bg-frost-400/10 text-frost-400/80"
                  : "bg-parchment-600/10 text-parchment-500"
              }`}>
                {selfNode.nodeTier}
              </span>
            </div>
            <div className="col-span-2">
              <span className="text-parchment-600">Endpoint:</span>{" "}
              <span className="text-parchment-300">{selfNode.endpointUrl}</span>
            </div>
            <div className="col-span-2">
              <span className="text-parchment-600">Public Key:</span>{" "}
              <code className="text-[10px] text-frost-400/60 break-all">
                {selfNode.publicKey}
              </code>
            </div>
            {selfNode.fingerprint && (
              <div className="col-span-2">
                <span className="text-parchment-600">Fingerprint:</span>{" "}
                <code className="text-[10px] text-amber-400/70 font-mono tracking-wider">
                  {selfNode.fingerprint}
                </code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Peer Nodes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-display uppercase tracking-wider text-parchment-600">
            Peer Nodes
          </span>
          {data.self?.isMaster && (
            <button
              onClick={() => setShowAddPeer(!showAddPeer)}
              className="flex items-center gap-1 rounded border border-frost-400/10 px-2 py-1 text-[10px] text-parchment-500 hover:text-frost-400 hover:border-frost-400/25 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add Peer
            </button>
          )}
        </div>

        {/* Add peer form */}
        {showAddPeer && (
          <div className="rounded-lg border border-frost-400/15 bg-frost-400/5 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-display uppercase tracking-wider text-parchment-600 mb-1">
                  Peer Name
                </label>
                <input
                  type="text"
                  value={peerForm.name}
                  onChange={(e) =>
                    setPeerForm({ ...peerForm, name: e.target.value })
                  }
                  placeholder="e.g. US-West Node"
                  className="w-full rounded border border-frost-400/10 bg-[#080b12]/60 px-3 py-1.5 text-sm text-parchment-300 placeholder-parchment-700 focus:border-frost-400/30 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-display uppercase tracking-wider text-parchment-600 mb-1">
                  Endpoint URL
                </label>
                <input
                  type="text"
                  value={peerForm.endpoint_url}
                  onChange={(e) =>
                    setPeerForm({ ...peerForm, endpoint_url: e.target.value })
                  }
                  placeholder="e.g. https://us-west.eqemulator.dev"
                  className="w-full rounded border border-frost-400/10 bg-[#080b12]/60 px-3 py-1.5 text-sm text-parchment-300 placeholder-parchment-700 focus:border-frost-400/30 focus:outline-none"
                />
              </div>
            </div>
            <button
              onClick={() => {
                doAction({
                  action: "add_peer",
                  name: peerForm.name,
                  endpoint_url: peerForm.endpoint_url,
                });
                setPeerForm({ name: "", endpoint_url: "" });
                setShowAddPeer(false);
              }}
              disabled={
                !peerForm.name ||
                !peerForm.endpoint_url ||
                actionLoading === "add_peer"
              }
              className="flex items-center gap-1.5 rounded bg-frost-400/15 border border-frost-400/20 px-3 py-1.5 text-xs text-frost-300 hover:bg-frost-400/25 transition-colors disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              Generate Bootstrap Token
            </button>
          </div>
        )}

        {/* Peer list */}
        {peerNodes.length === 0 ? (
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 p-6 text-center text-sm text-parchment-600">
            No peer nodes yet. Add one to start federation.
          </div>
        ) : (
          <div className="space-y-2">
            {peerNodes.map((peer) => (
              <PeerCard
                key={peer.id}
                peer={peer}
                isMaster={!!data.self?.isMaster}
                onAction={doAction}
                actionLoading={actionLoading}
                copiedToken={copiedToken}
                onCopyToken={copyToClipboard}
              />
            ))}
          </div>
        )}
      </div>

      {/* Config */}
      {data.config.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-parchment-600" />
            <span className="text-[10px] font-display uppercase tracking-wider text-parchment-600">
              Federation Config
            </span>
          </div>
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 overflow-hidden">
            {data.config.map((c) => (
              <div
                key={c.key}
                className="grid grid-cols-[200px_1fr_60px] gap-2 px-4 py-2.5 border-b border-frost-400/5 last:border-0 items-center"
              >
                <span className="text-xs text-parchment-400 font-mono">
                  {c.key}
                </span>
                <code className="text-[10px] text-parchment-600 truncate">
                  {JSON.stringify(c.value)}
                </code>
                <span className="text-[10px] text-parchment-700 text-right">
                  v{c.version}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Audit */}
      {data.recentAudit.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-parchment-600" />
            <span className="text-[10px] font-display uppercase tracking-wider text-parchment-600">
              Recent Activity
            </span>
          </div>
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 overflow-hidden">
            {data.recentAudit.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 px-4 py-2 border-b border-frost-400/5 last:border-0"
              >
                <span className="text-[10px] text-parchment-700 whitespace-nowrap">
                  {a.createdAt
                    ? new Date(a.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </span>
                <span className="text-xs text-parchment-400">{a.action}</span>
                {a.detail != null && (
                  <code className="text-[10px] text-parchment-600 truncate">
                    {JSON.stringify(a.detail) as string}
                  </code>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 p-4">
      <div className="flex items-center gap-2 text-parchment-600 mb-2">
        {icon}
        <span className="text-[10px] font-display uppercase tracking-wider">
          {label}
        </span>
      </div>
      <span className="text-2xl font-display font-semibold text-parchment-200">
        {value}
      </span>
    </div>
  );
}

function PeerCard({
  peer,
  isMaster,
  onAction,
  actionLoading,
  copiedToken,
  onCopyToken,
}: {
  peer: NodeInfo;
  isMaster: boolean;
  onAction: (body: Record<string, unknown>) => void;
  actionLoading: string | null;
  copiedToken: number | null;
  onCopyToken: (text: string, nodeId: number) => void;
}) {
  const statusColor =
    peer.status === "active" && peer.isApproved
      ? "text-forest-400"
      : peer.status === "suspended"
      ? "text-amber-400"
      : "text-red-400/60";

  const statusLabel =
    !peer.isApproved && peer.hasPendingToken
      ? "Pending Registration"
      : !peer.isApproved
      ? "Not Approved"
      : peer.status;

  return (
    <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              peer.status === "active" && peer.isApproved
                ? "bg-forest-400"
                : peer.status === "suspended"
                ? "bg-amber-400"
                : "bg-red-400/60"
            }`}
          />
          <span className="text-sm text-parchment-300 font-medium">
            {peer.name}
          </span>
          <span className={`text-[10px] uppercase tracking-wider ${statusColor}`}>
            {statusLabel}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            peer.nodeTier === "official"
              ? "bg-frost-400/10 text-frost-400/80"
              : "bg-parchment-600/10 text-parchment-500"
          }`}>
            {peer.nodeTier}
          </span>
        </div>
        {isMaster && peer.isApproved && (
          <div className="flex items-center gap-1">
            {peer.status === "active" && peer.nodeTier === "mesh" && (
              <button
                onClick={() =>
                  onAction({ action: "set_tier", node_id: peer.id, tier: "official" })
                }
                className="px-1.5 py-0.5 rounded text-[10px] text-frost-400/70 border border-frost-400/15 hover:bg-frost-400/10 transition-colors"
                title="Promote to Official"
              >
                Promote
              </button>
            )}
            {peer.status === "active" && peer.nodeTier === "official" && (
              <button
                onClick={() =>
                  onAction({ action: "set_tier", node_id: peer.id, tier: "mesh" })
                }
                className="px-1.5 py-0.5 rounded text-[10px] text-parchment-500 border border-parchment-600/15 hover:bg-parchment-600/10 transition-colors"
                title="Demote to Mesh"
              >
                Demote
              </button>
            )}
            {peer.status === "active" && (
              <button
                onClick={() =>
                  onAction({ action: "suspend_node", node_id: peer.id })
                }
                className="p-1 rounded text-parchment-600 hover:text-amber-400 hover:bg-amber-400/10 transition-colors"
                title="Suspend"
              >
                <Pause className="h-3.5 w-3.5" />
              </button>
            )}
            {peer.status === "suspended" && (
              <button
                onClick={() =>
                  onAction({ action: "reactivate_node", node_id: peer.id })
                }
                className="p-1 rounded text-parchment-600 hover:text-forest-400 hover:bg-forest-400/10 transition-colors"
                title="Reactivate"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            {peer.status !== "revoked" && (
              <button
                onClick={() =>
                  onAction({ action: "revoke_node", node_id: peer.id })
                }
                className="p-1 rounded text-parchment-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                title="Revoke"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-parchment-600">Endpoint:</span>{" "}
          <span className="text-parchment-400">{peer.endpointUrl}</span>
        </div>
        {peer.fingerprint && (
          <div>
            <span className="text-parchment-600">Fingerprint:</span>{" "}
            <code className="text-[10px] text-amber-400/70 font-mono">
              {peer.fingerprint}
            </code>
          </div>
        )}
        <div>
          <span className="text-parchment-600">Last Sync:</span>{" "}
          <span className="text-parchment-400">
            {peer.lastSyncAt
              ? new Date(peer.lastSyncAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Never"}
          </span>
        </div>
        <div>
          <span className="text-parchment-600">Last Heartbeat:</span>{" "}
          <span className="text-parchment-400">
            {peer.lastHeartbeatAt
              ? new Date(peer.lastHeartbeatAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Never"}
          </span>
        </div>
        <div>
          <span className="text-parchment-600">Sync Seq:</span>{" "}
          <span className="text-parchment-400">{peer.lastSyncSeq}</span>
        </div>
      </div>

      {/* Pending registration indicator */}
      {peer.hasPendingToken && !peer.isApproved && (
        <div className="mt-3 rounded border border-amber-400/20 bg-amber-400/5 p-3">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-amber-400/80" />
            <span className="text-[10px] font-display uppercase tracking-wider text-amber-400/80">
              Awaiting Registration
            </span>
          </div>
          <p className="mt-1 text-[10px] text-parchment-600">
            The bootstrap token was shown when the peer was added. Paste it into the new node&apos;s &quot;Join Federation&quot; form.
          </p>
          {peer.bootstrapExpiresAt && (
            <span className="mt-1 block text-[10px] text-parchment-700">
              Expires:{" "}
              {new Date(peer.bootstrapExpiresAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
