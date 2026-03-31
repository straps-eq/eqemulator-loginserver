import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { AdminTabs } from "./admin-tabs";

export default async function AdminPage() {
  const session = await getSession();

  if (!session.isLoggedIn || !session.isAdmin) {
    redirect("/");
  }

  return (
    <>
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-parchment-200">
          Admin Panel
        </h1>
        <p className="mt-1 mb-6 text-sm text-parchment-600">
          Manage platform accounts, roles, server registrations, and federation
        </p>
        <AdminTabs adminRole={session.adminRole || "moderator"} />
      </div>
    </>
  );
}
