import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { Compass, Shield, Activity, Settings } from "lucide-react";
import { LiveStats } from "./live-stats";
import { StatusIndicator } from "./status-indicator";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "EQEmulator.dev",
  url: "https://eqemulator.dev",
  description: "EverQuest private server directory and community login infrastructure with live player counts.",
  potentialAction: {
    "@type": "SearchAction",
    target: "https://eqemulator.dev/servers?q={search_term_string}",
    "query-input": "required name=search_term_string",
  },
};

export default async function HomePage() {
  const session = await getSession();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-5xl px-4 py-16 sm:py-24 sm:px-6 lg:px-8 text-center">
          <div className="mb-4">
            <span className="inline-block font-display text-[10px] tracking-[0.35em] uppercase text-frost-400/50">
              EverQuest Emulator
            </span>
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-5">
            <span className="text-parchment-100">Server Directory</span>
            <br />
            <span className="text-frost-300/70 text-2xl sm:text-3xl lg:text-4xl font-normal">
              & Login Infrastructure
            </span>
          </h1>
          <p className="mx-auto max-w-xl text-sm text-parchment-400/80 mb-8 leading-relaxed">
            Browse EverQuest private servers with live telemetry.
            Compatible with existing eqemulator.net accounts — just update your eqhost.txt and play.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/servers"
              className="rounded border border-frost-400/25 bg-frost-400/5 px-10 py-3.5 text-sm font-display font-medium tracking-wider uppercase text-frost-300 hover:bg-frost-400/10 hover:border-frost-400/40 hover:shadow-[0_0_20px_rgba(52,187,250,0.12)] transition-all duration-300"
            >
              Browse Servers
            </Link>
            <Link
              href="/server-operators"
              className="rounded border border-parchment-600/15 px-10 py-3.5 text-sm font-display font-medium tracking-wider uppercase text-parchment-400 hover:border-parchment-500/25 hover:text-parchment-300 transition-all duration-300"
            >
              Server Operators
            </Link>
          </div>
          <LiveStats />
          <StatusIndicator />
        </div>
        <div className="mx-auto max-w-3xl mt-1 h-px bg-gradient-to-r from-transparent via-frost-400/10 to-transparent" />
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Compass, label: "Server Directory", desc: "Browse active worlds with live population counts and server profiles.", color: "frost" },
            { icon: Shield, label: "Account Compatible", desc: "Your existing eqemulator.net login works here automatically. No re-registration required.", color: "arcane" },
            { icon: Settings, label: "Operator Tools", desc: "Claim your server, manage your listing, and customize your server profile.", color: "arcane" },
            { icon: Activity, label: "Status & Uptime", desc: "Public uptime monitoring, performance metrics, and service health dashboard.", color: "frost" },
          ].map(({ icon: Icon, label, desc, color }) => (
            <div key={label} className="relative group rounded-lg border border-frost-400/6 bg-[#0a0e16]/60 p-5 hover:border-frost-400/15 transition-all duration-500">
              <div className="absolute top-0 left-0 w-8 h-px bg-gradient-to-r from-frost-400/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute top-0 left-0 h-8 w-px bg-gradient-to-b from-frost-400/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className={`inline-flex items-center justify-center w-9 h-9 rounded border mb-4 ${
                color === "frost" ? "border-frost-400/15 bg-frost-400/5" : "border-arcane-400/15 bg-arcane-400/5"
              }`}>
                <Icon className={`h-4 w-4 ${color === "frost" ? "text-frost-400/70" : "text-arcane-400/70"}`} />
              </div>
              <h3 className="font-display text-sm font-semibold text-parchment-200 mb-1.5">{label}</h3>
              <p className="text-parchment-500 text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Start - Players */}
      <section className="relative">
        <div className="mx-auto max-w-3xl h-px bg-gradient-to-r from-transparent via-frost-400/8 to-transparent" />
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="font-display text-[10px] tracking-[0.35em] uppercase text-frost-400/40 block mb-3">
              For Players
            </span>
            <h2 className="font-display text-2xl font-bold text-parchment-100 mb-3">Connect in Two Steps</h2>
            <p className="text-parchment-500 text-sm">Your existing eqemulator.net account works automatically.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {[
              { n: "01", title: "Update eqhost.txt", desc: <span>Point your client to <code className="text-frost-400/80 bg-[#0a0e16] px-1 py-0.5 rounded text-[10px] font-mono">login.eqemulator.dev:5999</code></span> },
              { n: "02", title: "Launch & Play", desc: "Log in with your existing credentials and choose a server." },
            ].map(({ n, title, desc }) => (
              <div key={n} className="text-center">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded border border-frost-400/15 bg-frost-400/5 font-mono text-frost-400/60 text-xs mb-4">
                  {n}
                </div>
                <h3 className="font-display text-sm font-semibold text-parchment-200 mb-1.5">{title}</h3>
                <p className="text-parchment-500 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link
              href="/getting-started"
              className="hover-frost text-xs font-display tracking-[0.15em] uppercase text-parchment-600"
            >
              Full setup guide →
            </Link>
          </div>
        </div>
      </section>

      {/* For Server Operators */}
      <section className="relative">
        <div className="mx-auto max-w-3xl h-px bg-gradient-to-r from-transparent via-frost-400/8 to-transparent" />
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="font-display text-[10px] tracking-[0.35em] uppercase text-arcane-400/40 block mb-3">
              For Server Operators
            </span>
            <h2 className="font-display text-2xl font-bold text-parchment-100 mb-3">List Your Server</h2>
            <p className="text-parchment-500 text-sm">One config line. No registration required. Your server appears instantly.</p>
          </div>
          <div className="max-w-2xl mx-auto">
            <pre className="bg-[#0a0e17] border border-frost-400/6 rounded-lg p-5 text-sm text-parchment-300 overflow-x-auto font-mono mb-6">
{`"loginserver2": {
  "host": "worldserver.eqemulator.dev",
  "port": "5998"
}`}
            </pre>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div>
                <p className="font-display text-sm font-semibold text-parchment-200 mb-1">Runs Alongside</p>
                <p className="text-parchment-500 text-xs">Keep eqemulator.net as loginserver1</p>
              </div>
              <div>
                <p className="font-display text-sm font-semibold text-parchment-200 mb-1">Account Compatible</p>
                <p className="text-parchment-500 text-xs">Player eqemulator.net logins work here</p>
              </div>
              <div>
                <p className="font-display text-sm font-semibold text-parchment-200 mb-1">Claim Your Profile</p>
                <p className="text-parchment-500 text-xs">Manage description, links, and branding</p>
              </div>
            </div>
          </div>
          <div className="text-center mt-8">
            <Link
              href="/server-operators"
              className="hover-frost text-xs font-display tracking-[0.15em] uppercase text-parchment-600"
            >
              Full operator guide →
            </Link>
          </div>
        </div>
        <div className="mx-auto max-w-3xl h-px bg-gradient-to-r from-transparent via-frost-400/8 to-transparent" />
      </section>

      {/* Footer */}
      <footer className="mt-6">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="font-display text-xs tracking-wider text-parchment-700">EQEmulator</span>
              <span className="text-frost-400/10">|</span>
              <p className="text-parchment-700 text-[10px]">
                Not affiliated with Daybreak Game Company
              </p>
            </div>
            <div className="flex items-center gap-4">
              {[
                { href: "/servers", label: "Servers" },
                { href: "/getting-started", label: "Getting Started" },
                { href: "/server-operators", label: "Server Ops" },
                { href: "/status", label: "Status" },
              ].map(({ href, label }) => (
                <Link key={href} href={href} className="hover-frost text-parchment-700 text-[10px] uppercase tracking-wider transition-colors">
                  {label}
                </Link>
              ))}
              <a href="https://discord.gg/6T4n3DdPVB" target="_blank" rel="noopener noreferrer" className="hover-frost text-parchment-700 text-[10px] uppercase tracking-wider transition-colors">
                Discord
              </a>
              <a href="https://github.com/EQEmu" target="_blank" rel="noopener noreferrer" className="hover-frost text-parchment-700 text-[10px] uppercase tracking-wider transition-colors">
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
