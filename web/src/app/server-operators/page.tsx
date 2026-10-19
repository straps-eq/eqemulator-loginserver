import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { Server, Settings, Shield, Plus, AlertTriangle } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "/server-operators" },
  title: "List Your EverQuest Server — Operator Guide",
  description:
    "Connect your EQEmu world server to EQEmulator.dev. One config line, automatic listing with live player counts, server profiles, and operator tools.",
  openGraph: {
    images: ["/opengraph-image"],
    title: "List Your EverQuest Server — Operator Guide",
    description: "Connect your EQEmu world server to EQEmulator.dev. One config line, automatic listing.",
  },
};

export default async function ServerOperatorsPage() {
  const session = await getSession();

  return (
    <>
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-400/60 block mb-3">
          Operator Guide
        </span>
        <h1 className="font-display text-3xl font-bold text-parchment-100 mb-2">Server Operators</h1>
        <p className="text-parchment-400 mb-10">
          Connect your EQEmu world server to this login server so players can find and join your world.
          Want ToB client players too? See{" "}
          <a href="#tob" className="hover-frost text-frost-400">Supporting ToB Clients</a>.
        </p>

        {/* Quick start */}
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-frost-400/20 bg-frost-400/5">
                    <Plus className="h-5 w-5 text-frost-400" aria-hidden="true" />
                  </div>
                </div>
                <div className="w-full">
                  <h2 className="font-display text-base font-semibold text-parchment-100 mb-2">Quick Start — Add worldserver.eqemulator.dev</h2>
                  <p className="text-parchment-400 text-sm mb-3">
                    Add a new loginserver entry to your{" "}
                    <code className="text-frost-400 bg-[#1b2238] px-1.5 py-0.5 rounded text-xs">eqemu_config.json</code>.
                    Your server will appear in the directory within seconds of connecting.
                  </p>
                  <pre className="bg-[#1b2238] border border-frost-400/8 rounded p-4 text-sm text-parchment-300 overflow-x-auto">
{`{
  "server": {
    "world": {
      "loginserver2": {
        "host": "worldserver.eqemulator.dev",
        "port": "5998"
      }
    }
  }
}`}
                  </pre>
                  <p className="text-parchment-500 text-xs mt-3">
                    Restart your world server after saving the config. That&apos;s it — your server
                    is now listed on eqemulator.dev.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Running alongside eqemulator.net */}
          <Card>
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-arcane-400/20 bg-arcane-400/5">
                    <Server className="h-5 w-5 text-arcane-400" aria-hidden="true" />
                  </div>
                </div>
                <div className="w-full">
                  <h2 className="font-display text-base font-semibold text-parchment-100 mb-2">Running Both Login Servers</h2>
                  <p className="text-parchment-400 text-sm mb-3">
                    Your world server can register with multiple login servers simultaneously.
                    Keep your existing <code className="text-frost-400 bg-[#1b2238] px-1.5 py-0.5 rounded text-xs">loginserver1</code> entry
                    for eqemulator.net and add eqemulator.dev as a second:
                  </p>
                  <pre className="bg-[#1b2238] border border-frost-400/8 rounded p-4 text-sm text-parchment-300 overflow-x-auto">
{`{
  "server": {
    "world": {
      "loginserver1": {
        "host": "login.eqemulator.net",
        "port": "5998",
        "legacy": "1"
      },
      "loginserver2": {
        "host": "worldserver.eqemulator.dev",
        "port": "5998"
      }
    }
  }
}`}
                  </pre>
                  <p className="text-parchment-500 text-xs mt-3">
                    Your server appears on <strong className="text-parchment-300">both</strong> server lists.
                    Players connecting through either login server can reach your world.
                    The <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">&quot;legacy&quot;: &quot;1&quot;</code> flag
                    is required for login.eqemulator.net (auto-detected if hostname contains &quot;login.eqemulator.net&quot;).
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Config details */}
          <Card>
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-frost-400/20 bg-frost-400/5">
                    <Settings className="h-5 w-5 text-frost-400" aria-hidden="true" />
                  </div>
                </div>
                <div className="w-full">
                  <h2 className="font-display text-base font-semibold text-parchment-100 mb-2">Configuration Options</h2>
                  <div className="space-y-4 mt-3">
                    <div>
                      <h3 className="text-sm font-medium text-parchment-200 mb-1">Loginserver entry fields</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead>
                            <tr className="border-b border-frost-400/8">
                              <th className="text-parchment-300 font-medium py-2 pr-4">Field</th>
                              <th className="text-parchment-300 font-medium py-2 pr-4">Required</th>
                              <th className="text-parchment-300 font-medium py-2">Description</th>
                            </tr>
                          </thead>
                          <tbody className="text-parchment-400">
                            <tr className="border-b border-frost-400/5">
                              <td className="py-2 pr-4"><code className="text-frost-400 text-xs">host</code></td>
                              <td className="py-2 pr-4">Yes</td>
                              <td className="py-2">Login server hostname or IP</td>
                            </tr>
                            <tr className="border-b border-frost-400/5">
                              <td className="py-2 pr-4"><code className="text-frost-400 text-xs">port</code></td>
                              <td className="py-2 pr-4">Yes</td>
                              <td className="py-2">Login server port (usually 5998)</td>
                            </tr>
                            <tr className="border-b border-frost-400/5">
                              <td className="py-2 pr-4"><code className="text-frost-400 text-xs">account</code></td>
                              <td className="py-2 pr-4">No</td>
                              <td className="py-2">World server account name (for registered servers)</td>
                            </tr>
                            <tr className="border-b border-frost-400/5">
                              <td className="py-2 pr-4"><code className="text-frost-400 text-xs">password</code></td>
                              <td className="py-2 pr-4">No</td>
                              <td className="py-2">World server account password</td>
                            </tr>
                            <tr>
                              <td className="py-2 pr-4"><code className="text-frost-400 text-xs">legacy</code></td>
                              <td className="py-2 pr-4">No</td>
                              <td className="py-2">Set to &quot;1&quot; for login.eqemulator.net compatibility</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-medium text-parchment-200 mb-1">Naming convention</h3>
                      <p className="text-parchment-400 text-sm">
                        Loginserver entries are numbered sequentially:{" "}
                        <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">loginserver1</code>,{" "}
                        <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">loginserver2</code>,{" "}
                        <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">loginserver3</code>, etc.
                        The world server iterates through all numbered entries on startup.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Unregistered mode */}
          <Card>
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-arcane-400/20 bg-arcane-400/5">
                    <Shield className="h-5 w-5 text-arcane-400" aria-hidden="true" />
                  </div>
                </div>
                <div>
                  <h2 className="font-display text-base font-semibold text-parchment-100 mb-2">Registration</h2>
                  <p className="text-parchment-400 text-sm mb-2">
                    This login server currently accepts <strong className="text-parchment-200">unregistered servers</strong>.
                    You do not need an account/password to list your server — just add the config entry and connect.
                  </p>
                  <p className="text-parchment-500 text-xs">
                    In the future, server registration may be required to claim your server profile,
                    add a description, and manage your listing.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* How Player Auth Works */}
        <div className="mt-12">
          <h2 className="font-display text-xl font-bold text-parchment-100 mb-5">How Player Authentication Works</h2>
          <p className="text-parchment-400 text-sm mb-4">
            This login server runs <strong className="text-parchment-200">LSPX (Login Server Proxy)</strong>,
            which means existing eqemulator.net accounts work here automatically.
          </p>
          <div className="space-y-3">
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">Transparent to players</h3>
                <p className="text-parchment-400 text-sm">
                  When a player logs in with their eqemulator.net credentials, they are verified
                  against eqemulator.net and cached locally. No re-registration needed. Password
                  changes on eqemulator.net are synced automatically on next login.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">What this means for your server</h3>
                <p className="text-parchment-400 text-sm">
                  Players connecting through eqemulator.dev use their existing eqemulator.net credentials.
                  From your world server&apos;s perspective, it works identically to connecting via eqemulator.net.
                  Players keep their same account IDs and characters.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ToB client support */}
        <section id="tob" aria-labelledby="tob-heading" className="mt-12 scroll-mt-20">
          <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-400/60 block mb-2">
            New client
          </span>
          <h2 id="tob-heading" className="font-display text-xl font-bold text-parchment-100 mb-2">Supporting ToB Clients</h2>
          <p className="text-parchment-400 text-sm mb-5">
            Players using the ToB client can now log in to EQEmulator.dev.
            They see every server in the list, but can only enter worlds that have been set up for ToB.
            Here is what that takes on your side.
          </p>

          <div className="space-y-4">
            <Card className="border-frost-400/15">
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">No new ports for you</h3>
                <p className="text-parchment-400 text-sm">
                  ToB clients log in on port <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">15900</code>, which lives on <em>our</em> loginserver.
                  You don&apos;t open anything new. Your world keeps registering with 
                  <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">worldserver.eqemulator.dev</code> on TCP <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">5998</code> exactly as before,
                  and your <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">loginserver</code> config entries don&apos;t change.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-3">Checklist</h3>
                <ol className="space-y-4 text-parchment-400 text-sm">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border border-frost-400/15 bg-frost-400/5 font-mono text-frost-400/70 text-xs">1</span>
                    <div>
                      <strong className="text-parchment-200">Back up your database.</strong> Do this before moving
                      your server to <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">develop-v2</code>.
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border border-frost-400/15 bg-frost-400/5 font-mono text-frost-400/70 text-xs">2</span>
                    <div>
                      <strong className="text-parchment-200">Build world and zone from upstream EQEmu/Server <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">develop-v2</code>.</strong>{" "}
                      That branch includes the ToB patch (<code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">common/patches/tob*.cpp</code>). Older builds
                      can&apos;t talk to ToB clients.
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border border-frost-400/15 bg-frost-400/5 font-mono text-frost-400/70 text-xs">3</span>
                    <div>
                      <strong className="text-parchment-200">Install the ToB patch file.</strong> Copy 
                      <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">utils/patches/patch_TOB.conf</code> from the source tree into your server&apos;s
                      patches directory, next to <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">patch_RoF2.conf</code>.
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border border-frost-400/15 bg-frost-400/5 font-mono text-frost-400/70 text-xs">4</span>
                    <div className="min-w-0 flex-1">
                      <strong className="text-parchment-200">Allow ToB in <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">World:SupportedClients</code>.</strong>{" "}
                      The rule must include <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">TOB</code>, or be left blank to allow every client.
                      <div className="mt-3 flex gap-2.5 rounded border border-gold-400/20 bg-gold-400/5 p-3">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-gold-300 mt-0.5" aria-hidden="true" />
                        <p className="text-parchment-300 text-xs leading-relaxed">
                          On develop-v2 the default is <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">RoF2,TOB</code>. That <strong>blocks Titanium,
                          SoF, SoD and UF</strong> players. If you support those clients, add them to the rule or
                          leave it blank.
                        </p>
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border border-frost-400/15 bg-frost-400/5 font-mono text-frost-400/70 text-xs">5</span>
                    <div>
                      <strong className="text-parchment-200">Keep your world&apos;s client port on UDP <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">9000</code>.</strong>{" "}
                      The ToB client always connects to world on 9000, so a world on a custom port won&apos;t work
                      for ToB players.
                    </div>
                  </li>
                </ol>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-3">How a ToB login flows</h3>
                <ol className="space-y-2 text-parchment-400 text-sm list-decimal list-inside">
                  <li>
                    The ToB client logs in to <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">login.eqemulator.dev:15900</code> and gets the server list.
                  </li>
                  <li>
                    The player picks your world. The client connects to your world on UDP <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">9000</code>.
                    If your world doesn&apos;t accept ToB, entry fails here.
                  </li>
                  <li>From there, zoning works the same as for any other client, using your usual zone ports.</li>
                </ol>
              </CardContent>
            </Card>

            <p className="text-parchment-500 text-xs">
              Until your world supports ToB, ToB players will get an error when entering it, so let your
              community know which clients you support.
            </p>
          </div>
        </section>

        {/* Troubleshooting */}
        <div className="mt-12">
          <h2 className="font-display text-xl font-bold text-parchment-100 mb-5">Troubleshooting</h2>
          <div className="space-y-3">
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">My server isn&apos;t appearing in the list</h3>
                <p className="text-parchment-400 text-sm">
                  Check your world server logs for loginserver connection messages. Ensure{" "}
                  <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">worldserver.eqemulator.dev</code>{" "}
                  is reachable from your server on port 5998 (TCP). Verify the config key is named{" "}
                  <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">loginserver2</code>{" "}
                  (not <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">loginserver_2</code>).
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">My server shows 0 players even though people are online</h3>
                <p className="text-parchment-400 text-sm">
                  Player count is reported by the world server to each login server independently.
                  Make sure your world server is running a recent enough version that supports
                  multi-loginserver player count reporting.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">ToB players can see my server but can&apos;t get in</h3>
                <p className="text-parchment-400 text-sm">
                  Work through the <a href="#tob" className="hover-frost text-frost-400">ToB checklist</a>: a
                  develop-v2 build of world and zone, <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">patch_TOB.conf</code> in
                  your patches directory, <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">TOB</code> allowed
                  in <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">World:SupportedClients</code>, and
                  the world client port on UDP 9000.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">After moving to develop-v2, Titanium/SoF/SoD/UF players can&apos;t get in</h3>
                <p className="text-parchment-400 text-sm">
                  The develop-v2 default for <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">World:SupportedClients</code> is{" "}
                  <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">RoF2,TOB</code>. Add the other clients
                  you support to the rule, or leave it blank to allow all clients.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">Can I connect to worldserver.eqemulator.dev only (not eqemulator.net)?</h3>
                <p className="text-parchment-400 text-sm">
                  Yes. Just configure a single{" "}
                  <code className="text-frost-400 bg-[#1b2238] px-1 py-0.5 rounded text-xs">loginserver1</code>{" "}
                  pointing at worldserver.eqemulator.dev. Players using their eqemulator.net credentials will still
                  work thanks to LSPX account proxying.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Need help */}
        <div className="mt-12">
          <Card className="border-frost-400/10">
            <CardContent className="p-6 text-center">
              <h2 className="font-display text-base font-semibold text-parchment-100 mb-2">Need Help?</h2>
              <p className="text-parchment-400 text-sm mb-4">
                Join the EQEmulator Discord for support from the community and other server operators.
              </p>
              <a
                href="https://discord.gg/6T4n3DdPVB"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded bg-[#5865F2] px-6 py-2.5 text-xs font-display font-medium tracking-wide uppercase text-white hover:bg-[#4752C4] transition-colors"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
                Join Discord
              </a>
            </CardContent>
          </Card>
        </div>

        {/* Back to player guide */}
        <div className="mt-8 text-center">
          <Link
            href="/getting-started"
            className="hover-frost inline-flex items-center text-parchment-500 text-sm"
          >
            ← Player Getting Started Guide
          </Link>
        </div>
      </div>
    </>
  );
}
