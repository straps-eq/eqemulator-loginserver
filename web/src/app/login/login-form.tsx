"use client";

import { useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" fill="#5865F2"/>
    </svg>
  );
}

function oauthErrorMessage(code: string): string {
  switch (code) {
    case "invalid_provider": return "Invalid sign-in provider.";
    case "rate_limited": return "Too many attempts. Try again later.";
    case "missing_params": return "Authentication failed — missing parameters.";
    case "invalid_state": return "Authentication failed — please try again.";
    case "missing_verifier": return "Authentication failed — please try again.";
    case "auth_failed": return "Authentication failed — could not verify with provider.";
    case "account_not_found": return "Account not found — please contact support.";
    default: return "Authentication failed. Please try again.";
  }
}

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered");
  const needsVerify = searchParams.get("verify");
  const oauthError = searchParams.get("error");
  const mfaFromOAuth = searchParams.get("mfa") === "true";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(oauthError ? oauthErrorMessage(oauthError) : "");
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendStatus, setResendStatus] = useState<"" | "sending" | "sent" | "error">("")
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);

  // MFA state
  const [mfaRequired, setMfaRequired] = useState(mfaFromOAuth);
  const [mfaEmailHint, setMfaEmailHint] = useState(mfaFromOAuth ? "your registered email" : "");
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
            <div className="space-y-4">
              {/* OAuth buttons */}
              <a
                href="/api/auth/google"
                className="flex items-center justify-center gap-3 w-full rounded-md border border-frost-400/15 bg-[#0a0e17]/60 hover:bg-[#0a0e17]/90 px-4 py-3 text-sm font-medium text-parchment-200 transition-colors"
              >
                <GoogleIcon className="h-5 w-5" />
                Sign in with Google
              </a>
              <a
                href="/api/auth/discord"
                className="flex items-center justify-center gap-3 w-full rounded-md border border-[#5865F2]/30 bg-[#5865F2]/10 hover:bg-[#5865F2]/20 px-4 py-3 text-sm font-medium text-parchment-200 transition-colors"
              >
                <DiscordIcon className="h-5 w-5" />
                Sign in with Discord
              </a>

              {/* Transitional password login for existing users */}
              {!showPasswordLogin ? (
                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => setShowPasswordLogin(true)}
                    className="text-xs text-parchment-600 hover:text-parchment-400 transition-colors"
                  >
                    Sign in with password (existing accounts)
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 pt-2">
                    <div className="h-px flex-1 bg-frost-400/10" />
                    <span className="text-[10px] uppercase tracking-widest text-parchment-600">or password</span>
                    <div className="h-px flex-1 bg-frost-400/10" />
                  </div>
                  <form onSubmit={handleLogin} className="space-y-4">
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
                    <div className="pt-1">
                      <Button type="submit" className="w-full" size="lg" disabled={loading}>
                        {loading ? "Signing in..." : "Sign In"}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </div>
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
          <p className="text-center text-xs text-parchment-600 mt-6">
            Sign in with Google or Discord to create an account automatically
          </p>
        )}
      </div>
    </>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={null}>
      <LoginFormInner />
    </Suspense>
  );
}
