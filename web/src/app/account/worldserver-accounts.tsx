"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Server, Copy, Check, Eye, EyeOff, ChevronDown, ChevronUp, Save, KeyRound, ImagePlus, Trash2 } from "lucide-react";

interface WorldServer {
  id: number;
  longName: string;
  shortName: string;
  tagDescription: string;
  lastIpAddress: string | null;
  lastLoginDate: string | null;
  loginServerListTypeId: number;
  isServerTrusted: number;
}

interface ServerProfile {
  description: string | null;
  websiteUrl: string | null;
  discordUrl: string | null;
  expansionEra: string | null;
  bannerImageUrl: string | null;
}

interface AdminAccount {
  id: number;
  accountName: string;
  password: string;
  registrationDate: string;
  servers: WorldServer[];
  profile: ServerProfile | null;
}

function AccountCard({
  acct,
  onRefresh,
}: {
  acct: AdminAccount;
  onRefresh: () => void;
}) {
  const [copiedField, setCopiedField] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showConfig, setShowConfig] = useState(false);

  // Password reset
  const [showResetPw, setShowResetPw] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState("");

  // Profile editing
  const [description, setDescription] = useState(acct.profile?.description || "");
  const [websiteUrl, setWebsiteUrl] = useState(acct.profile?.websiteUrl || "");
  const [discordUrl, setDiscordUrl] = useState(acct.profile?.discordUrl || "");
  const [expansionEra, setExpansionEra] = useState(acct.profile?.expansionEra || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [bannerUrl, setBannerUrl] = useState(acct.profile?.bannerImageUrl ? `${acct.profile.bannerImageUrl}?t=${Date.now()}` : "");
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerMsg, setBannerMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function copy(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(""), 2000);
  }

  async function handleResetPassword() {
    if (newPassword.length < 8) { setResetMsg("Password must be at least 8 characters"); return; }
    setResetLoading(true);
    setResetMsg("");
    try {
      const res = await fetch(`/api/account/worldserver-accounts/${acct.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_password", password: newPassword }),
      });
      if (res.ok) {
        setResetMsg("Password updated.");
        setNewPassword("");
        setShowResetPw(false);
        onRefresh();
      } else {
        const data = await res.json();
        setResetMsg(data.error || "Failed to reset password");
      }
    } catch { setResetMsg("Error resetting password"); }
    finally { setResetLoading(false); }
  }

  async function handleSaveProfile() {
    setProfileSaving(true);
    setProfileMsg("");
    try {
      const res = await fetch(`/api/account/worldserver-accounts/${acct.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_profile",
          description: description || "",
          websiteUrl: websiteUrl || "",
          discordUrl: discordUrl || "",
          expansionEra: expansionEra || "",
        }),
      });
      if (res.ok) {
        setProfileMsg("Saved.");
        setTimeout(() => setProfileMsg(""), 3000);
        onRefresh();
      } else {
        const data = await res.json();
        setProfileMsg(data.error || "Failed to save");
      }
    } catch { setProfileMsg("Error saving profile"); }
    finally { setProfileSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/account/worldserver-accounts/${acct.id}`, { method: "DELETE" });
      if (res.ok) { onRefresh(); }
      else { const data = await res.json(); alert(data.error || "Failed to delete"); }
    } catch { alert("Error deleting account"); }
    finally { setDeleting(false); setConfirmDelete(false); }
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setBannerMsg(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB — max 5MB)`);
      e.target.value = "";
      return;
    }
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setBannerMsg(`Invalid file type: ${file.type || "unknown"}. Use JPEG, PNG, WebP, or GIF.`);
      e.target.value = "";
      return;
    }
    setBannerUploading(true);
    setBannerMsg("");
    try {
      const form = new FormData();
      form.append("banner", file);
      const res = await fetch(`/api/account/worldserver-accounts/${acct.id}/banner`, {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        const data = await res.json();
        setBannerUrl(`${data.bannerUrl}?t=${Date.now()}`);
        setBannerMsg("Banner uploaded.");
        setTimeout(() => { setBannerMsg(""); onRefresh(); }, 3000);
      } else {
        let errorMsg = `Upload failed (${res.status})`;
        try {
          const data = await res.json();
          if (data.error) errorMsg = data.error;
        } catch {
          if (res.status === 413) errorMsg = "File too large — server rejected the upload";
          else if (res.status === 401) errorMsg = "Not authenticated — please log in again";
          else if (res.status === 403) errorMsg = "Not authorized to upload for this server";
        }
        setBannerMsg(errorMsg);
      }
    } catch (err) {
      setBannerMsg(`Upload error: ${err instanceof Error ? err.message : "network failure"}`);
    } finally {
      setBannerUploading(false);
      e.target.value = "";
    }
  }

  const configPassword = acct.password || "YOUR_PASSWORD";

  return (
    <div className="rounded border border-frost-400/8 bg-[#0a0e16]/60">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <Server className="h-3.5 w-3.5 text-frost-400/60" />
          <span className="text-sm font-medium text-parchment-200 font-mono">{acct.accountName}</span>
          {acct.servers.length > 0 && (
            <span className="text-[10px] font-display uppercase tracking-wider text-forest-400 bg-forest-400/10 px-1.5 py-0.5 rounded">
              {acct.servers.length} connected
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-parchment-600" /> : <ChevronDown className="h-4 w-4 text-parchment-600" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Credentials */}
          <div className="bg-[#0a0e17] rounded p-3 space-y-2">
            <span className="text-[10px] font-display uppercase tracking-wider text-parchment-500">Credentials</span>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] text-parchment-600">Account</span>
                <p className="text-sm text-parchment-200 font-mono">{acct.accountName}</p>
              </div>
              <button onClick={() => copy(acct.accountName, `acct-${acct.id}`)} className="text-parchment-600 hover:text-parchment-400 transition-colors">
                {copiedField === `acct-${acct.id}` ? <Check className="h-3 w-3 text-forest-400" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
            {acct.password ? (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-parchment-600">Password</span>
                  <p className="text-sm text-parchment-200 font-mono">
                    {showPassword ? acct.password : "\u2022".repeat(Math.min(acct.password.length, 16))}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowPassword(!showPassword)} className="text-parchment-600 hover:text-parchment-400 transition-colors">
                    {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <button onClick={() => copy(acct.password, `pass-${acct.id}`)} className="text-parchment-600 hover:text-parchment-400 transition-colors">
                    {copiedField === `pass-${acct.id}` ? <Check className="h-3 w-3 text-forest-400" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <span className="text-[10px] text-parchment-600">Password</span>
                <p className="text-xs text-parchment-500 italic">Not stored. Use Reset Password to set a new one.</p>
              </div>
            )}

            {/* Reset password toggle */}
            {!showResetPw ? (
              <button
                onClick={() => setShowResetPw(true)}
                className="flex items-center gap-1.5 text-[10px] text-frost-400/60 hover:text-frost-400 transition-colors font-display uppercase tracking-wider mt-1"
              >
                <KeyRound className="h-3 w-3" />
                Reset Password
              </button>
            ) : (
              <div className="mt-2 space-y-2 pt-2 border-t border-frost-400/6">
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 8 chars)"
                    className="text-xs"
                  />
                  <Button onClick={handleResetPassword} disabled={resetLoading || newPassword.length < 8} size="sm" className="shrink-0">
                    {resetLoading ? "..." : "Set"}
                  </Button>
                  <button onClick={() => { setShowResetPw(false); setResetMsg(""); }} className="text-xs text-parchment-600 hover:text-parchment-400 shrink-0">
                    Cancel
                  </button>
                </div>
                {resetMsg && <p className={`text-xs ${resetMsg === "Password updated." ? "text-forest-400" : "text-burgundy-400"}`}>{resetMsg}</p>}
              </div>
            )}
          </div>

          {/* Config snippet */}
          <div>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="text-[10px] font-display uppercase tracking-wider text-parchment-500 hover:text-parchment-400 transition-colors flex items-center gap-1"
            >
              {showConfig ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              eqemu_config.json snippet
            </button>
            {showConfig && (
              <div className="mt-2 relative">
                <pre className="bg-[#0a0e17] border border-frost-400/6 rounded p-3 text-xs text-parchment-300 overflow-x-auto font-mono">
{`"loginserver2": {
  "host": "worldserver.eqemulator.dev",
  "port": "5998",
  "account": "${acct.accountName}",
  "password": "${configPassword}"
}`}
                </pre>
                <button
                  onClick={() => copy(`"loginserver2": {\n  "host": "worldserver.eqemulator.dev",\n  "port": "5998",\n  "account": "${acct.accountName}",\n  "password": "${configPassword}"\n}`, `config-${acct.id}`)}
                  className="absolute top-2 right-2 text-parchment-600 hover:text-parchment-400 transition-colors"
                >
                  {copiedField === `config-${acct.id}` ? <Check className="h-3 w-3 text-forest-400" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            )}
          </div>

          {/* Connected servers */}
          {acct.servers.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-display uppercase tracking-wider text-parchment-500">Connected Servers</span>
              {acct.servers.map((srv) => (
                <div key={srv.id} className="flex items-center justify-between bg-[#0a0e17] rounded px-3 py-2">
                  <div>
                    <p className="text-sm text-parchment-200">{srv.longName}</p>
                    <p className="text-[10px] text-parchment-600">{srv.shortName} &middot; {srv.lastIpAddress || "unknown"}</p>
                  </div>
                  <span className="text-[10px] font-display uppercase tracking-wider text-forest-400">Connected</span>
                </div>
              ))}
            </div>
          )}

          {/* Server Profile */}
          <div className="space-y-3 pt-2 border-t border-frost-400/6">
            <span className="text-[10px] font-display uppercase tracking-wider text-parchment-500">Server Profile</span>

            {/* Banner image */}
            <div>
              <label className="block text-[10px] font-display text-parchment-600 uppercase tracking-wider mb-1">Banner Image</label>
              {bannerUrl ? (
                <div className="relative rounded overflow-hidden border border-frost-400/10">
                  <img src={bannerUrl} alt="Server banner" className="w-full h-32 object-cover" />
                  <div className="absolute bottom-2 right-2 flex items-center gap-2">
                    <span className="text-[9px] text-parchment-500 bg-[#0a0e17]/70 rounded px-1.5 py-0.5">1200 &times; 400</span>
                    <label className="flex items-center gap-1.5 text-[10px] text-parchment-300 bg-[#0a0e17]/80 border border-frost-400/10 rounded px-2 py-1 cursor-pointer hover:bg-[#0a0e17] transition-colors">
                      <ImagePlus className="h-3 w-3" />
                      Replace
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleBannerUpload} className="hidden" />
                    </label>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-28 rounded border border-dashed border-frost-400/15 bg-[#0a0e17]/40 cursor-pointer hover:border-frost-400/30 transition-colors">
                  <ImagePlus className="h-5 w-5 text-parchment-600 mb-1" />
                  <span className="text-[10px] text-parchment-600">Click to upload banner image</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleBannerUpload} className="hidden" />
                </label>
              )}
              {bannerUploading && <p className="text-xs text-parchment-500 mt-1">Uploading...</p>}
              {bannerMsg && <p className={`text-xs mt-1 ${bannerMsg === "Banner uploaded." ? "text-forest-400" : "text-burgundy-400"}`}>{bannerMsg}</p>}
              <div className="mt-1.5 text-[10px] text-parchment-700 space-y-0.5">
                <p><span className="text-parchment-600">Dimensions:</span> Images are auto-resized to 1200 &times; 400px (3:1 ratio)</p>
                <p><span className="text-parchment-600">Max size:</span> 5 MB</p>
                <p><span className="text-parchment-600">Formats:</span> JPEG, PNG, WebP, or GIF</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-display text-parchment-600 uppercase tracking-wider mb-1">Website URL</label>
                <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://myserver.com" className="text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-display text-parchment-600 uppercase tracking-wider mb-1">Discord URL</label>
                <Input value={discordUrl} onChange={(e) => setDiscordUrl(e.target.value)} placeholder="https://discord.gg/..." className="text-xs" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-display text-parchment-600 uppercase tracking-wider mb-1">Expansion Era</label>
              <Input value={expansionEra} onChange={(e) => setExpansionEra(e.target.value)} placeholder="e.g. Classic, Kunark, Velious, Custom" className="text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-display text-parchment-600 uppercase tracking-wider mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your server — rules, features, community..."
                rows={5}
                className="w-full rounded border border-frost-400/10 bg-[#151b2a]/80 px-3 py-2 text-xs text-parchment-200 placeholder-obsidian-500 focus:border-frost-400/30 focus:outline-none focus:ring-1 focus:ring-frost-400/15 transition-all duration-200 resize-y"
              />
              <p className="text-[10px] text-parchment-700 mt-1">Basic HTML is allowed: <code className="text-parchment-600">&lt;b&gt;</code> <code className="text-parchment-600">&lt;i&gt;</code> <code className="text-parchment-600">&lt;a&gt;</code> <code className="text-parchment-600">&lt;br&gt;</code> <code className="text-parchment-600">&lt;ul&gt;</code> <code className="text-parchment-600">&lt;li&gt;</code> <code className="text-parchment-600">&lt;p&gt;</code></p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleSaveProfile} disabled={profileSaving} size="sm">
                <Save className="h-3 w-3 mr-1.5" />
                {profileSaving ? "Saving..." : "Save Profile"}
              </Button>
              {profileMsg && <span className={`text-xs ${profileMsg === "Saved." ? "text-forest-400" : "text-burgundy-400"}`}>{profileMsg}</span>}
            </div>
          </div>

          {/* Delete account */}
          <div className="pt-3 border-t border-frost-400/6">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-[10px] text-burgundy-400/50 hover:text-burgundy-400 transition-colors font-display uppercase tracking-wider"
              >
                <Trash2 className="h-3 w-3" />
                Delete Account
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-xs text-burgundy-400">Delete this account and all associated data?</span>
                <Button onClick={handleDelete} disabled={deleting} size="sm" className="bg-burgundy-600 hover:bg-burgundy-500 text-white">
                  {deleting ? "Deleting..." : "Confirm Delete"}
                </Button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-parchment-600 hover:text-parchment-400">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function WorldServerAccounts() {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function fetchAccounts() {
    try {
      const res = await fetch("/api/account/worldserver-accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAccounts(); }, []);

  async function handleCreate() {
    setError("");
    setCreating(true);
    try {
      const res = await fetch("/api/account/worldserver-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountName, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create account");
        return;
      }
      setAccountName("");
      setPassword("");
      setShowCreate(false);
      fetchAccounts();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <p className="text-parchment-500 text-sm">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded bg-burgundy-600/10 border border-burgundy-600/20 px-4 py-3 text-sm text-burgundy-400">
          {error}
        </div>
      )}

      {/* Existing accounts */}
      {accounts.map((acct) => (
        <AccountCard key={acct.id} acct={acct} onRefresh={fetchAccounts} />
      ))}

      {/* No accounts message */}
      {accounts.length === 0 && !showCreate && (
        <p className="text-parchment-500 text-sm">
          Create a world server account to authenticate your server and manage its listing.
        </p>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="rounded border border-frost-400/10 bg-[#0a0e16]/80 p-4 space-y-4">
          <h3 className="text-xs font-display font-semibold text-parchment-300 uppercase tracking-wider">
            New World Server Account
          </h3>
          <p className="text-parchment-500 text-xs">
            Creates credentials your world server uses to authenticate with the login server.
          </p>
          <div>
            <label className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-1.5">
              Account Name
            </label>
            <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="e.g. myserver" maxLength={30} />
            <p className="text-[10px] text-parchment-600 mt-1">Letters, numbers, underscores. 3-30 characters.</p>
          </div>
          <div>
            <label className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-1.5">
              Password
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-parchment-600 hover:text-parchment-400 transition-colors">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleCreate} disabled={creating || !accountName || !password} size="sm">
              {creating ? "Creating..." : "Create Account"}
            </Button>
            <button onClick={() => { setShowCreate(false); setError(""); }} className="text-xs text-parchment-600 hover:text-parchment-400 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Create button */}
      {!showCreate && (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 text-xs text-frost-400/70 hover:text-frost-400 transition-colors font-display tracking-wider uppercase"
        >
          <Plus className="h-3.5 w-3.5" />
          Create World Server Account
        </button>
      )}
    </div>
  );
}
