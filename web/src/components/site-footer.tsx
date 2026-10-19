import Link from "next/link";
import { APP_VERSION } from "@/lib/version";

const LINKS = [
  { href: "/servers", label: "Servers" },
  { href: "/getting-started", label: "Getting Started" },
  { href: "/guides", label: "Guides" },
  { href: "/server-operators", label: "Server Ops" },
  { href: "/about", label: "About" },
  { href: "/security", label: "Security" },
  { href: "/status", label: "Status" },
];

export function SiteFooter() {
  return (
    <footer className="mt-6">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-2">
            {LINKS.map(({ href, label }) => (
              <Link key={href} href={href} className="hover-frost text-parchment-400 text-xs uppercase tracking-wider transition-colors">
                {label}
              </Link>
            ))}
            <a href="https://discord.gg/6T4n3DdPVB" target="_blank" rel="noopener noreferrer" className="hover-frost text-parchment-400 text-xs uppercase tracking-wider transition-colors">
              Discord
            </a>
            <a href="https://github.com/straps-eq/eqemulator-loginserver" target="_blank" rel="noopener noreferrer" className="hover-frost text-parchment-400 text-xs uppercase tracking-wider transition-colors">
              GitHub
            </a>
          </div>
        </div>
        <p className="text-parchment-500 text-xs leading-relaxed mt-6 max-w-3xl">
          EQEmulator.dev is a community project and is not affiliated with, endorsed by, or sponsored by
          Daybreak Game Company LLC. EverQuest is a registered trademark of Daybreak Game Company LLC.
          Playing on emulated servers requires your own copy of the game.
          <span className="ml-2 font-mono text-[10px]">v{APP_VERSION}</span>
        </p>
      </div>
    </footer>
  );
}
