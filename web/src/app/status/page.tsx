import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { StatusDashboard } from "./status-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "System Status — Service Health & Uptime",
  description:
    "Real-time health and uptime monitoring for EQEmulator.dev login infrastructure. Service status, system metrics, and performance telemetry.",
  openGraph: {
    title: "EQEmulator.dev System Status",
    description: "Real-time health and uptime monitoring for EQEmulator.dev login infrastructure.",
  },
};

export default async function StatusPage() {
  const session = await getSession();

  return (
    <>
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />
      <StatusDashboard />
    </>
  );
}
