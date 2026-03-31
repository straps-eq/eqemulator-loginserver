import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { Globe, Shield, Server, Users, Zap, Network } from "lucide-react";

export const metadata = {
  title: "About — EQEmulator",
  description: "What EQEmulator.dev is, how the federated mesh works, and why it matters for the EverQuest community.",
};

export default async function AboutPage() {
  const session = await getSession();

  return (
    <>
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />

      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="font-display text-[10px] tracking-[0.35em] uppercase text-frost-400/50 block mb-3">
            About
          </span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-parchment-100 mb-4">
            What is EQEmulator.dev?
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-parchment-400/80 leading-relaxed">
            A modern, community-operated login infrastructure for EverQuest private servers — built for
            reliability, transparency, and the long-term health of the emulation community.
          </p>
        </div>

        {/* Architecture overview */}
        <section className="mb-16">
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/60 p-6 sm:p-8">
            <h2 className="font-display text-lg font-semibold text-parchment-100 mb-4">
              Architecture
            </h2>
            <p className="text-sm text-parchment-400/80 leading-relaxed mb-4">
              EQEmulator.dev is a federated login infrastructure for EverQuest private servers. Instead of
              a single server, the platform runs as a network of nodes that sync account data, server
              listings, and operator profiles across the mesh in real time.
            </p>
            <p className="text-sm text-parchment-400/80 leading-relaxed mb-4">
              A small set of <strong className="text-parchment-200">authoritative nodes</strong> form the
              trusted backbone. These are operated by vetted community members, sit behind load-balanced
              IPs for high availability, and are the source of truth for the network. They sync
              bidirectionally — changes on any authoritative node propagate to all others.
            </p>
            <p className="text-sm text-parchment-400/80 leading-relaxed mb-4">
              Beyond the authoritative set, anyone can spin up a <strong className="text-parchment-200">mesh node</strong>.
              Mesh nodes receive the full dataset from the authoritative nodes and can serve players
              locally, but they operate read-only — they cannot push changes back to the network. This
              means the community can scale horizontally without compromising data integrity.
            </p>
            <p className="text-sm text-parchment-400/80 leading-relaxed">
              All node-to-node communication is authenticated with public-key cryptography and encrypted
              in transit. If any single node goes offline, the rest of the network continues serving
              without interruption. Your existing eqemulator.net credentials work here automatically
              via transparent proxy — no re-registration needed.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="mb-16">
          <h2 className="font-display text-xl font-semibold text-parchment-100 mb-6 text-center">
            How the Federation Works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Server,
                title: "Official Nodes",
                desc: "A small number of trusted, vetted nodes form the authoritative backbone. These are operated by established community members and sync bidirectionally.",
              },
              {
                icon: Network,
                title: "Mesh Nodes",
                desc: "Anyone can run a mesh node for local access. Mesh nodes receive the full dataset but operate read-only — they can't push changes back to the network.",
              },
              {
                icon: Zap,
                title: "Automatic Sync",
                desc: "Account data, server listings, and profiles sync across all nodes automatically. If one node goes down, the others continue serving without interruption.",
              },
              {
                icon: Globe,
                title: "Seamless Migration",
                desc: "Existing eqemulator.net accounts work via transparent proxy. When you log in here, your account migrates automatically — no action required.",
              },
              {
                icon: Shield,
                title: "Cryptographic Trust",
                desc: "Every node authenticates with Ed25519 digital signatures. Data integrity is verified at every hop. No node can impersonate another.",
              },
              {
                icon: Users,
                title: "Community Operated",
                desc: "The infrastructure is open source and community-run. No single person or organization controls the network. The code is public on GitHub.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-lg border border-frost-400/6 bg-[#0a0e16]/60 p-5">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded border border-frost-400/15 bg-frost-400/5 mb-3">
                  <Icon className="h-4 w-4 text-frost-400/70" />
                </div>
                <h3 className="font-display text-sm font-semibold text-parchment-200 mb-2">{title}</h3>
                <p className="text-xs text-parchment-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Why it matters */}
        <section className="mb-16">
          <h2 className="font-display text-xl font-semibold text-parchment-100 mb-6 text-center">
            Why This Matters
          </h2>
          <div className="space-y-4">
            {[
              {
                title: "Resilience",
                desc: "Multiple independent nodes mean no single point of failure. If one node goes offline, the network continues operating. Your players keep playing.",
              },
              {
                title: "Independence",
                desc: "Server operators aren't dependent on a single third party. You can run your own node, host your own data, and maintain full control of your community.",
              },
              {
                title: "Continuity",
                desc: "Twenty years of community history deserve infrastructure that will outlast any one person. A federated model ensures the community's data persists.",
              },
              {
                title: "Transparency",
                desc: "The entire codebase is open source. Every security measure, every sync protocol, every line of code is publicly auditable on GitHub.",
              },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-lg border border-frost-400/6 bg-[#0a0e16]/60 p-5">
                <h3 className="font-display text-sm font-semibold text-parchment-200 mb-1.5">{title}</h3>
                <p className="text-xs text-parchment-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Compatibility */}
        <section className="mb-16">
          <div className="rounded-lg border border-frost-400/8 bg-[#0a0e17]/60 p-6 sm:p-8">
            <h2 className="font-display text-lg font-semibold text-parchment-100 mb-4">
              Compatibility
            </h2>
            <div className="space-y-3 text-sm text-parchment-400/80 leading-relaxed">
              <p>
                <strong className="text-parchment-200">Existing accounts work.</strong> If you have an eqemulator.net
                login, it works here automatically via our transparent proxy (LSPX). No registration needed.
              </p>
              <p>
                <strong className="text-parchment-200">Server operators can dual-list.</strong> World servers can connect
                to both loginservers simultaneously. Your players can reach you from either network.
              </p>
              <p>
                <strong className="text-parchment-200">All EQ clients supported.</strong> Titanium, SoD+, and Larion clients
                are all supported. Just update your eqhost.txt to point here.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="text-center">
          <p className="text-sm text-parchment-500 mb-4">
            Questions? Join the community on Discord.
          </p>
          <a
            href="https://discord.gg/6T4n3DdPVB"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded border border-frost-400/25 bg-frost-400/5 px-8 py-3 text-sm font-display font-medium tracking-wider uppercase text-frost-300 hover:bg-frost-400/10 hover:border-frost-400/40 transition-all duration-300"
          >
            Join Discord
          </a>
        </div>
      </div>
    </>
  );
}
