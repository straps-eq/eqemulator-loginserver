import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://eqemulator.dev";

export const metadata: Metadata = {
  title: {
    default: "EverQuest Emulator Servers — Live Server List & How to Play | EQEmulator.dev",
    template: "%s | EQEmulator.dev",
  },
  description:
    "Find a free, community-run EverQuest Emulator server and start playing. Live player counts for every world, setup guides for Titanium, RoF2, ToB and live clients, and a login that works with your existing EQEmulator forum account.",
  keywords: [
    "everquest", "eq emulator", "eqemu", "everquest private server",
    "eq private server", "eqemu server list", "everquest emulator",
    "eq server list", "everquest server directory",
  ],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "EQEmulator.dev",
    title: "EverQuest Emulator Servers — Live Server List & How to Play",
    description:
      "Find a free, community-run EverQuest Emulator server and start playing. Live player counts, setup guides, and a login that works with your existing forum account.",
  },
  twitter: {
    card: "summary_large_image",
    title: "EverQuest Emulator Servers — Live Server List & How to Play",
    description: "Find a free, community-run EverQuest Emulator server and start playing.",
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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-screen bg-[#1a2140] text-parchment-300 antialiased font-body relative">
        <div className="relative z-10">
          {children}
        </div>
      </body>
    </html>
  );
}
