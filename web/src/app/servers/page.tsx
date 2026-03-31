import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { ServerList } from "./server-list";

export const dynamic = "force-dynamic";

async function getServers() {
  const apiUrl = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
  const token = process.env.LOGINSERVER_API_TOKEN || "";
  return new Promise<any[]>((resolve) => {
    const http = require("http");
    const req = http.get(`${apiUrl}/v1/servers/list`, {
      headers: { Authorization: `Bearer ${token}` },
    }, (res: any) => {
      let data = "";
      res.on("data", (chunk: string) => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(Array.isArray(json) ? json : json?.data || []);
        } catch {
          resolve([]);
        }
      });
    });
    req.on("error", () => resolve([]));
    req.setTimeout(5000, () => { req.destroy(); resolve([]); });
  });
}

export default async function ServersPage() {
  const session = await getSession();
  const servers = await getServers();

  return (
    <>
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <ServerList initial={servers} />
      </div>
    </>
  );
}
