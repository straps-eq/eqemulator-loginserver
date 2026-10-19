/**
 * Player guides under /guides. One entry per page; the index, the sitemap,
 * "more guides" links and each page's metadata all read from this list.
 */
export interface Guide {
  slug: string;
  /** Visible H1. */
  title: string;
  /** <title>, written for the phrase people search. */
  metaTitle: string;
  description: string;
  /** Last real content change, YYYY-MM-DD. Goes into the sitemap and Article JSON-LD. */
  updated: string;
}

export const GUIDES: Guide[] = [
  {
    slug: "what-is-eqemu",
    title: "What is EQEmu?",
    metaTitle: "What is EQEmu? The EQ Emulator Explained",
    description:
      "EQEmu (EQ Emulator) is the open-source, community-run server for EverQuest. Here's what it is, how it works, and what you need to start playing on an EQEmu server.",
    updated: "2026-10-19",
  },
  {
    slug: "eq-clients",
    title: "Which EQ client do I need?",
    metaTitle: "Which EQ Client Do I Need for EQEmu? Titanium, RoF2, ToB and Live",
    description:
      "Titanium, RoF2, The Outer Brood or the current client: which EQ client works on which EQEmu server, which port each one uses, and how to check before you pick a world.",
    updated: "2026-10-19",
  },
  {
    slug: "eqhost-txt",
    title: "How to set up eqhost.txt",
    metaTitle: "eqhost.txt for EQEmu: Where It Is and What to Put in It",
    description:
      "eqhost.txt tells your EQ client which login server to use. Where to find it, exactly what to put in it for each client, and how to fix the most common login problems.",
    updated: "2026-10-19",
  },
  {
    slug: "mac-and-linux",
    title: "Playing EQEmu on Mac and Linux",
    metaTitle: "Play EQEmu on Mac, Linux and Steam Deck",
    description:
      "The EQ client is a Windows program, but it runs well on Linux, Steam Deck and Mac with Wine-based tools. Here's how to set it up for an EQEmu server.",
    updated: "2026-10-19",
  },
  {
    slug: "choosing-a-server",
    title: "How to choose an EQEmu server",
    metaTitle: "How to Choose an EQEmu Server: Classic, Progression or Custom",
    description:
      "Classic, progression or custom? Boxing allowed or one character? A short guide to picking the EQ Emulator server that fits how you like to play.",
    updated: "2026-10-19",
  },
];

export function getGuide(slug: string): Guide {
  const guide = GUIDES.find((g) => g.slug === slug);
  if (!guide) throw new Error(`Unknown guide: ${slug}`);
  return guide;
}
