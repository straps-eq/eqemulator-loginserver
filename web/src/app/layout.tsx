import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EQEmulator — Gateway to Norrath",
  description:
    "The central login server and community hub for EverQuest private servers. Create an account, browse servers, and begin your journey.",
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
