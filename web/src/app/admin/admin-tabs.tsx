"use client";

import { useState } from "react";
import { Users, Network, Server, KeyRound, Settings, ScrollText } from "lucide-react";
import { AdminDashboard } from "./admin-dashboard";
import { FederationDashboard } from "./federation-dashboard";
import { ServersDashboard } from "./servers-dashboard";
import { LoginserverAccountsDashboard } from "./loginserver-accounts-dashboard";
import { SystemDashboard } from "./system-dashboard";
import { LogsDashboard } from "./logs-dashboard";

const allTabs = [
  { id: "accounts", label: "Accounts", icon: Users, adminOnly: false },
  { id: "loginserver", label: "Loginserver", icon: KeyRound, adminOnly: false },
  { id: "servers", label: "Servers", icon: Server, adminOnly: false },
  { id: "federation", label: "Federation", icon: Network, adminOnly: false },
  { id: "system", label: "System", icon: Settings, adminOnly: true },
  { id: "logs", label: "Logs", icon: ScrollText, adminOnly: true },
] as const;

type TabId = (typeof allTabs)[number]["id"];

export function AdminTabs({ adminRole }: { adminRole: "admin" | "moderator" }) {
  const [activeTab, setActiveTab] = useState<TabId>("accounts");
  const tabs = allTabs.filter((t) => !t.adminOnly || adminRole === "admin");

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-frost-400/8">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-display uppercase tracking-wider border-b-2 transition-colors ${
                isActive
                  ? "border-frost-400 text-frost-300"
                  : "border-transparent text-parchment-600 hover:text-parchment-400"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "accounts" && <AdminDashboard />}
      {activeTab === "loginserver" && <LoginserverAccountsDashboard />}
      {activeTab === "servers" && <ServersDashboard />}
      {activeTab === "federation" && <FederationDashboard adminRole={adminRole} />}
      {activeTab === "system" && <SystemDashboard />}
      {activeTab === "logs" && <LogsDashboard />}
    </div>
  );
}
