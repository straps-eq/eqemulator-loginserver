import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SiteFooter } from "@/components/site-footer";
import { getSession } from "@/lib/session";
import { serializeJsonLd } from "@/lib/json-ld";
import { GUIDES } from "@/lib/guides";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://eqemulator.dev";

const TITLE = "EQEmu Guides — How to Play on EQ Emulator Servers";
const DESCRIPTION =
  "Plain-English guides for new EQEmu players: what EQEmu is, which EQ client you need, setting up eqhost.txt, playing on Mac and Linux, and choosing a server.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/guides" },
  openGraph: { url: "/guides", title: TITLE, description: DESCRIPTION, images: ["/opengraph-image"] },
};

export default async function GuidesPage() {
  const session = await getSession();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "EQEmu Guides",
    url: `${SITE_URL}/guides`,
    description: DESCRIPTION,
    hasPart: [
      { "@type": "Article", headline: "Getting Started", url: `${SITE_URL}/getting-started` },
      ...GUIDES.map((g) => ({ "@type": "Article", headline: g.title, url: `${SITE_URL}/guides/${g.slug}` })),
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-300 block mb-3">
          Player guides
        </span>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-parchment-50 mb-4">EQEmu guides</h1>
        <p className="text-lg leading-relaxed text-parchment-100 mb-10">
          New to EQ Emulator, or coming back after a few years? Start with Getting Started, then dip into
          whichever guide answers your question.
        </p>

        <ul className="space-y-4">
          <li>
            <Link
              href="/getting-started"
              className="group block rounded-lg border border-[#e3c27a]/40 bg-[#242c48]/85 p-5 hover:border-[#e3c27a]/70 transition-colors"
            >
              <span className="flex items-center gap-2 font-display text-lg font-semibold text-parchment-50 group-hover:text-frost-200">
                <BookOpen className="h-5 w-5 text-[#e3c27a]" aria-hidden="true" />
                Getting Started: play in three steps
              </span>
              <span className="block mt-1 text-parchment-200">
                Install the game, point it at our login server, and pick a world.
              </span>
            </Link>
          </li>
          {GUIDES.map((g) => (
            <li key={g.slug}>
              <Link
                href={`/guides/${g.slug}`}
                className="group block rounded-lg border border-frost-400/15 bg-[#242c48]/85 p-5 hover:border-frost-400/35 transition-colors"
              >
                <span className="flex items-center justify-between gap-3 font-display text-lg font-semibold text-parchment-50 group-hover:text-frost-200">
                  {g.title}
                  <ArrowRight className="h-4 w-4 flex-shrink-0 text-frost-300 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <span className="block mt-1 text-parchment-200">{g.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <SiteFooter />
    </>
  );
}
