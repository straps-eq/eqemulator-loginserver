"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import Script from "next/script";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);

  const renderTurnstile = useCallback(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current || !(window as any).turnstile) return;
    turnstileRef.current.innerHTML = "";
    (window as any).turnstile.render(turnstileRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      callback: (token: string) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(""),
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (username.length < 3 || username.length > 30) {
      setError("Username must be 3–30 characters");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError("Username may only contain letters, numbers, and underscores");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Please complete the captcha");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/account/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, turnstileToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        return;
      }

      router.push("/login?registered=true&verify=true");
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <div className="text-center mb-8">
          <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-400/60 block mb-3">
            Register
          </span>
          <h1 className="font-display text-2xl font-bold text-parchment-100 mb-2">
            Create an EQEmulator.dev Account
          </h1>
          <p className="text-parchment-500 text-sm">
            For server operators to claim and manage their server listings
          </p>
        </div>

        <div className="rounded-lg border border-frost-400/8 bg-gradient-to-b from-[#171d2d]/90 to-[#131825]/95 p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded bg-burgundy-600/10 border border-burgundy-600/20 px-4 py-3 text-sm text-burgundy-400">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="username" className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-2">
                Username
              </label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                required
                autoComplete="username"
              />
              <p className="text-[11px] text-parchment-600 mt-1.5">Letters, numbers, and underscores only</p>
            </div>
            <div>
              <label htmlFor="email" className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-2">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoComplete="email"
              />
              <p className="text-[11px] text-parchment-600 mt-1.5">Used for verification and account recovery</p>
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
                placeholder="Minimum 8 characters"
                required
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-xs font-display font-medium text-parchment-400 uppercase tracking-wider mb-2">
                Confirm Password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                autoComplete="new-password"
              />
            </div>
            {TURNSTILE_SITE_KEY && (
              <>
                <Script
                  src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                  onReady={renderTurnstile}
                />
                <div ref={turnstileRef} className="flex justify-center" />
              </>
            )}
            <div className="pt-2">
              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? "Creating account..." : "Create Account"}
              </Button>
            </div>
          </form>
        </div>

        <p className="text-center text-sm text-parchment-500 mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-frost-400 hover:text-frost-300 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </>
  );
}
