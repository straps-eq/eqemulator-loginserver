"use client";

import { useState, useEffect } from "react";

interface ProviderLink {
  provider: string;
  providerEmail: string | null;
  createdAt: string | null;
}

const PROVIDER_INFO: Record<string, { label: string; color: string }> = {
  google: { label: "Google", color: "text-parchment-200" },
  discord: { label: "Discord", color: "text-[#5865F2]" },
};

export function ConnectedProviders() {
  const [providers, setProviders] = useState<ProviderLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function fetchProviders() {
    try {
      const res = await fetch("/api/auth/providers");
      if (res.ok) {
        const data = await res.json();
        setProviders(data.providers || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProviders();
  }, []);

  async function handleUnlink(provider: string) {
    setError("");
    setUnlinking(provider);
    try {
      const res = await fetch(`/api/auth/link/${provider}`, { method: "DELETE" });
      if (res.ok) {
        setProviders((prev) => prev.filter((p) => p.provider !== provider));
      } else {
        const data = await res.json();
        setError(data.error || "Failed to unlink provider");
      }
    } catch {
      setError("Network error");
    } finally {
      setUnlinking(null);
    }
  }

  const linkedProviders = new Set(providers.map((p) => p.provider));
  const allProviders = ["google", "discord"] as const;

  if (loading) {
    return <p className="text-parchment-600 text-sm">Loading...</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded bg-burgundy-600/10 border border-burgundy-600/20 px-3 py-2 text-xs text-burgundy-400">
          {error}
        </div>
      )}

      {allProviders.map((provider) => {
        const info = PROVIDER_INFO[provider];
        const link = providers.find((p) => p.provider === provider);
        const isLinked = !!link;

        return (
          <div
            key={provider}
            className="flex items-center justify-between rounded-md border border-frost-400/8 bg-[#0a0e17]/40 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium ${info.color}`}>{info.label}</span>
              {isLinked && link.providerEmail && (
                <span className="text-xs text-parchment-600">{link.providerEmail}</span>
              )}
            </div>
            <div>
              {isLinked ? (
                <button
                  onClick={() => handleUnlink(provider)}
                  disabled={unlinking === provider || providers.length <= 1}
                  className="text-xs text-red-400/70 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title={providers.length <= 1 ? "Cannot unlink your only sign-in method" : "Unlink"}
                >
                  {unlinking === provider ? "Unlinking..." : "Unlink"}
                </button>
              ) : (
                <a
                  href={`/api/auth/${provider}`}
                  className="text-xs text-frost-400 hover:text-frost-300 transition-colors"
                >
                  Link
                </a>
              )}
            </div>
          </div>
        );
      })}

      {providers.length === 0 && (
        <p className="text-xs text-parchment-600">
          No providers linked. Link Google or Discord to secure your account.
        </p>
      )}
    </div>
  );
}
