import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SiteFooter } from "@/components/site-footer";
import { getSession } from "@/lib/session";
import { serializeJsonLd } from "@/lib/json-ld";
import { GUIDES, type Guide } from "@/lib/guides";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://eqemulator.dev";

export function guideMetadata(guide: Guide): Metadata {
  const path = `/guides/${guide.slug}`;
  return {
    title: guide.metaTitle,
    description: guide.description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      url: path,
      title: guide.metaTitle,
      description: guide.description,
      images: ["/opengraph-image"],
    },
  };
}

/**
 * Shared shell for a guide: navbar, breadcrumb, heading, article body with
 * readable prose styles, links to the other guides, footer, and JSON-LD.
 */
export async function GuidePage({ guide, intro, children }: { guide: Guide; intro: ReactNode; children: ReactNode }) {
  const session = await getSession();
  const url = `${SITE_URL}/guides/${guide.slug}`;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: guide.title,
      description: guide.description,
      url,
      mainEntityOfPage: url,
      dateModified: guide.updated,
      inLanguage: "en",
      author: { "@type": "Organization", name: "EQEmulator.dev", url: SITE_URL },
      publisher: { "@type": "Organization", name: "EQEmulator.dev", url: SITE_URL },
      about: { "@type": "VideoGame", name: "EverQuest" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides` },
        { "@type": "ListItem", position: 3, name: guide.title, item: url },
      ],
    },
  ];

  const others = GUIDES.filter((g) => g.slug !== guide.slug);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-parchment-400">
          <ol className="flex flex-wrap items-center gap-2">
            <li><Link href="/" className="hover-frost">Home</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href="/guides" className="hover-frost">Guides</Link></li>
            <li aria-hidden="true">/</li>
            <li className="text-parchment-200" aria-current="page">{guide.title}</li>
          </ol>
        </nav>

        <article>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-parchment-50 mb-4">{guide.title}</h1>
          <div className="text-lg leading-relaxed text-parchment-100 mb-8">{intro}</div>
          <div className="guide-prose">{children}</div>
          <p className="mt-10 text-sm text-parchment-400">
            Last updated{" "}
            <time dateTime={guide.updated}>
              {new Date(`${guide.updated}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}
            </time>
          </p>
        </article>

        <aside className="mt-12 rounded-lg border border-frost-400/15 bg-[#242c48]/85 p-6">
          <h2 className="font-display text-lg font-semibold text-parchment-100 mb-4">More guides</h2>
          <ul className="space-y-3">
            {others.map((g) => (
              <li key={g.slug}>
                <Link href={`/guides/${g.slug}`} className="group inline-flex items-center gap-2 text-frost-300 hover:text-frost-200">
                  {g.title}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-parchment-200">
            Ready to play? <Link href="/servers" className="text-frost-300 hover:text-frost-200 underline underline-offset-4">Browse the EQEmu server list</Link>.
          </p>
        </aside>
      </div>
      <SiteFooter />
    </>
  );
}
