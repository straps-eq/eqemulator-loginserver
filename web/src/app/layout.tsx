import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EQEmulator — Gateway to Norrath",
  description:
    "The central login server and community hub for EverQuest private servers. Create an account, browse servers, and begin your journey.",
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
