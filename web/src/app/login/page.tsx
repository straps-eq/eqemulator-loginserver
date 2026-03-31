"use client";

import { useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered");
  const needsVerify = searchParams.get("verify");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendStatus, setResendStatus] = useState<"" | "sending" | "sent" | "error">("")


  // MFA state
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaEmailHint, setMfaEmailHint] = useState("");
  const [mfaCode, setMfaCode] = useState(["", "", "", "", "", ""]);
  const codeInputs = useRef<(HTMLInputElement | null)[]>([]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        setNeedsVerification(res.status === 403 && (data.error || "").includes("verify"));
        return;
      }

      if (data.mfa_required) {
        setMfaRequired(true);
        setMfaEmailHint(data.email_hint || "");
        setMfaCode(["", "", "", "", "", ""]);
        setTimeout(() => codeInputs.current[0]?.focus(), 100);
        return;
      }

      router.push("/account");
      router.refresh();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const code = mfaCode.join("");
    if (code.length !== 6) {
      setError("Please enter the full 6-digit code");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/account/verify-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Verification failed");
        if (data.error?.includes("log in again") || data.error?.includes("expired")) {
          setMfaRequired(false);
          setMfaCode(["", "", "", "", "", ""]);
        }
        return;
      }

      router.push("/account");
      router.refresh();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  function handleCodeChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const digit = value.slice(-1);
    const next = [...mfaCode];
    next[index] = digit;
    setMfaCode(next);
    if (digit && index < 5) {
      codeInputs.current[index + 1]?.focus();
    }
  }

  function handleCodeKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !mfaCode[index] && index > 0) {
      codeInputs.current[index - 1]?.focus();
    }
  }

  function handleCodePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length > 0) {
      const next = [...mfaCode];
      for (let i = 0; i < pasted.length && i < 6; i++) {
        next[i] = pasted[i];
      }
      setMfaCode(next);
      const focusIdx = Math.min(pasted.length, 5);
      codeInputs.current[focusIdx]?.focus();
    }
  }

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <div className="text-center mb-8">
          <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-400/60 block mb-3">
            {mfaRequired ? "Verification" : "Sign In"}
          </span>
          <h1 className="font-display text-2xl font-bold text-parchment-100 mb-2">
            {mfaRequired ? "Check Your Email" : "EQEmulator.dev Account"}
          </h1>
          <p className="text-parchment-500 text-sm">
            {mfaRequired
              ? `We sent a 6-digit code to ${mfaEmailHint}`
              : "Manage your server listings and operator settings"}
          </p>
        </div>

        <div className="rounded-lg border border-frost-400/8 bg-gradient-to-b from-[#171d2d]/90 to-[#131825]/95 p-6 sm:p-8">
          {!mfaRequired && registered && (
            <div className="rounded bg-forest-600/10 border border-forest-600/20 px-4 py-3 text-sm text-forest-400 mb-5">
              {needsVerify
                ? "Account created! Check your email for a verification link before logging in."
                : "Account created successfully! You can now log in."}
            </div>
          )}

          {error && (
            <div className="rounded bg-burgundy-600/10 border border-burgundy-600/20 px-4 py-3 text-sm text-burgundy-400 mb-5">
              {error}
              {needsVerification && (
                <button
                  type="button"
                  disabled={resendStatus === "sending" || resendStatus === "sent"}
                  onClick={async () => {
                    setResendStatus("sending");
                    try {
                      const res = await fetch("/api/account/resend-verification", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ username }),
                      });
                      if (res.ok) {
                        setResendStatus("sent");
                      } else {
                        const data = await res.json();
                        setResendStatus("error");
                        setError(data.error || "Failed to resend verification email");
                      }
                    } catch {
                      setResendStatus("error");
                    }
                  }}
                  className="block mt-2 text-xs text-frost-400 hover:text-frost-300 underline underline-offset-2 transition-colors disabled:opacity-50 disabled:no-underline"
                >
                  {resendStatus === "sending"
                    ? "Sending..."
                    : resendStatus === "sent"
                    ? "✓ Verification email sent — check your inbox"
                    : "Resend verification email"}
                </button>
              )}
            </div>
          )}

          {!mfaRequired ? (
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label htmlFor="username" className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-2">
                  Username
                </label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your username"
                  required
                  autoComplete="username"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-2">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                  autoComplete="current-password"
                />
              </div>
              <div className="pt-2">
                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleMfaSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-3 text-center">
                  Verification Code
                </label>
                <div className="flex justify-center gap-2" onPaste={handleCodePaste}>
                  {mfaCode.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { codeInputs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleCodeChange(i, e.target.value)}
                      onKeyDown={(e) => handleCodeKeyDown(i, e)}
                      className="w-11 h-13 text-center text-xl font-mono font-bold rounded-md border border-frost-400/15 bg-[#0a0e17]/80 text-parchment-100 focus:border-frost-400/40 focus:outline-none focus:ring-1 focus:ring-frost-400/20 transition-colors"
                    />
                  ))}
                </div>
                <p className="text-[11px] text-parchment-600 text-center mt-3">
                  Code expires in 5 minutes
                </p>
              </div>
              <div className="pt-2">
                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  {loading ? "Verifying..." : "Verify & Sign In"}
                </Button>
              </div>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMfaRequired(false);
                    setMfaCode(["", "", "", "", "", ""]);
                    setError("");
                  }}
                  className="text-xs text-parchment-600 hover:text-parchment-400 transition-colors"
                >
                  Back to login
                </button>
              </div>
            </form>
          )}
        </div>

        {!mfaRequired && (
          <p className="text-center text-sm text-parchment-500 mt-6">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="text-frost-400 hover:text-frost-300 transition-colors">
              Register
            </Link>
          </p>
        )}
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
