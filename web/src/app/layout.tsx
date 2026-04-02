import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://eqemulator.dev";

export const metadata: Metadata = {
  title: {
    default: "EQEmulator.dev — EverQuest Private Server Directory & Login",
    template: "%s | EQEmulator.dev",
  },
  description:
    "Browse EverQuest private servers with live player counts. Community-run login infrastructure compatible with existing eqemulator.net accounts. Server directory, operator tools, and federated login.",
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
    title: "EQEmulator.dev — EverQuest Private Server Directory & Login",
    description:
      "Browse EverQuest private servers with live player counts. Community-run login infrastructure compatible with existing eqemulator.net accounts.",
  },
  twitter: {
    card: "summary",
    title: "EQEmulator.dev — EverQuest Private Server Directory & Login",
    description:
      "Browse EverQuest private servers with live player counts. Community-run login infrastructure.",
  },
  alternates: {
    canonical: SITE_URL,
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
      <body className="min-h-screen bg-obsidian-950 text-parchment-300 antialiased font-body relative">
        <div className="relative z-10">
          {children}
        </div>
      </body>
    </html>
  );
}
