import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { Compass, Download, FileText, Play, ShieldCheck, Users } from "lucide-react";
import { LiveStats } from "./live-stats";
import { StatusIndicator } from "./status-indicator";
import { serializeJsonLd } from "@/lib/json-ld";
import { getPublicServerList, type PublicServer } from "@/lib/public-servers";
import { serverPath } from "@/lib/slug";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "EQEmulator.dev",
  url: "https://eqemulator.dev",
  description: "EQ Emulator server directory with live player counts, setup guides and a community login server.",
  potentialAction: {
    "@type": "SearchAction",
    target: "https://eqemulator.dev/servers?q={search_term_string}",
    "query-input": "required name=search_term_string",
  },
};

const TOP_WORLDS = 6;

export default async function HomePage() {
  const [session, servers] = await Promise.all([
    getSession(),
    getPublicServerList().catch(() => [] as PublicServer[]),
  ]);

  const online = servers.filter((s) => s.server_status > 0 && !s.is_offline);
  const totalPlayers = online.reduce((sum, s) => sum + (s.players_online ?? 0), 0);
  const topWorlds = [...online]
    .sort((a, b) => (b.players_online ?? 0) - (a.players_online ?? 0))
    .slice(0, TOP_WORLDS);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />

      {/* Welcome */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-4xl px-4 py-12 sm:py-16 sm:px-6 lg:px-8 text-center">
          <p className="font-display text-xs tracking-[0.3em] uppercase text-frost-300/70 mb-4">
            Welcome to EQ Emulator
          </p>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-parchment-100 mb-4">
            Play EQ again. <span className="text-gold-gradient">Free, and run by players.</span>
          </h1>
          <p className="mx-auto max-w-xl text-base text-parchment-300 mb-7 leading-relaxed">
            Pick a world, point your game at it, and you&apos;re in.
            Already have an EQEmu login? It works here.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/servers"
              className="rounded border border-frost-400/25 bg-frost-400/5 px-10 py-3.5 text-sm font-display font-medium tracking-wider uppercase text-frost-300 hover:bg-frost-400/10 hover:border-frost-400/40 hover:shadow-[0_0_20px_rgba(52,187,250,0.12)] transition-all duration-300"
            >
              Find a world
            </Link>
            <Link
              href="/getting-started"
              className="rounded border border-parchment-600/15 px-10 py-3.5 text-sm font-display font-medium tracking-wider uppercase text-parchment-300 hover:border-parchment-500/25 hover:text-parchment-100 transition-all duration-300"
            >
              How to play
            </Link>
          </div>
          <LiveStats />
          <StatusIndicator />
        </div>
        <div className="mx-auto max-w-3xl mt-1 h-px bg-gradient-to-r from-transparent via-frost-400/10 to-transparent" />
      </section>

      {/* Top worlds right now */}
      <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-400/60 block mb-2">
              Playing right now
            </span>
            <h2 className="font-display text-2xl font-bold text-parchment-100">
              {online.length > 0
                ? `${totalPlayers.toLocaleString()} adventurers across ${online.length} ${online.length === 1 ? "world" : "worlds"}`
                : "Worlds on EQ Emulator"}
            </h2>
          </div>
          <Link href="/servers" className="hover-frost text-xs font-display tracking-[0.15em] uppercase text-parchment-500 whitespace-nowrap">
            All servers →
          </Link>
        </div>

        {topWorlds.length === 0 ? (
          <div className="rounded-lg border border-frost-400/15 bg-[#121a2a]/85 p-10 text-center">
            <Compass className="h-8 w-8 text-parchment-700 mx-auto mb-3" />
            <p className="text-parchment-500 text-sm">
              The live list is loading. <Link href="/servers" className="text-frost-400 hover:text-frost-300">Open the server directory</Link>.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topWorlds.map((s) => (
              <li key={s.server_short_name}>
                <Link
                  href={serverPath(s.server_long_name)}
                  className="group flex h-full flex-col justify-between rounded-lg border border-frost-400/15 bg-[#121a2a]/85 p-4 hover:border-frost-400/25 hover:bg-frost-400/[0.03] transition-all duration-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-sm font-semibold text-parchment-100 truncate group-hover:text-frost-200">
                          {s.server_long_name}
                        </span>
                        {s.is_trusted && <ShieldCheck className="h-3.5 w-3.5 text-forest-400 flex-shrink-0" aria-label="Verified operator" />}
                      </div>
                      {s.tag_description && (
                        <p className="text-xs text-parchment-500 truncate mt-0.5">{s.tag_description}</p>
                      )}
                    </div>
                    <span className="h-2 w-2 mt-1.5 rounded-full flex-shrink-0 bg-forest-500" aria-hidden="true" />
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 text-sm">
                    <Users className="h-3.5 w-3.5 text-frost-400/60" aria-hidden="true" />
                    {s.show_player_count === false ? (
                      <span className="text-parchment-600">Online</span>
                    ) : (
                      <>
                        <span className="font-display font-bold text-frost-300">{s.players_online ?? 0}</span>
                        <span className="text-parchment-500">online</span>
                      </>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* New here? Three steps */}
      <section className="relative">
        <div className="mx-auto max-w-3xl h-px bg-gradient-to-r from-transparent via-frost-400/8 to-transparent" />
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <span className="font-display text-xs tracking-[0.35em] uppercase text-frost-400/50 block mb-3">
              New here?
            </span>
            <h2 className="font-display text-2xl font-bold text-parchment-100 mb-3">Playing takes three steps</h2>
            <p className="text-parchment-300 text-sm max-w-xl mx-auto">
              No subscription and no launcher. You need your own copy of the game, a one-line edit, and a login.
            </p>
          </div>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                n: "1",
                icon: Download,
                title: "Get the game",
                desc: "Most worlds use the Rain of Fear 2 client. Titanium, The Outer Brood and the live client are supported too. Each world's page says which one it wants.",
              },
              {
                n: "2",
                icon: FileText,
                title: "Point it at us",
                desc: (
                  <>
                    Edit <code className="text-frost-400/90 bg-[#080b12] px-1 py-0.5 rounded text-[11px] font-mono">eqhost.txt</code> in your
                    game folder to <code className="text-frost-400/90 bg-[#080b12] px-1 py-0.5 rounded text-[11px] font-mono">login.eqemulator.dev:5999</code>.
                    The guide picks the right port for your client.
                  </>
                ),
              },
              {
                n: "3",
                icon: Play,
                title: "Log in and play",
                desc: "Create a login here, or use the one you already have from the EQEmulator forums. Choose a world from the list in the game and go.",
              },
            ].map(({ n, icon: Icon, title, desc }) => (
              <li key={n} className="relative rounded-lg border border-frost-400/15 bg-[#121a2a]/85 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded border border-frost-400/15 bg-frost-400/5 font-mono text-frost-400/70 text-xs">
                    {n}
                  </span>
                  <Icon className="h-4 w-4 text-frost-400/60" aria-hidden="true" />
                  <h3 className="font-display text-sm font-semibold text-parchment-100">{title}</h3>
                </div>
                <p className="text-parchment-300 text-sm leading-relaxed">{desc}</p>
              </li>
            ))}
          </ol>
          <div className="text-center mt-8">
            <Link
              href="/getting-started"
              className="rounded border border-frost-400/25 bg-frost-400/5 px-8 py-3 text-xs font-display font-medium tracking-wider uppercase text-frost-300 hover:bg-frost-400/10 hover:border-frost-400/40 transition-all duration-300"
            >
              Full setup guide
            </Link>
          </div>
        </div>
      </section>

      {/* Why here */}
      <section className="relative">
        <div className="mx-auto max-w-3xl h-px bg-gradient-to-r from-transparent via-frost-400/8 to-transparent" />
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center md:text-left">
            {[
              { title: "Live, not a list", desc: "Player counts and status come straight from the worlds, updated every few seconds, with population history on every server page." },
              { title: "Every client welcome", desc: "Titanium, RoF2, The Outer Brood and the current live client all log in here. One login works on every world in the directory." },
              { title: "Built by the community", desc: "Open source, run by players, and compatible with the EQEmulator forum logins people have used for twenty years." },
            ].map(({ title, desc }) => (
              <div key={title}>
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-2">{title}</h3>
                <p className="text-parchment-300 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-parchment-500 text-sm mt-12">
            Run a world of your own?{" "}
            <Link href="/server-operators" className="text-frost-400 hover:text-frost-300">
              List it here with one line of config
            </Link>
            .
          </p>
        </div>
        <div className="mx-auto max-w-3xl h-px bg-gradient-to-r from-transparent via-frost-400/8 to-transparent" />
      </section>

      {/* Footer */}
      <footer className="mt-6">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-2">
              {[
                { href: "/servers", label: "Servers" },
                { href: "/getting-started", label: "Getting Started" },
                { href: "/server-operators", label: "Server Ops" },
                { href: "/about", label: "About" },
                { href: "/status", label: "Status" },
              ].map(({ href, label }) => (
                <Link key={href} href={href} className="hover-frost text-parchment-600 text-xs uppercase tracking-wider transition-colors">
                  {label}
                </Link>
              ))}
              <a href="https://discord.gg/6T4n3DdPVB" target="_blank" rel="noopener noreferrer" className="hover-frost text-parchment-600 text-xs uppercase tracking-wider transition-colors">
                Discord
              </a>
              <a href="https://github.com/straps-eq/eqemulator-loginserver" target="_blank" rel="noopener noreferrer" className="hover-frost text-parchment-600 text-xs uppercase tracking-wider transition-colors">
                GitHub
              </a>
            </div>
          </div>
          <p className="text-parchment-700 text-[11px] leading-relaxed mt-6 max-w-3xl">
            EQEmulator.dev is a community project and is not affiliated with, endorsed by, or sponsored by
            Daybreak Game Company LLC. EverQuest is a registered trademark of Daybreak Game Company LLC.
            Playing on emulated servers requires your own copy of the game.
          </p>
        </div>
      </footer>
    </>
  );
}
