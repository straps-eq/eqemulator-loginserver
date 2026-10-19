import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { ArrowRight, BookOpen, Compass, Download, FileText, Play, Server as ServerIcon, ShieldCheck, Sparkles, User, Users } from "lucide-react";
import { LiveStats } from "./live-stats";
import Image from "next/image";
import { serializeJsonLd } from "@/lib/json-ld";
import { APP_VERSION } from "@/lib/version";
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
      <section className="relative -mt-16 overflow-hidden">
        <Image
          src="/hero-norrath.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[65%_center]"
        />
        {/* Shade the left side for the text, and fade into the page at the bottom */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0d1226]/80 via-[#0d1226]/35 to-transparent" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#1a2140] via-[#1a2140]/70 to-transparent" aria-hidden="true" />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 pt-28 sm:pt-36 pb-10">
          <div className="max-w-2xl [text-shadow:0_2px_16px_rgba(10,14,35,0.65)]">
            {/* Announcement: ToB client support, linking to the filtered directory */}
            <Link
              href="/servers?client=tob"
              className="group mb-7 inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl sm:rounded-full border border-[#e3c27a]/60 bg-[#0d1226]/45 backdrop-blur py-1.5 pl-1.5 pr-4 text-sm text-parchment-50 shadow-[0_6px_24px_rgba(242,207,134,0.18)] [text-shadow:none] hover:border-[#f4d590] hover:bg-[#0d1226]/60 transition-all duration-300"
            >
              <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-b from-[#f4d590] to-[#d4a650] px-2.5 py-1 text-[10px] font-bold tracking-[0.2em] uppercase text-[#1b2350]">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                New
              </span>
              <span>The Outer Brood (ToB) client support is here.</span>
              <span className="inline-flex items-center gap-1.5 text-[#e3c27a] group-hover:text-[#f4d590]">
                Find servers that support it
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
            <p className="text-xs sm:text-sm tracking-[0.35em] uppercase text-parchment-200/90 mb-5">
              Explore <span className="mx-2 text-frost-300">&middot;</span> Connect <span className="mx-2 text-frost-300">&middot;</span> Play
            </p>
            <h1 className="font-hero text-5xl sm:text-6xl lg:text-7xl font-semibold leading-[1.02] text-parchment-50 mb-6">
              Welcome to
              <br />
              <span className="text-gold-gradient">EQ Emulator</span>
            </h1>
            <p className="font-hero text-xl sm:text-2xl leading-snug text-parchment-100/95 mb-9 max-w-xl">
              Find an EQ Emulator server, learn how to play, and join a welcoming community.
              New to emulators? We&apos;ll guide you every step of the way.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 [text-shadow:none]">
              <Link
                href="/servers"
                className="inline-flex items-center justify-center gap-3 rounded bg-gradient-to-b from-[#f4d590] to-[#d4a650] px-8 py-4 text-sm font-semibold tracking-[0.18em] uppercase text-[#1b2350] shadow-[0_8px_28px_rgba(242,207,134,0.35)] hover:from-[#f8e0a8] hover:to-[#e0b562] transition-all duration-300"
              >
                <Compass className="h-5 w-5" aria-hidden="true" />
                Find a server
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/getting-started"
                className="inline-flex items-center justify-center gap-3 rounded border border-[#e3c27a]/70 bg-[#0d1226]/40 backdrop-blur px-8 py-4 text-sm font-medium tracking-[0.18em] uppercase text-parchment-50 hover:bg-[#0d1226]/60 hover:border-[#e3c27a] transition-all duration-300"
              >
                <BookOpen className="h-5 w-5 text-[#e3c27a]" aria-hidden="true" />
                Get started
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="mt-6 [text-shadow:none]">
              <LiveStats />
            </div>
          </div>

          {/* Three ways in */}
          <div className="mt-24 sm:mt-32 grid grid-cols-1 md:grid-cols-3 md:divide-x divide-parchment-100/15 text-center">
            {[
              { icon: User, title: "For players", desc: "Learn the basics, find a server, and make your first login.", href: "/getting-started", cta: "Get started" },
              { icon: ServerIcon, title: "Explore servers", desc: "See who's playing, compare worlds, and find your playstyle.", href: "/servers", cta: "Browse servers" },
              { icon: Users, title: "For server owners", desc: "List your world, manage your profile, and reach new players.", href: "/server-operators", cta: "Learn more" },
            ].map(({ icon: Icon, title, desc, href, cta }) => (
              <div key={title} className="px-6 py-6">
                <Icon className="h-8 w-8 mx-auto mb-3 text-[#e3c27a]" strokeWidth={1.5} aria-hidden="true" />
                <h2 className="text-sm tracking-[0.25em] uppercase text-parchment-50 mb-2">{title}</h2>
                <p className="font-hero text-lg leading-snug text-parchment-200 mb-3 max-w-xs mx-auto">{desc}</p>
                <Link href={href} className="inline-flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-[#e3c27a] hover:text-[#f4d590]">
                  {cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            ))}
          </div>
        </div>
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
          <div className="rounded-lg border border-frost-400/15 bg-[#242c48]/85 p-10 text-center">
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
                  className="group flex h-full flex-col justify-between rounded-lg border border-frost-400/15 bg-[#242c48]/85 p-4 hover:border-frost-400/25 hover:bg-frost-400/[0.03] transition-all duration-300"
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
              New to emulators?
            </span>
            <h2 className="font-display text-2xl font-bold text-parchment-100 mb-3">Here&apos;s how it works</h2>
            <p className="text-parchment-300 text-sm max-w-xl mx-auto">
              EQ Emulator worlds are run by the community and use your own copy of EQ. Getting in takes three steps, and our guide walks you through each one.
            </p>
          </div>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                n: "1",
                icon: Download,
                title: "Have the game installed",
                desc: "You play with your own copy of EQ. Most worlds use the Rain of Fear 2 version; some use Titanium, The Outer Brood or the current client. Each world's page says which, and the guide helps you check what you have.",
              },
              {
                n: "2",
                icon: FileText,
                title: "Tell the game where to connect",
                desc: (
                  <>
                    Edit <code className="text-frost-400/90 bg-[#151b2e] px-1 py-0.5 rounded text-[11px] font-mono">eqhost.txt</code> in your
                    game folder to <code className="text-frost-400/90 bg-[#151b2e] px-1 py-0.5 rounded text-[11px] font-mono">login.eqemulator.dev:5999</code>.
                    It&apos;s one line, and the guide shows exactly where it goes.
                  </>
                ),
              },
              {
                n: "3",
                icon: Play,
                title: "Make a login and pick a world",
                desc: "Create a login here in a minute, or use the one you already have from the EQEmulator forums. Start the game, choose a world from the list, and you're in.",
              },
            ].map(({ n, icon: Icon, title, desc }) => (
              <li key={n} className="relative rounded-lg border border-frost-400/15 bg-[#242c48]/85 p-6">
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
              Step-by-step guide
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
              { title: "See who's playing", desc: "Player counts and status come straight from the worlds, updated every few seconds, with population history on every server page." },
              { title: "One login, every world", desc: "Titanium, RoF2, The Outer Brood and the current client all log in here, and one login works on every world in the directory." },
              { title: "Built by the community", desc: "Open source, run by players, and compatible with the EQEmulator forum logins people have used for twenty years." },
            ].map(({ title, desc }) => (
              <div key={title}>
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-2">{title}</h3>
                <p className="text-parchment-300 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto max-w-3xl h-px bg-gradient-to-r from-transparent via-frost-400/8 to-transparent" />
      </section>

      {/* For server operators */}
      <section className="relative">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-arcane-400/20 bg-[#242c48]/85 p-6 sm:p-10">
            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-center">
              <div>
                <span className="font-display text-xs tracking-[0.35em] uppercase text-arcane-400/70 block mb-3">
                  For server operators
                </span>
                <h2 className="font-display text-2xl font-bold text-parchment-100 mb-3">
                  Running a world? Plug into the next generation of EQ login.
                </h2>
                <p className="text-parchment-300 text-sm leading-relaxed mb-5">
                  A federated login mesh instead of one box that everyone depends on. Every client
                  from Titanium to The Outer Brood and the current live client, live player counts
                  your players can see, and a profile you control. It runs alongside your existing
                  login server, so there is nothing to migrate.
                </p>
                <ul className="space-y-2 text-sm text-parchment-300 mb-6">
                  {[
                    "One config line to list your world; it appears here within a minute.",
                    "No single point of failure: official nodes sync accounts and listings in real time.",
                    "Your players keep their existing logins. Nothing changes on their side.",
                    "Claim your listing: description, links, banner, client support and population history.",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2.5">
                      <ShieldCheck className="h-4 w-4 mt-0.5 text-arcane-400/80 flex-shrink-0" aria-hidden="true" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/server-operators"
                  className="inline-block rounded border border-arcane-400/30 bg-arcane-400/5 px-8 py-3 text-xs font-display font-medium tracking-wider uppercase text-arcane-400 hover:bg-arcane-400/10 hover:border-arcane-400/50 transition-all duration-300"
                >
                  Server operator guide
                </Link>
              </div>
              <div>
                <p className="font-display text-[10px] tracking-[0.25em] uppercase text-parchment-500 mb-2">
                  Add to your world&apos;s config
                </p>
                <pre className="bg-[#151b2e] border border-frost-400/15 rounded-lg p-5 text-sm text-parchment-200 overflow-x-auto font-mono">
{`"loginserver2": {
  "host": "worldserver.eqemulator.dev",
  "port": "5998"
}`}
                </pre>
                <p className="text-parchment-500 text-xs mt-3">
                  Keep your current login server as loginserver1. Both work at the same time.
                </p>
              </div>
            </div>
          </div>
        </div>
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
            <span className="ml-2 font-mono text-[10px]">v{APP_VERSION}</span>
          </p>
        </div>
      </footer>
    </>
  );
}
