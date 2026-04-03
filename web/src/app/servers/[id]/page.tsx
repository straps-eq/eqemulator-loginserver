import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { loginWorldServers, serverProfiles } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ServerHUD } from "./server-hud";
import { PopulationChart } from "./population-chart";
import { sanitizeHtml } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id: rawId } = await params;
  const numId = parseInt(decodeURIComponent(rawId), 10);
  try {
    const [server] = await db
      .select({ longName: loginWorldServers.longName, tagDescription: loginWorldServers.tagDescription })
      .from(loginWorldServers)
      .where(isNaN(numId) ? eq(loginWorldServers.shortName, decodeURIComponent(rawId)) : eq(loginWorldServers.id, numId))
      .limit(1);
    if (server) {
      const title = `${server.longName} — EverQuest Private Server`;
      const description = server.tagDescription
        ? `${server.longName}: ${server.tagDescription}. Live player counts, population history, and server details on EQEmulator.dev.`
        : `${server.longName} — live player counts, population history, and server details on EQEmulator.dev.`;
      return {
        title,
        description,
        openGraph: { title, description },
      };
    }
  } catch {}
  return { title: "Server Details" };
}

async function getServer(idOrSlug: string) {
  const numId = parseInt(idOrSlug, 10);
  const [server] = await db
    .select()
    .from(loginWorldServers)
    .where(
      isNaN(numId)
        ? eq(loginWorldServers.shortName, idOrSlug)
        : eq(loginWorldServers.id, numId)
    )
    .limit(1);
  return server || null;
}

async function getProfile(worldServerId: number, adminId: number) {
  // Look up by worldServerId OR by loginServerAdminId (for profiles created before server connects)
  const conditions = [eq(serverProfiles.worldServerId, worldServerId)];
  if (adminId > 0) {
    conditions.push(eq(serverProfiles.loginServerAdminId, adminId));
  }
  const [profile] = await db
    .select()
    .from(serverProfiles)
    .where(or(...conditions))
    .limit(1);
  return profile || null;
}

async function getLiveData(shortName: string, longName: string) {
  const http = require("http");
  const apiUrl = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
  const token = process.env.LOGINSERVER_API_TOKEN || "";
  const servers: any[] = await new Promise((resolve) => {
    const req = http.get(`${apiUrl}/v1/servers/list`, {
      headers: { Authorization: `Bearer ${token}` },
    }, (res: any) => {
      let data = "";
      res.on("data", (chunk: string) => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(Array.isArray(json) ? json : []);
        } catch { resolve([]); }
      });
    });
    req.on("error", () => resolve([]));
    req.setTimeout(5000, () => { req.destroy(); resolve([]); });
  });

  const local = servers.find(
    (s) => s.server_short_name === shortName || s.server_long_name === longName
  );
  if (local) return local;

  // Fallback: check federated live cache for servers not connected to this loginserver
  try {
    const { getFederatedLiveServers } = require("@/lib/federation/sync");
    const federated = getFederatedLiveServers();
    return federated.find(
      (s: any) => s.server_short_name === shortName || s.server_long_name === longName
    ) || null;
  } catch {
    return null;
  }
}

export default async function ServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id: rawId } = await params;

  const server = await getServer(decodeURIComponent(rawId));
  if (!server) notFound();

  const adminId = server.loginServerAdminId || 0;
  const isClaimed = adminId > 0;
  const isTrusted = !!server.isServerTrusted || isClaimed;

  const [profile, liveData] = await Promise.all([
    getProfile(server.id, adminId),
    getLiveData(server.shortName, server.longName),
  ]);

  const serverJsonLd = {
    "@context": "https://schema.org",
    "@type": "GameServer",
    name: server.longName,
    url: `https://eqemulator.dev/servers/${server.id}`,
    description: profile?.description
      ? profile.description.replace(/<[^>]*>/g, "").slice(0, 200)
      : server.tagDescription || `${server.longName} — EverQuest private server on EQEmulator.dev`,
    game: {
      "@type": "VideoGame",
      name: "EverQuest",
    },
    ...(liveData?.players_online !== undefined && {
      numberOfPlayers: liveData.players_online,
      serverStatus: liveData.server_status ? "Online" : "Offline",
    }),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serverJsonLd) }}
      />
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />

      <div className="relative min-h-screen">
        <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <Link href="/servers" className="group inline-flex items-center gap-2 text-parchment-600 text-xs font-display tracking-[0.15em] uppercase mb-6 hover:text-frost-400 transition-colors">
            <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
            Server Directory
          </Link>

          {/* Server HUD — unified info + live stats panel */}
          <ServerHUD
            serverId={server.id}
            info={{
              longName: server.longName,
              shortName: server.shortName,
              ipAddress: server.lastIpAddress || "",
              isTrusted,
              isClaimed,
              tagDescription: server.tagDescription || "",
              websiteUrl: profile?.websiteUrl,
              discordUrl: profile?.discordUrl,
              expansionEra: profile?.expansionEra,
              description: profile?.description,
            }}
            initialPlayers={liveData?.players_online ?? 0}
            initialStatus={liveData?.server_status ?? 0}
          />

          {/* Population chart */}
          <div className="mt-5">
            <PopulationChart serverId={server.id} shortName={server.shortName} />
          </div>

          {/* Banner */}
          {profile?.bannerImageUrl && (
            <div className="mt-5 relative overflow-hidden rounded-lg border border-frost-400/8">
              <img
                src={profile.bannerImageUrl}
                alt={`${server.longName} banner`}
                className="w-full h-48 sm:h-56 object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e16]/60 to-transparent pointer-events-none" />
            </div>
          )}

          {/* Description */}
          <div className="mt-5 relative overflow-hidden rounded-lg border border-frost-400/8 bg-gradient-to-br from-[#0a0e16]/95 via-[#0e1420]/95 to-[#0c1019]/95">
            <div className="absolute top-0 left-0 w-12 h-px bg-gradient-to-r from-frost-400/20 to-transparent" />
            <div className="absolute top-0 left-0 h-12 w-px bg-gradient-to-b from-frost-400/20 to-transparent" />
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-1 w-1 rounded-full bg-arcane-400/50" />
                <span className="font-display text-[10px] tracking-[0.25em] uppercase text-arcane-400/60">
                  Server Description
                </span>
              </div>
              {profile?.description ? (
                <div
                  className="text-parchment-400 text-sm leading-relaxed prose prose-invert prose-sm max-w-none
                    [&_a]:text-frost-400 [&_a]:no-underline hover:[&_a]:text-frost-300
                    [&_strong]:text-parchment-200 [&_li]:text-parchment-400
                    [&_ul]:pl-5 [&_ol]:pl-5 [&_p]:mb-3 [&_h1]:text-parchment-100 [&_h2]:text-parchment-100 [&_h3]:text-parchment-100"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(profile.description) }}
                />
              ) : (
                <p className="text-parchment-600 text-sm italic">
                  No description available. Server operators can claim this listing to add details.
                </p>
              )}
            </div>
          </div>

          {/* Ruleset */}
          {profile?.customRuleset && (
            <div className="mt-5 relative overflow-hidden rounded-lg border border-frost-400/8 bg-gradient-to-br from-[#0a0e16]/95 via-[#0e1420]/95 to-[#0c1019]/95">
              <div className="absolute top-0 left-0 w-12 h-px bg-gradient-to-r from-arcane-400/20 to-transparent" />
              <div className="absolute top-0 left-0 h-12 w-px bg-gradient-to-b from-arcane-400/20 to-transparent" />
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-1 w-1 rounded-full bg-frost-400/50" />
                  <span className="font-display text-[10px] tracking-[0.25em] uppercase text-frost-400/60">
                    Custom Ruleset
                  </span>
                </div>
                <div className="text-parchment-400 text-sm leading-relaxed whitespace-pre-wrap">
                  {profile.customRuleset}
                </div>
              </div>
            </div>
          )}

          {/* Page footer */}
          <div className="mt-10 flex items-center justify-center gap-4 text-[9px] text-parchment-700 uppercase tracking-[0.2em]">
            <span>EQEmulator Server Telemetry</span>
            <span className="text-frost-400/10">|</span>
            <span>Real-time monitoring</span>
          </div>
        </div>
      </div>
    </>
  );
}
