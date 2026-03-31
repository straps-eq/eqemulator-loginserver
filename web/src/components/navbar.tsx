"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Github, Menu, X } from "lucide-react";

const discordSvg = (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
);

export function Navbar({ accountName, isAdmin }: { accountName?: string; isAdmin?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { href: "/servers", label: "Servers" },
    { href: "/about", label: "About" },
    { href: "/getting-started", label: "Getting Started" },
    { href: "/server-operators", label: "Server Ops" },
    { href: "/security", label: "Security" },
    { href: "/status", label: "Status" },
  ];

  return (
    <nav className="border-b border-frost-400/6 bg-[#080b12]/85 backdrop-blur-xl sticky top-0 z-50">
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-frost-400/15 to-transparent" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 group">
              <Shield className="h-4.5 w-4.5 text-frost-400/80 group-hover:text-frost-300 transition-colors" />
              <span className="font-display font-semibold text-lg tracking-wide text-gold-gradient">
                EQEmulator
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map(({ href, label }) => (
                <Link key={href} href={href} className="hover-frost px-3 py-1.5 text-sm text-parchment-400 rounded">
                  {label}
                </Link>
              ))}
              <a href="https://discord.gg/6T4n3DdPVB" target="_blank" rel="noopener noreferrer" className="hover-frost px-2.5 py-1.5 text-parchment-500 rounded" title="Discord">
                {discordSvg}
              </a>
              <a href="https://github.com/EQEmu" target="_blank" rel="noopener noreferrer" className="hover-frost px-2.5 py-1.5 text-parchment-500 rounded" title="GitHub">
                <Github className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {accountName ? (
              <div className="hidden md:flex items-center gap-3">
                {isAdmin && (
                  <Link href="/admin" className="hover-frost text-sm text-amber-400/80 px-3 py-1.5">
                    Admin
                  </Link>
                )}
                <Link href="/account" className="hover-frost text-sm text-parchment-400 px-3 py-1.5">
                  {accountName}
                </Link>
                <form action="/api/account/logout" method="POST">
                  <button type="submit" className="text-obsidian-500 hover:text-parchment-400 transition-colors text-sm px-2 py-1">
                    Logout
                  </button>
                </form>
              </div>
            ) : (
              <div className="hidden md:flex items-center gap-3">
                <Link href="/login" className="hover-frost text-sm text-parchment-400 px-3 py-1.5">
                  Login
                </Link>
                <Link
                  href="/register"
                  className="rounded border border-frost-400/25 bg-frost-400/5 px-5 py-2 text-xs font-display font-medium tracking-wider uppercase text-frost-300 hover:bg-frost-400/10 hover:border-frost-400/40 hover:shadow-[0_0_12px_rgba(52,187,250,0.15)] transition-all duration-300"
                >
                  Register
                </Link>
              </div>
            )}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded text-parchment-400 hover:text-frost-400 transition-colors"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-frost-400/6 bg-[#080b12]/95 backdrop-blur-xl">
          <div className="px-4 py-3 space-y-1">
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-2.5 text-sm text-parchment-400 hover:text-frost-400 hover:bg-frost-400/5 rounded transition-colors"
              >
                {label}
              </Link>
            ))}
            <div className="flex items-center gap-3 px-3 py-2">
              <a href="https://discord.gg/6T4n3DdPVB" target="_blank" rel="noopener noreferrer" className="text-parchment-500 hover:text-frost-400 transition-colors" title="Discord">
                {discordSvg}
              </a>
              <a href="https://github.com/EQEmu" target="_blank" rel="noopener noreferrer" className="text-parchment-500 hover:text-frost-400 transition-colors" title="GitHub">
                <Github className="h-4 w-4" />
              </a>
            </div>
            <div className="h-px bg-frost-400/6 my-2" />
            {accountName ? (
              <>
                {isAdmin && (
                  <Link href="/admin" onClick={() => setMobileOpen(false)} className="block px-3 py-2.5 text-sm text-amber-400/80 hover:bg-frost-400/5 rounded transition-colors">
                    Admin
                  </Link>
                )}
                <Link href="/account" onClick={() => setMobileOpen(false)} className="block px-3 py-2.5 text-sm text-parchment-400 hover:bg-frost-400/5 rounded transition-colors">
                  {accountName}
                </Link>
                <form action="/api/account/logout" method="POST">
                  <button type="submit" className="block w-full text-left px-3 py-2.5 text-sm text-parchment-600 hover:text-parchment-400 transition-colors">
                    Logout
                  </button>
                </form>
              </>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2">
                <Link href="/login" onClick={() => setMobileOpen(false)} className="text-sm text-parchment-400 hover:text-frost-400 transition-colors">
                  Login
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileOpen(false)}
                  className="rounded border border-frost-400/25 bg-frost-400/5 px-4 py-1.5 text-xs font-display font-medium tracking-wider uppercase text-frost-300"
                >
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
