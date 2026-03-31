"use client";

import { useEffect, useState } from "react";
import {
  Users,
  ShieldCheck,
  Server,
  Mail,
  MailX,
  Trash2,
  Crown,
  UserX,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Globe,
} from "lucide-react";

interface WorldServerAdmin {
  adminId: number;
  accountName: string;
  servers: { id: number; longName: string; shortName: string }[];
}

interface Account {
  id: number;
  username: string;
  email: string;
  emailVerified: number;
  createdAt: string | null;
  role: string | null;
  linkedLoginAccounts: number;
  worldServerAdmins: WorldServerAdmin[];
}

interface Stats {
  totalAccounts: number;
  verifiedAccounts: number;
  totalAdmins: number;
  totalWorldServers: number;
  totalWorldServerAdmins: number;
}

export function AdminDashboard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/admin/accounts");
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

  const doAction = async (
    accountId: number,
    method: string,
    body?: Record<string, unknown>
  ) => {
    const key = `${accountId}-${body?.action || "delete"}`;
    setActionLoading(key);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        await fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "Action failed");
      }
    } catch {
      alert("Request failed");
    }
    setActionLoading(null);
  };

  const filtered = accounts.filter(
    (a) =>
      a.username.toLowerCase().includes(search.toLowerCase()) ||
      a.email.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    // Admins first, then by creation date desc
    if (a.role && !b.role) return -1;
    if (!a.role && b.role) return 1;
    return (
      new Date(b.createdAt || 0).getTime() -
      new Date(a.createdAt || 0).getTime()
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <RefreshCw className="h-5 w-5 animate-spin text-frost-400/50" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Role Reference */}
      <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 p-5 max-w-2xl">
        <h3 className="text-xs font-display uppercase tracking-wider text-parchment-400 mb-3">Admin Roles</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded border border-amber-400/10 bg-amber-400/[0.02] p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Crown className="h-3 w-3 text-amber-400/80" />
              <span className="text-xs font-display font-semibold text-amber-400/80 uppercase tracking-wider">Admin</span>
            </div>
            <ul className="space-y-1 text-[11px] text-parchment-500 leading-relaxed">
              <li>Full platform management</li>
              <li>Create new federations (master init)</li>
              <li>Manage all accounts and roles</li>
              <li>Configure server tiers and thresholds</li>
              <li>Add/remove federation peers</li>
            </ul>
          </div>
          <div className="rounded border border-frost-400/8 bg-frost-400/[0.02] p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <ShieldCheck className="h-3 w-3 text-frost-400/70" />
              <span className="text-xs font-display font-semibold text-frost-400/70 uppercase tracking-wider">Moderator</span>
            </div>
            <ul className="space-y-1 text-[11px] text-parchment-500 leading-relaxed">
              <li>View accounts and server data</li>
              <li>Join existing federations</li>
              <li>Monitor federation status</li>
              <li>Cannot create new federations</li>
              <li>Cannot promote/demote admins</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label="Accounts"
            value={stats.totalAccounts}
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Verified"
            value={stats.verifiedAccounts}
          />
          <StatCard
            icon={<Crown className="h-4 w-4" />}
            label="Admins"
            value={stats.totalAdmins}
          />
          <StatCard
            icon={<Globe className="h-4 w-4" />}
            label="World Servers"
            value={stats.totalWorldServers}
          />
          <StatCard
            icon={<Server className="h-4 w-4" />}
            label="Server Accounts"
            value={stats.totalWorldServerAdmins}
          />
        </div>
      )}

      {/* Search + Refresh */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-parchment-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts..."
            className="w-full rounded border border-frost-400/10 bg-[#0a0e17]/60 pl-9 pr-3 py-2 text-sm text-parchment-300 placeholder-parchment-700 focus:border-frost-400/30 focus:outline-none"
          />
        </div>
        <button
          onClick={() => {
            setLoading(true);
            fetchData();
          }}
          className="rounded border border-frost-400/10 bg-[#0a0e17]/60 p-2 text-parchment-500 hover:text-frost-400 hover:border-frost-400/25 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <span className="text-xs text-parchment-600">
          {filtered.length} account{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Accounts Table */}
      <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/50 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_1.2fr_80px_100px_120px_80px] gap-2 px-4 py-2.5 border-b border-frost-400/8 text-[10px] font-display uppercase tracking-wider text-parchment-600">
          <span>Username</span>
          <span>Email</span>
          <span className="text-center">Verified</span>
          <span className="text-center">Role</span>
          <span className="text-center">Servers</span>
          <span className="text-center">Actions</span>
        </div>

        {/* Rows */}
        {sorted.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-parchment-600">
            No accounts found
          </div>
        ) : (
          sorted.map((acct) => (
            <AccountRow
              key={acct.id}
              account={acct}
              isExpanded={expandedId === acct.id}
              onToggle={() =>
                setExpandedId(expandedId === acct.id ? null : acct.id)
              }
              onAction={doAction}
              actionLoading={actionLoading}
            />
          ))
        )}
      </div>
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

function AccountRow({
  account,
  isExpanded,
  onToggle,
  onAction,
  actionLoading,
}: {
  account: Account;
  isExpanded: boolean;
  onToggle: () => void;
  onAction: (
    id: number,
    method: string,
    body?: Record<string, unknown>
  ) => void;
  actionLoading: string | null;
}) {
  const hasServers = account.worldServerAdmins.length > 0;
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="border-b border-frost-400/5 last:border-0">
      <div className="grid grid-cols-[1fr_1.2fr_80px_100px_120px_80px] gap-2 px-4 py-3 items-center hover:bg-frost-400/[0.02] transition-colors">
        {/* Username */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onToggle}
            className="text-parchment-600 hover:text-frost-400 transition-colors flex-shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          <span className="text-sm text-parchment-300 truncate font-medium">
            {account.username}
          </span>
          {account.role === "admin" && (
            <Crown className="h-3 w-3 text-amber-400/80 flex-shrink-0" />
          )}
        </div>

        {/* Email */}
        <span className="text-xs text-parchment-500 truncate">
          {account.email}
        </span>

        {/* Verified */}
        <div className="text-center">
          {account.emailVerified ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-forest-400 mx-auto" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-red-400/60 mx-auto" />
          )}
        </div>

        {/* Role */}
        <div className="text-center">
          <span
            className={`text-[10px] font-display uppercase tracking-wider px-2 py-0.5 rounded ${
              account.role === "admin"
                ? "text-amber-400 bg-amber-400/10 border border-amber-400/20"
                : account.role === "moderator"
                ? "text-frost-400 bg-frost-400/10 border border-frost-400/20"
                : "text-parchment-700"
            }`}
          >
            {account.role || "—"}
          </span>
        </div>

        {/* Servers */}
        <div className="text-center">
          {hasServers ? (
            <span className="text-xs text-forest-400">
              {account.worldServerAdmins.reduce(
                (sum, wa) => sum + wa.servers.length,
                0
              )}{" "}
              server
              {account.worldServerAdmins.reduce(
                (sum, wa) => sum + wa.servers.length,
                0
              ) !== 1
                ? "s"
                : ""}
            </span>
          ) : (
            <span className="text-xs text-parchment-700">—</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-center gap-1">
          {/* Toggle email verification */}
          <button
            onClick={() =>
              onAction(account.id, "PUT", {
                action: account.emailVerified
                  ? "unverify_email"
                  : "verify_email",
              })
            }
            disabled={
              actionLoading ===
              `${account.id}-${
                account.emailVerified ? "unverify_email" : "verify_email"
              }`
            }
            className="p-1 rounded text-parchment-600 hover:text-frost-400 hover:bg-frost-400/10 transition-colors"
            title={
              account.emailVerified ? "Unverify email" : "Verify email"
            }
          >
            {account.emailVerified ? (
              <MailX className="h-3.5 w-3.5" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  onAction(account.id, "DELETE");
                  setConfirmDelete(false);
                }}
                className="text-[9px] text-red-400 bg-red-400/10 border border-red-400/20 rounded px-1.5 py-0.5 hover:bg-red-400/20 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[9px] text-parchment-600 hover:text-parchment-400 transition-colors"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1 rounded text-parchment-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
              title="Delete account"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className="px-4 pb-4 pl-10 space-y-3">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-parchment-600">Account ID:</span>{" "}
              <span className="text-parchment-400">{account.id}</span>
            </div>
            <div>
              <span className="text-parchment-600">Created:</span>{" "}
              <span className="text-parchment-400">
                {account.createdAt
                  ? new Date(account.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </span>
            </div>
            <div>
              <span className="text-parchment-600">Linked LS Accounts:</span>{" "}
              <span className="text-parchment-400">
                {account.linkedLoginAccounts}
              </span>
            </div>
          </div>

          {/* Role management */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-display uppercase tracking-wider text-parchment-600">
              Set role:
            </span>
            {["admin", "moderator", null].map((role) => (
              <button
                key={role ?? "none"}
                onClick={() =>
                  onAction(account.id, "PUT", {
                    action: "set_role",
                    role,
                  })
                }
                disabled={actionLoading === `${account.id}-set_role`}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  account.role === role ||
                  (role === null && !account.role)
                    ? "border-frost-400/30 bg-frost-400/10 text-frost-300"
                    : "border-frost-400/8 text-parchment-600 hover:border-frost-400/20 hover:text-parchment-400"
                }`}
              >
                {role === null ? "None" : role}
              </button>
            ))}
          </div>

          {/* World Server Admins */}
          {account.worldServerAdmins.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] font-display uppercase tracking-wider text-parchment-600">
                World Server Accounts
              </span>
              {account.worldServerAdmins.map((wa) => (
                <div
                  key={wa.adminId}
                  className="rounded border border-frost-400/8 bg-[#080b12]/50 p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Server className="h-3 w-3 text-frost-400/50" />
                    <span className="text-xs text-parchment-300 font-medium">
                      {wa.accountName}
                    </span>
                    <span className="text-[10px] text-parchment-700">
                      (Admin #{wa.adminId})
                    </span>
                  </div>
                  {wa.servers.length > 0 ? (
                    <div className="ml-5 space-y-1">
                      {wa.servers.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-2 text-xs"
                        >
                          <div className="h-1.5 w-1.5 rounded-full bg-forest-400/60" />
                          <span className="text-parchment-400">
                            {s.longName}
                          </span>
                          <span className="text-parchment-700">
                            ({s.shortName})
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="ml-5 text-[10px] text-parchment-700">
                      No servers connected
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
