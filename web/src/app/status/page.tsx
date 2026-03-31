import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { StatusDashboard } from "./status-dashboard";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const session = await getSession();

  return (
    <>
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />
      <StatusDashboard />
    </>
  );
}
