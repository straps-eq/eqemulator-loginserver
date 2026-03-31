"use client";

import { useEffect, useState } from "react";
import {
  KeyRound,
  Search,
  RefreshCw,
  Trash2,
  Globe,
  HardDrive,
  Link2,
  Unlink,
  Lock,
} from "lucide-react";

interface LinkedPlatform {
  platformAccountId: number;
  platformUsername: string;
}

interface LoginserverAccount {
  id: number;
  accountName: string;
  accountEmail: string;
  sourceLoginserver: string | null;
  lastLoginDate: string | null;
  createdAt: string | null;
  linkedPlatformAccount: LinkedPlatform | null;
}

interface Stats {
  totalAccounts: number;
  lspxAccounts: number;
  localAccounts: number;
  linkedAccounts: number;
}

export function LoginserverAccountsDashboard() {
  const [accounts, setAccounts] = useState<LoginserverAccount[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "eqemu" | "local">("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/admin/loginserver-accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        setStats(data.stats || null);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const doAction = async (action: string, accountId: number, extra?: Record<string, unknown>) => {
    const key = `${accountId}-${action}`;
    setActionLoading(key);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/loginserver-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, accountId, ...extra }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: data.message || "Done", type: "success" });
        setResetPasswordId(null);
        setNewPassword("");
        await fetchData();
      } else {
        setMessage({ text: data.error || "Action failed", type: "error" });
      }
    } catch {
      setMessage({ text: "Request failed", type: "error" });
    }
    setActionLoading(null);
  };

  const filtered = accounts.filter((a) => {
    const matchesSearch =
      a.accountName.toLowerCase().includes(search.toLowerCase()) ||
      a.accountEmail.toLowerCase().includes(search.toLowerCase()) ||
      String(a.id).includes(search);
    const matchesSource =
      sourceFilter === "all" ||
      (sourceFilter === "eqemu" && a.sourceLoginserver === "eqemu") ||
      (sourceFilter === "local" && a.sourceLoginserver === "local");
    return matchesSearch && matchesSource;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-5 w-5 animate-spin text-frost-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={KeyRound} label="Total" value={stats.totalAccounts} />
          <StatCard icon={Globe} label="LSPX (eqemu)" value={stats.lspxAccounts} color="text-amber-400" />
          <StatCard icon={HardDrive} label="Local" value={stats.localAccounts} color="text-frost-400" />
          <StatCard icon={Link2} label="Linked" value={stats.linkedAccounts} color="text-emerald-400" />
        </div>
      )}

      {/* Message */}
      {message && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            message.type === "success"
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border border-red-500/20"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-parchment-600" />
          <input
            type="text"
            placeholder="Search by name, email, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md bg-obsidian-800 border border-frost-400/10 py-2 pl-10 pr-3 text-sm text-parchment-300 placeholder:text-parchment-700 focus:border-frost-400/30 focus:outline-none"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "eqemu", "local"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setSourceFilter(f)}
              className={`rounded-md px-3 py-2 text-xs font-display uppercase tracking-wider transition-colors ${
                sourceFilter === f
                  ? "bg-frost-400/15 text-frost-300 border border-frost-400/30"
                  : "bg-obsidian-800 text-parchment-600 border border-frost-400/8 hover:text-parchment-400"
              }`}
            >
              {f === "all" ? "All" : f === "eqemu" ? "LSPX" : "Local"}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setLoading(true); fetchData(); }}
          className="flex items-center gap-1.5 rounded-md bg-obsidian-800 border border-frost-400/8 px-3 py-2 text-xs text-parchment-500 hover:text-parchment-300 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Count */}
      <p className="text-xs text-parchment-600">
        Showing {filtered.length} of {accounts.length} accounts
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-frost-400/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-frost-400/8 bg-obsidian-900/50">
              <th className="px-3 py-2.5 text-left text-xs font-display uppercase tracking-wider text-parchment-600">ID</th>
              <th className="px-3 py-2.5 text-left text-xs font-display uppercase tracking-wider text-parchment-600">Account</th>
              <th className="px-3 py-2.5 text-left text-xs font-display uppercase tracking-wider text-parchment-600">Source</th>
              <th className="px-3 py-2.5 text-left text-xs font-display uppercase tracking-wider text-parchment-600">Platform Link</th>
              <th className="px-3 py-2.5 text-left text-xs font-display uppercase tracking-wider text-parchment-600">Last Login</th>
              <th className="px-3 py-2.5 text-left text-xs font-display uppercase tracking-wider text-parchment-600">Created</th>
              <th className="px-3 py-2.5 text-right text-xs font-display uppercase tracking-wider text-parchment-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-frost-400/5">
            {filtered.map((acct) => (
              <tr key={acct.id} className="hover:bg-obsidian-800/50 transition-colors">
                <td className="px-3 py-2 text-parchment-500 font-mono text-xs">{acct.id}</td>
                <td className="px-3 py-2">
                  <div className="text-parchment-300 font-medium">{acct.accountName}</div>
                  {acct.accountEmail && (
                    <div className="text-xs text-parchment-600">{acct.accountEmail}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      acct.sourceLoginserver === "eqemu"
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-frost-400/10 text-frost-300"
                    }`}
                  >
                    {acct.sourceLoginserver === "eqemu" ? (
                      <><Globe className="h-3 w-3" /> LSPX</>
                    ) : (
                      <><HardDrive className="h-3 w-3" /> Local</>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {acct.linkedPlatformAccount ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                      <Link2 className="h-3 w-3" />
                      {acct.linkedPlatformAccount.platformUsername}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-parchment-700">
                      <Unlink className="h-3 w-3" />
                      None
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-parchment-500">
                  {acct.lastLoginDate ? new Date(acct.lastLoginDate).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-parchment-500">
                  {acct.createdAt ? new Date(acct.createdAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {resetPasswordId === acct.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="password"
                          placeholder="New password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-32 rounded bg-obsidian-900 border border-frost-400/20 px-2 py-1 text-xs text-parchment-300 focus:border-frost-400/40 focus:outline-none"
                        />
                        <button
                          onClick={() => doAction("reset_password", acct.id, { newPassword })}
                          disabled={actionLoading === `${acct.id}-reset_password` || newPassword.length < 8}
                          className="rounded bg-frost-400/15 px-2 py-1 text-xs text-frost-300 hover:bg-frost-400/25 disabled:opacity-50 transition-colors"
                        >
                          {actionLoading === `${acct.id}-reset_password` ? "..." : "Set"}
                        </button>
                        <button
                          onClick={() => { setResetPasswordId(null); setNewPassword(""); }}
                          className="rounded px-2 py-1 text-xs text-parchment-600 hover:text-parchment-400 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setResetPasswordId(acct.id)}
                          title="Reset password"
                          className="rounded p-1.5 text-parchment-600 hover:bg-obsidian-700 hover:text-parchment-300 transition-colors"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete loginserver account "${acct.accountName}" (ID ${acct.id})? This cannot be undone.`)) {
                              doAction("delete", acct.id);
                            }
                          }}
                          disabled={actionLoading === `${acct.id}-delete`}
                          title="Delete account"
                          className="rounded p-1.5 text-parchment-600 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-parchment-600">
                  {search || sourceFilter !== "all" ? "No accounts match your filters" : "No loginserver accounts found"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color = "text-parchment-300",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-frost-400/8 bg-obsidian-900/50 px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-xs font-display uppercase tracking-wider text-parchment-600">{label}</span>
      </div>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}
