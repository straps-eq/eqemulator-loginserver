import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { getPublicServerList } from "@/lib/public-servers";
import { ServerList } from "./server-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/servers" },
  title: "EverQuest Private Server List — Live Player Counts",
  description:
    "Browse active EverQuest private servers with real-time player counts, population tiers, and server profiles. Find your next EQ adventure.",
  openGraph: {
    images: ["/opengraph-image"],
    title: "EverQuest Private Server List — Live Player Counts",
    description: "Browse active EverQuest private servers with real-time player counts and server profiles.",
  },
};

export default async function ServersPage() {
  const session = await getSession();
  const servers = await getPublicServerList().catch(() => []);

  return (
    <>
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <ServerList initial={servers} />
      </div>
    </>
  );
}
