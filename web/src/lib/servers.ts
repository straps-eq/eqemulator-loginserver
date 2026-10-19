import { db } from "@/lib/db";
import { loginWorldServers } from "@/db/schema";
import { slugify } from "@/lib/slug";

/**
 * Resolve a URL segment to a world server. Accepts the canonical slug
 * (derived from the long name), a numeric id, or the raw short name; the
 * page redirects the last two to the slug so each server has one URL.
 */
export async function getServer(segment: string) {
  const servers = await db.select().from(loginWorldServers);
  // Newest registration first, so a re-registered world wins over its stale row.
  servers.sort((a, b) => (b.lastLoginDate?.getTime() ?? 0) - (a.lastLoginDate?.getTime() ?? 0));

  const bySlug = servers.find((s) => slugify(s.longName) === segment);
  if (bySlug) return bySlug;

  const numId = parseInt(segment, 10);
  if (!isNaN(numId) && String(numId) === segment) {
    const byId = servers.find((s) => s.id === numId);
    if (byId) return byId;
  }

  return servers.find((s) => s.shortName === segment) || null;
}

/** Live row for a world from the loginserver, falling back to the federated cache. */
export async function getLiveData(shortName: string, longName: string) {
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

