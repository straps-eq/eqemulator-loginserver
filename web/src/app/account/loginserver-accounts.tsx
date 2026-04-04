"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link2, Server } from "lucide-react";

interface LoginServerAccount {
  id: number;
  accountName: string;
  sourceLoginserver: string | null;
  lastIpAddress: string;
  lastLoginDate: string;
  createdAt: string;
  linkedAt: string;
}

export function LoginServerAccounts() {
  const [accounts, setAccounts] = useState<LoginServerAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"idle" | "link">("idle");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function fetchAccounts() {
    try {
      const res = await fetch("/api/account/loginserver-accounts");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setAccounts(data);
      }
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    fetchAccounts();
  }, []);

  async function handleSubmit() {
    setError("");
    setSuccess("");
    setSubmitting(true);

    const endpoint = "/api/account/link-loginserver";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Operation failed");
        return;
      }

      const msg = `Loginserver account "${data.loginAccountName}" claimed and linked.${data.converted ? " LSPX account converted to local." : ""}`;

      setSuccess(msg);
      setUsername("");
      setPassword("");
      setMode("idle");
      fetchAccounts();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Linked accounts list */}
      {loading ? (
        <p className="text-parchment-500 text-sm">Loading...</p>
      ) : accounts.length === 0 ? (
        <p className="text-parchment-500 text-sm">
          No loginserver accounts linked yet. Create a new one or link an existing account.
        </p>
      ) : (
        <div className="space-y-3 mb-6">
          {accounts.map((acct) => (
            <div
              key={acct.id}
              className="flex items-center justify-between rounded border border-frost-400/6 bg-[#0e1219]/60 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Server className="h-4 w-4 text-frost-400/50" />
                <div>
                  <span className="text-sm font-display font-semibold text-parchment-100">
                    {acct.accountName}
                  </span>
                  <span className="text-[10px] text-parchment-600 ml-2">
                    ID: {acct.id}
                  </span>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-forest-600/10 text-forest-400 border border-forest-600/20 uppercase tracking-wider font-display">
                {acct.sourceLoginserver === "local" ? "Local" : acct.sourceLoginserver}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Status messages */}
      {error && (
        <div className="rounded bg-burgundy-600/10 border border-burgundy-600/20 px-4 py-3 text-sm text-burgundy-400 mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded bg-forest-600/10 border border-forest-600/20 px-4 py-3 text-sm text-forest-400 mb-4">
          {success}
        </div>
      )}

      {/* Action buttons */}
      {mode === "idle" && (
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setMode("link"); setError(""); setSuccess(""); }}
          >
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Claim Existing Account
          </Button>
        </div>
      )}

      {/* Claim form */}
      {mode !== "idle" && (
        <form className="space-y-4 mt-4" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
          <div className="rounded bg-frost-400/[0.03] border border-frost-400/8 p-4">
            <h4 className="font-display text-xs font-semibold text-parchment-300 uppercase tracking-wider mb-3">
              Claim Existing Loginserver Account
            </h4>
            <p className="text-[11px] text-parchment-500 mb-4">
              Enter the username and password of your existing loginserver account (e.g. eqemulator.net credentials) to link it to your platform account.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-1.5">
                  Loginserver Username
                </label>
                <Input
                  type="text"
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your existing username"
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-1.5">
                  Current Password
                </label>
                <Input
                  type="password"
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your existing password"
                  autoComplete="current-password"
                />
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "Verifying..." : "Verify & Claim"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setMode("idle"); setUsername(""); setPassword(""); setError(""); }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
