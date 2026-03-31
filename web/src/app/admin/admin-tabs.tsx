"use client";

import { useState } from "react";
import { Users, Network, Server, KeyRound } from "lucide-react";
import { AdminDashboard } from "./admin-dashboard";
import { FederationDashboard } from "./federation-dashboard";
import { ServersDashboard } from "./servers-dashboard";
import { LoginserverAccountsDashboard } from "./loginserver-accounts-dashboard";

const tabs = [
  { id: "accounts", label: "Accounts", icon: Users },
  { id: "loginserver", label: "Loginserver", icon: KeyRound },
  { id: "servers", label: "Servers", icon: Server },
  { id: "federation", label: "Federation", icon: Network },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function AdminTabs({ adminRole }: { adminRole: "admin" | "moderator" }) {
  const [activeTab, setActiveTab] = useState<TabId>("accounts");

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
    </div>
  );
}
