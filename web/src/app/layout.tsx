import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted at build time: no render-blocking request to Google Fonts.
// Fonts are bundled (latin subset, SIL OFL, see fonts/OFL-*.txt) so the build never
// depends on fonts.googleapis.com answering.
const cinzel = localFont({
  src: [
    { path: "./fonts/cinzel-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/cinzel-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/cinzel-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/cinzel-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-cinzel",
  display: "swap",
});
const cormorant = localFont({
  src: [
    { path: "./fonts/cormorant-garamond-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-cormorant",
  display: "swap",
});
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://eqemulator.dev";

export const metadata: Metadata = {
  title: {
    default: "EQEmu Server List — Live EQ Emulator Servers & How to Play | EQEmulator.dev",
    template: "%s | EQEmulator.dev",
  },
  description:
    "Find an EQEmu (EverQuest Emulator) server and start playing. Live player counts for every world, step-by-step guides for Titanium, RoF2 and ToB, and one game login for every world.",
  keywords: [
    "eqemu", "eq emu", "eq emulator", "eqemulator", "everquest emulator",
    "eqemu servers", "everquest private server",
    "eq private server", "eqemu server list",
    "eq server list", "everquest server directory",
  ],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "EQEmulator.dev",
    title: "EQEmu Server List — Live EQ Emulator Servers & How to Play",
    description:
      "Find an EQEmu server and start playing. Live player counts, step-by-step guides, and one game login for every world.",
  },
  twitter: {
    card: "summary_large_image",
    title: "EQEmu Server List — Live EQ Emulator Servers & How to Play",
    description: "Find an EQEmu server and start playing, with live player counts for every world.",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cinzel.variable} ${cormorant.variable} ${inter.variable}`}>
      <body className="min-h-screen bg-[#1a2140] text-parchment-300 antialiased font-body relative">
        <div className="relative z-10">
          {children}
        </div>
      </body>
    </html>
  );
}
