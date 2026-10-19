import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { getPublicServerList } from "@/lib/public-servers";
import { ServerList } from "./server-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/servers" },
  title: "EQEmu Server List — Live EQ Emulator Servers & Player Counts",
  description:
    "Every EQEmu server on our login, with live player counts, population history, client support and server profiles. Find your next EQ Emulator world.",
  openGraph: {
    images: ["/opengraph-image"],
    title: "EQEmu Server List — Live EQ Emulator Servers & Player Counts",
    description: "Every EQEmu server on our login, with live player counts, client support and server profiles.",
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
