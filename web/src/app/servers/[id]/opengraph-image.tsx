import { ImageResponse } from "next/og";
import { getServer, getLiveData } from "@/lib/servers";

export const runtime = "nodejs";
export const alt = "EverQuest private server on EQEmulator.dev";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Per-server social preview: name, tagline and players online right now,
 * so a link pasted in Discord or Reddit unfurls with live numbers.
 */
export default async function ServerOpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  let name = "EverQuest Private Server";
  let tagline = "";
  let players: number | null = null;
  let online = false;

  try {
    const server = await getServer(decodeURIComponent(rawId));
    if (server) {
      name = server.longName;
      tagline = server.tagDescription || "";
      const live = await getLiveData(server.shortName, server.longName);
      if (live) {
        online = (live.server_status ?? 0) > 0;
        players = typeof live.players_online === "number" ? live.players_online : null;
      }
    }
  } catch {}

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(160deg, #080b12 0%, #0e1420 55%, #0b1a26 100%)",
          color: "#f3efe5",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 24, letterSpacing: 10, textTransform: "uppercase", color: "#7ad2fd", opacity: 0.8 }}>
            EverQuest Private Server
          </div>
          <div style={{ fontSize: name.length > 28 ? 60 : 80, fontWeight: 700, marginTop: 20, color: "#e8dcc8", lineHeight: 1.1 }}>
            {name}
          </div>
          {tagline && (
            <div style={{ fontSize: 34, marginTop: 20, color: "#c7b494", fontFamily: "sans-serif" }}>{tagline}</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "sans-serif" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 22, height: 22, borderRadius: 11, background: online ? "#6da67a" : "#5e1f2e" }} />
            <div style={{ fontSize: 40, color: online ? "#f3efe5" : "#b89e7a" }}>
              {players !== null ? `${players} online` : online ? "Online" : "Offline"}
            </div>
          </div>
          <div style={{ fontSize: 30, color: "#7ad2fd", opacity: 0.9 }}>eqemulator.dev</div>
        </div>
      </div>
    ),
    size
  );
}
