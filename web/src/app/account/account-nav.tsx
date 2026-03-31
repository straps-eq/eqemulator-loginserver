"use client";

import { useEffect, useState } from "react";
import { User, Globe, Shield } from "lucide-react";

const sections = [
  { id: "platform", label: "Platform Account", icon: User },
  { id: "worldserver", label: "World Server Accounts", icon: Globe },
  { id: "client-setup", label: "EQ Client Setup", icon: Shield },
];

export function AccountNav() {
  const [active, setActive] = useState("platform");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActive(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 }
    );

    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <nav className="hidden lg:block w-48 shrink-0">
      <div className="sticky top-24 space-y-0.5">
        {sections.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              setActive(id);
            }}
            className={`flex items-center gap-2 px-3 py-2 rounded text-xs font-display transition-colors ${
              active === id
                ? "text-frost-400 bg-frost-400/[0.06] border-l-2 border-frost-400/40"
                : "text-parchment-500 hover:text-parchment-300 hover:bg-frost-400/[0.03] border-l-2 border-transparent"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
