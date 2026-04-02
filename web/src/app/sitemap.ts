import { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { loginWorldServers } from "@/db/schema";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://eqemulator.dev";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1.0 },
    { url: `${SITE_URL}/servers`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/getting-started`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/server-operators`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/security`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/status`, changeFrequency: "always", priority: 0.4 },
  ];

  // Dynamic server detail pages
  let serverPages: MetadataRoute.Sitemap = [];
  try {
    const servers = await db
      .select({ id: loginWorldServers.id, shortName: loginWorldServers.shortName })
      .from(loginWorldServers);

    serverPages = servers.map((s) => ({
      url: `${SITE_URL}/servers/${s.id}`,
      changeFrequency: "hourly" as const,
      priority: 0.7,
    }));
  } catch {
    // DB unavailable — return static pages only
  }

  return [...staticPages, ...serverPages];
}
