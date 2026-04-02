import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { Shield, Lock, Eye, Key, Server, CheckCircle, AlertTriangle } from "lucide-react";

export const metadata: Metadata = {
  title: "Security — How We Protect Your Account",
  description:
    "How EQEmulator.dev protects your EverQuest account and data. Scrypt password hashing, encrypted sessions, rate limiting, and federated security model.",
  openGraph: {
    title: "Security — How EQEmulator.dev Protects Your Account",
    description: "Scrypt password hashing, encrypted sessions, rate limiting, and federated security model.",
  },
};

export default async function SecurityPage() {
  const session = await getSession();

  return (
    <>
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />

      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="font-display text-[10px] tracking-[0.35em] uppercase text-frost-400/50 block mb-3">
            Security
          </span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-parchment-100 mb-4">
            How We Protect Your Data
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-parchment-400/80 leading-relaxed">
            Security isn&apos;t an afterthought — it&apos;s built into every layer of the platform.
            Here&apos;s an overview of the measures in place to keep your account and data safe.
          </p>
        </div>

        {/* Account Security */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-5">
            <div className="inline-flex items-center justify-center w-8 h-8 rounded border border-frost-400/15 bg-frost-400/5">
              <Key className="h-4 w-4 text-frost-400/70" />
            </div>
            <h2 className="font-display text-lg font-semibold text-parchment-100">Account Security</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                title: "Strong Password Hashing",
                desc: "Passwords are hashed using modern, computationally expensive algorithms. Even if database data were exposed, passwords cannot be reversed.",
              },
              {
                title: "Multi-Factor Authentication",
                desc: "Admin and server operator accounts require email verification on every login. A one-time code is sent to your registered email before access is granted.",
              },
              {
                title: "Rate-Limited Login",
                desc: "Login attempts are rate-limited per IP address. Brute-force attacks are blocked before they can make meaningful progress.",
              },
              {
                title: "Email Verification",
                desc: "All accounts must verify their email address before they can log in. This prevents impersonation and ensures account recovery is possible.",
              },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-lg border border-frost-400/6 bg-[#0a0e16]/60 p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-200 mb-2">{title}</h3>
                <p className="text-xs text-parchment-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Federation Security */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-5">
            <div className="inline-flex items-center justify-center w-8 h-8 rounded border border-frost-400/15 bg-frost-400/5">
              <Server className="h-4 w-4 text-frost-400/70" />
            </div>
            <h2 className="font-display text-lg font-semibold text-parchment-100">Federation Security</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                title: "Cryptographic Authentication",
                desc: "Every node in the federation authenticates using public-key cryptography. Requests are digitally signed and verified — no node can impersonate another.",
              },
              {
                title: "Tiered Trust Model",
                desc: "Nodes are classified into trust tiers. Only vetted official nodes can push changes to the network. Community mesh nodes are read-only — they receive data but cannot modify the authoritative dataset.",
              },
              {
                title: "Replay Protection",
                desc: "Every federation request includes a unique signature and timestamp. Replayed or tampered requests are automatically detected and rejected.",
              },
              {
                title: "Hash Strength Enforcement",
                desc: "Only modern, computationally expensive password hashes are allowed to sync across the federation. Weak or outdated hash formats are automatically rejected at both ends.",
              },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-lg border border-frost-400/6 bg-[#0a0e16]/60 p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-200 mb-2">{title}</h3>
                <p className="text-xs text-parchment-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Data Protection */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-5">
            <div className="inline-flex items-center justify-center w-8 h-8 rounded border border-frost-400/15 bg-frost-400/5">
              <Lock className="h-4 w-4 text-frost-400/70" />
            </div>
            <h2 className="font-display text-lg font-semibold text-parchment-100">Data Protection</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                title: "Encryption at Rest",
                desc: "Sensitive data is encrypted before it reaches the database. Even with direct database access, sensitive fields are unreadable without the encryption keys.",
              },
              {
                title: "Encryption in Transit",
                desc: "All connections use TLS encryption. Data moving between your browser and our servers, and between federation nodes, is encrypted end-to-end.",
              },
              {
                title: "No PII Leakage",
                desc: "IP addresses and other personally identifiable information are stripped from all public API responses and from data that syncs across the federation.",
              },
              {
                title: "Audit Logging",
                desc: "Security-relevant events are logged and retained for monitoring. This includes federation sync events, authentication attempts, and administrative actions.",
              },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-lg border border-frost-400/6 bg-[#0a0e16]/60 p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-200 mb-2">{title}</h3>
                <p className="text-xs text-parchment-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Infrastructure */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-5">
            <div className="inline-flex items-center justify-center w-8 h-8 rounded border border-frost-400/15 bg-frost-400/5">
              <Eye className="h-4 w-4 text-frost-400/70" />
            </div>
            <h2 className="font-display text-lg font-semibold text-parchment-100">Infrastructure</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                title: "Cloudflare Protection",
                desc: "The platform sits behind Cloudflare's global network, providing DDoS mitigation, Web Application Firewall (WAF), and bot protection at the edge.",
              },
              {
                title: "Restricted Internal Services",
                desc: "Internal services like metrics and monitoring endpoints are not accessible from the public internet. Only authorized internal systems can access them.",
              },
              {
                title: "Rate Limiting",
                desc: "All sensitive endpoints are rate-limited to prevent abuse. This includes login, registration, account operations, and federation API endpoints.",
              },
              {
                title: "Open Source",
                desc: "The entire platform is open source on GitHub. Security through obscurity is not our model — we believe transparency makes software more secure, not less.",
              },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-lg border border-frost-400/6 bg-[#0a0e16]/60 p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-200 mb-2">{title}</h3>
                <p className="text-xs text-parchment-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* What we don't do */}
        <section className="mb-12">
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/60 p-6 sm:p-8">
            <h2 className="font-display text-lg font-semibold text-parchment-100 mb-4">
              What We Don&apos;t Do
            </h2>
            <div className="space-y-3">
              {[
                "We don't store your password in plain text — ever.",
                "We don't share your email with third parties.",
                "We don't track you across the web or sell analytics data.",
                "We don't expose IP addresses in public APIs or federation sync.",
                "We don't allow weak or outdated password hashes to propagate across the network.",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2.5">
                  <CheckCircle className="h-4 w-4 text-forest-400/70 mt-0.5 shrink-0" />
                  <p className="text-sm text-parchment-400/80">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Report */}
        <section>
          <div className="rounded-lg border border-amber-400/10 bg-amber-400/[0.02] p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400/70 mt-0.5 shrink-0" />
              <div>
                <h2 className="font-display text-lg font-semibold text-parchment-100 mb-2">
                  Report a Security Issue
                </h2>
                <p className="text-sm text-parchment-400/80 leading-relaxed">
                  If you discover a security vulnerability, please report it responsibly.
                  Contact us on{" "}
                  <a href="https://discord.gg/6T4n3DdPVB" target="_blank" rel="noopener noreferrer" className="text-frost-400 hover:text-frost-300 transition-colors">
                    Discord
                  </a>{" "}
                  or open a private security advisory on{" "}
                  <a href="https://github.com/EQEmu" target="_blank" rel="noopener noreferrer" className="text-frost-400 hover:text-frost-300 transition-colors">
                    GitHub
                  </a>.
                  We take all reports seriously and will respond promptly.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
