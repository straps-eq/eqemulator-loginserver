import { ImageResponse } from "next/og";
import { getServer, getLiveData } from "@/lib/servers";
import { activityFor, ACTIVITY_LABELS } from "@/lib/activity";
import { getActivityThresholds } from "@/lib/public-servers";

export const runtime = "nodejs";
export const alt = "EverQuest private server on EQEmulator.dev";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Per-server social preview: name, tagline and whether it's online with its
 * activity band (never an exact count), so a link pasted in Discord or Reddit
 * unfurls with live status.
 */
export default async function ServerOpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  let name = "EverQuest Private Server";
  let tagline = "";
  let band: string | null = null;
  let online = false;

  try {
    const server = await getServer(decodeURIComponent(rawId));
    if (server) {
      name = server.longName;
      tagline = server.tagDescription || "";
      const live = await getLiveData(server.shortName, server.longName);
      if (live) {
        online = (live.server_status ?? -1) >= 0;
        if (online) band = ACTIVITY_LABELS[activityFor(live.players_online, await getActivityThresholds())];
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
          background: "linear-gradient(160deg, #151b2e 0%, #222a44 55%, #0b1a26 100%)",
          color: "#f3efe5",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 24, letterSpacing: 10, textTransform: "uppercase", color: "#e3c27a", opacity: 0.8 }}>
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
              {online ? (band ? `Online · ${band} activity` : "Online") : "Offline"}
            </div>
          </div>
          <div style={{ fontSize: 30, color: "#e3c27a", opacity: 0.9 }}>eqemulator.dev</div>
        </div>
      </div>
    ),
    size
  );
}
