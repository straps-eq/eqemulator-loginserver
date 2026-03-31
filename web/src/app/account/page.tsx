import { redirect } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/session";
import { User, Globe, Shield } from "lucide-react";
import { ChangePasswordButton } from "./change-password-form";
import { AccountNav } from "./account-nav";
import { WorldServerAccounts } from "./worldserver-accounts";

export default async function AccountPage() {
  const session = await getSession();

  if (!session.isLoggedIn) {
    redirect("/login");
  }

  return (
    <>
      <Navbar accountName={session.accountName} isAdmin={session.isAdmin} />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div className="mb-10">
          <span className="font-display text-xs tracking-[0.3em] uppercase text-frost-400/60 block mb-3">EQEmulator.dev</span>
          <h1 className="font-display text-2xl font-bold text-parchment-100">Account Settings</h1>
        </div>

        <div className="flex gap-8">
          {/* Side Nav */}
          <AccountNav />

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-8">
            {/* Platform Account */}
            <section id="platform">
              <div className="flex items-center gap-2 mb-4">
                <User className="h-4 w-4 text-frost-400/70" />
                <h2 className="font-display text-sm font-semibold text-parchment-200 uppercase tracking-wider">
                  Platform Account
                </h2>
              </div>
              <div className="rounded-lg border border-frost-400/8 bg-gradient-to-b from-[#171d2d]/90 to-[#131825]/95 p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2">
                    <dt className="text-xs font-display text-parchment-500 uppercase tracking-wider">Username</dt>
                    <dd className="text-sm text-parchment-100 font-medium">{session.accountName}</dd>
                    <dt className="text-xs font-display text-parchment-500 uppercase tracking-wider">Account ID</dt>
                    <dd className="text-sm text-parchment-100 font-medium">{session.accountId}</dd>
                  </dl>
                  <ChangePasswordButton />
                </div>
              </div>
            </section>

            {/* World Server Accounts */}
            <section id="worldserver">
              <div className="flex items-center gap-2 mb-4">
                <Globe className="h-4 w-4 text-arcane-400/70" />
                <h2 className="font-display text-sm font-semibold text-parchment-200 uppercase tracking-wider">
                  World Server Accounts
                </h2>
              </div>
              <div className="rounded-lg border border-frost-400/8 bg-gradient-to-b from-[#171d2d]/90 to-[#131825]/95 p-5 sm:p-6">
                <WorldServerAccounts />
              </div>
            </section>

            {/* EQ Client Setup */}
            <section id="client-setup">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="h-4 w-4 text-frost-400/70" />
                <h2 className="font-display text-sm font-semibold text-parchment-200 uppercase tracking-wider">
                  EQ Client Setup
                </h2>
              </div>
              <div className="rounded-lg border border-frost-400/8 bg-gradient-to-b from-[#171d2d]/90 to-[#131825]/95 p-5 sm:p-6">
                <p className="text-parchment-400 text-sm mb-4">
                  To connect to servers through this login server, update your{" "}
                  <code className="text-frost-400 bg-[#0e1017] px-1.5 py-0.5 rounded text-xs">eqhost.txt</code> file:
                </p>
                <pre className="bg-[#0a0e17] border border-frost-400/6 rounded-lg p-4 text-sm text-parchment-300 overflow-x-auto font-mono">
{`[LoginServer]
Host=login.eqemulator.dev:5999`}
                </pre>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
