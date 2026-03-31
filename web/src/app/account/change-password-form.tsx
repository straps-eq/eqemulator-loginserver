"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Key } from "lucide-react";

export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [open]);

  function handleClose() {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setSuccess("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Password change failed");
        return;
      }

      setSuccess("Password updated successfully");
      setTimeout(handleClose, 1500);
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Key className="h-3.5 w-3.5 mr-1.5" />
        Change Password
      </Button>

      <dialog
        ref={dialogRef}
        onClose={handleClose}
        className="backdrop:bg-black/60 bg-transparent p-0 m-auto"
      >
        <div className="w-[24rem] rounded-lg border border-frost-400/10 bg-gradient-to-b from-[#171d2d] to-[#131825] p-6 shadow-2xl">
          <h3 className="font-display text-sm font-semibold text-parchment-200 uppercase tracking-wider mb-5">
            Change Password
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded bg-burgundy-600/10 border border-burgundy-600/20 px-3 py-2 text-xs text-burgundy-400">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded bg-forest-600/10 border border-forest-600/20 px-3 py-2 text-xs text-forest-400">
                {success}
              </div>
            )}
            <div>
              <label className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-1.5">
                Current Password
              </label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoFocus
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-1.5">
                New Password
              </label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-1.5">
                Confirm New Password
              </label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? "Updating..." : "Update Password"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
