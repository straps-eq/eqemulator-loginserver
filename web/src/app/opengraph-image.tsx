import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "EQEmulator.dev — EverQuest private servers, live";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default social preview card. Plain generated art, no game imagery. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(160deg, #080b12 0%, #0e1420 55%, #0b1a26 100%)",
          color: "#f3efe5",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ fontSize: 28, letterSpacing: 12, textTransform: "uppercase", color: "#7ad2fd", opacity: 0.8 }}>
          EverQuest Emulator
        </div>
        <div style={{ fontSize: 92, fontWeight: 700, marginTop: 18, color: "#e8dcc8" }}>EQEmulator.dev</div>
        <div style={{ fontSize: 36, marginTop: 24, color: "#c7b494", fontFamily: "sans-serif" }}>
          Private server directory with live player counts
        </div>
        <div style={{ marginTop: 56, width: 520, height: 2, background: "linear-gradient(90deg, transparent, #34bbfa, transparent)" }} />
      </div>
    ),
    size
  );
}
