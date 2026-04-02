import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FileText, Play, RefreshCw } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Play EverQuest on Private Servers",
  description:
    "Step-by-step guide to connecting to EverQuest private servers through EQEmulator.dev. Download the client, update eqhost.txt, and start playing in minutes.",
  openGraph: {
    title: "How to Play EverQuest on Private Servers",
    description: "Step-by-step guide to connecting to EverQuest private servers through EQEmulator.dev.",
  },
};

export default async function GettingStartedPage() {
  const session = await getSession();

  return (
    <>
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-400/60 block mb-3">
          Player Guide
        </span>
        <h1 className="font-display text-3xl font-bold text-parchment-100 mb-2">Getting Started</h1>
        <p className="text-parchment-400 mb-10">
          Connect to EverQuest private servers through EQEmulator.dev. Your existing eqemulator.net account works automatically.
          For the full official guide, see the{" "}
          <a href="https://docs.eqemu.dev/play/play-guide/" target="_blank" rel="noopener noreferrer" className="text-frost-400 hover:text-frost-300 transition-colors">EQEmu Play Guide</a>.
        </p>

        <div className="space-y-6">
          {/* Step 1 */}
          <Card>
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-arcane-400/20 bg-arcane-400/5">
                    <Download className="h-5 w-5 text-arcane-400" />
                  </div>
                </div>
                <div>
                  <h2 className="font-display text-base font-semibold text-parchment-100 mb-2">1. Get an EverQuest Client</h2>
                  <p className="text-parchment-400 text-sm mb-3">
                    You need a copy of EverQuest to play. The most commonly supported clients are:
                  </p>
                  <ul className="text-parchment-400 text-sm space-y-1.5 mb-3">
                    <li className="flex items-start gap-2">
                      <span className="text-frost-400/50 mt-1">•</span>
                      <span><strong className="text-parchment-200">Titanium</strong> — Classic client, widely supported</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-frost-400/50 mt-1">•</span>
                      <span><strong className="text-parchment-200">Secrets of Faydwer (SoF/SoD+)</strong> — More features, most popular</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-frost-400/50 mt-1">•</span>
                      <span><strong className="text-parchment-200">Rain of Fear (RoF2)</strong> — Latest supported classic client</span>
                    </li>
                  </ul>
                  <p className="text-parchment-500 text-xs">
                    Check with your chosen server for their recommended client version.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 2 */}
          <Card>
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-frost-400/20 bg-frost-400/5">
                    <FileText className="h-5 w-5 text-frost-400" />
                  </div>
                </div>
                <div>
                  <h2 className="font-display text-base font-semibold text-parchment-100 mb-2">2. Update eqhost.txt</h2>
                  <p className="text-parchment-400 text-sm mb-3">
                    Find <code className="text-frost-400 bg-[#0e1017] px-1.5 py-0.5 rounded text-xs">eqhost.txt</code> in
                    your EverQuest directory and replace its contents with:
                  </p>
                  <pre className="bg-[#0e1017] border border-frost-400/8 rounded p-4 text-sm text-parchment-300 overflow-x-auto mb-3">
{`[LoginServer]
Host=login.eqemulator.dev:5999`}
                  </pre>
                  <p className="text-parchment-500 text-xs mb-3">
                    This tells your EQ client to connect to the EQEmulator login server.
                  </p>
                  <details className="text-sm">
                    <summary className="text-frost-400/70 cursor-pointer hover:text-frost-400 transition-colors text-xs font-medium">
                      Using Titanium or Larion client? View alternate ports
                    </summary>
                    <div className="mt-2 space-y-2">
                      <p className="text-parchment-500 text-xs">Titanium clients (port 5998):</p>
                      <pre className="bg-[#0e1017] border border-frost-400/8 rounded p-3 text-xs text-parchment-300 overflow-x-auto">
{`[LoginServer]
Host=login.eqemulator.dev:5998`}
                      </pre>
                      <p className="text-parchment-500 text-xs">Larion clients (port 15900):</p>
                      <pre className="bg-[#0e1017] border border-frost-400/8 rounded p-3 text-xs text-parchment-300 overflow-x-auto">
{`[LoginServer]
Host=login.eqemulator.dev:15900`}
                      </pre>
                    </div>
                  </details>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 3 */}
          <Card>
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-arcane-400/20 bg-arcane-400/5">
                    <Play className="h-5 w-5 text-arcane-400" />
                  </div>
                </div>
                <div>
                  <h2 className="font-display text-base font-semibold text-parchment-100 mb-2">3. Launch and Play</h2>
                  <p className="text-parchment-400 text-sm mb-3">
                    Start EverQuest and log in with your existing eqemulator.net username and password.
                    You&apos;ll see a list of available servers to choose from.
                  </p>
                  <Link
                    href="/servers"
                    className="hover-frost inline-flex items-center text-frost-400 text-sm font-medium"
                  >
                    Browse available servers →
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Existing eqemulator.net accounts */}
        <div className="mt-12">
          <Card className="border-gold-400/10">
            <CardContent className="p-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-gold-300/20 bg-gold-300/5">
                    <RefreshCw className="h-5 w-5 text-gold-300" />
                  </div>
                </div>
                <div>
                  <h2 className="font-display text-base font-semibold text-parchment-100 mb-2">How does this work with my eqemulator.net account?</h2>
                  <p className="text-parchment-400 text-sm mb-2">
                    This login server runs an account proxy (LSPX). When you log in with your
                    eqemulator.net credentials, they are verified against eqemulator.net and cached locally.
                    Your account works seamlessly across both login servers.
                  </p>
                  <p className="text-parchment-500 text-xs">
                    Password changes on eqemulator.net are automatically synced on your next login.
                    No re-registration or migration steps required.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* FAQ */}
        <div className="mt-12">
          <h2 className="font-display text-xl font-bold text-parchment-100 mb-5">Frequently Asked Questions</h2>
          <div className="space-y-3">
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">Which port does my client use?</h3>
                <p className="text-parchment-400 text-sm">
                  SoD+ clients use port 5999 (most common), Titanium uses port 5998, and Larion uses port 15900.
                  If unsure, use 5999.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">Do I need a separate account for each server?</h3>
                <p className="text-parchment-400 text-sm">
                  No. Your loginserver account works across every server in the directory. Each server
                  manages its own characters, but your login credentials are shared.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">A server I play on isn&apos;t listed here. What do I do?</h3>
                <p className="text-parchment-400 text-sm">
                  The server operator needs to connect their world server to this login server.
                  Share our{" "}
                  <Link href="/server-operators" className="hover-frost text-frost-400">
                    Server Operator Guide
                  </Link>{" "}
                  with them — it only takes a one-line config change.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-100 mb-1.5">I changed my password on eqemulator.net. Does it update here?</h3>
                <p className="text-parchment-400 text-sm">
                  Yes. The next time you log in through the EQ client, your password is automatically
                  re-synced from eqemulator.net.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-12 text-center">
          <p className="text-parchment-500 text-sm mb-4">Running a server? See setup instructions for world server operators.</p>
          <Link
            href="/server-operators"
            className="hover-frost inline-flex items-center text-frost-400 text-sm font-display font-medium tracking-wide"
          >
            Server Operator Guide →
          </Link>
        </div>
      </div>
    </>
  );
}
