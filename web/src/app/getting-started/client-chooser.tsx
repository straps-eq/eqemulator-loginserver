"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { CodeBlock } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";

type ClientOption = {
  id: string;
  name: string;
  clients: string;
  port: number;
  badge?: string;
  note: ReactNode;
  warning?: ReactNode;
};

const OPTIONS: ClientOption[] = [
  {
    id: "rof2",
    name: "RoF2 / SoD+",
    clients: "Seeds of Destruction, Underfoot, Rain of Fear, RoF2",
    port: 5999,
    badge: "Most common",
    note: "The default for most servers. If you are unsure which client you have, use this one.",
  },
  {
    id: "tob",
    name: "ToB",
    clients: "ToB",
    port: 15900,
    badge: "New",
    note: "For players using the ToB client.",
    warning: (
      <>
        ToB players see every server in the list, but can only enter worlds that support ToB.
        Other worlds will fail at world entry. Check with your server before switching clients.
      </>
    ),
  },
  {
    id: "titanium",
    name: "Titanium",
    clients: "Titanium",
    port: 5998,
    note: "The classic client. Only use this port if your server asks for Titanium.",
  },
];

export function ClientChooser() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next = active;
    if (e.key === "ArrowRight") next = (active + 1) % OPTIONS.length;
    else if (e.key === "ArrowLeft") next = (active - 1 + OPTIONS.length) % OPTIONS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = OPTIONS.length - 1;
    else return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  const opt = OPTIONS[active];

  return (
    <div>
      <div
        role="tablist"
        aria-label="Choose your EverQuest client"
        onKeyDown={onKeyDown}
        className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4"
      >
        {OPTIONS.map((o, i) => {
          const selected = i === active;
          return (
            <button
              key={o.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`client-tab-${o.id}`}
              aria-selected={selected}
              aria-controls={`client-panel-${o.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              className={cn(
                "text-left rounded border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-frost-400/50",
                selected
                  ? "border-frost-400/40 bg-frost-400/10"
                  : "border-frost-400/8 bg-[#241c14] hover:border-frost-400/20"
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={cn("font-display text-sm font-semibold", selected ? "text-frost-200" : "text-parchment-200")}>
                  {o.name}
                </span>
                {o.badge && (
                  <span className="font-display text-[10px] tracking-wider uppercase text-frost-400/70">{o.badge}</span>
                )}
              </span>
              <span className="block font-mono text-xs text-parchment-500 mt-1">Port {o.port}</span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`client-panel-${opt.id}`} aria-labelledby={`client-tab-${opt.id}`}>
        <p className="text-parchment-400 text-sm mb-1">
          <strong className="text-parchment-200">{opt.name}</strong>
          {opt.clients !== opt.name && <> — {opt.clients}</>}
        </p>
        <p className="text-parchment-500 text-xs mb-3">{opt.note}</p>
        <p className="text-parchment-400 text-sm mb-2">
          Replace the contents of{" "}
          <code className="text-frost-400 bg-[#241c14] px-1.5 py-0.5 rounded text-xs">eqhost.txt</code> with:
        </p>
        <CodeBlock
          code={`[LoginServer]\nHost=login.eqemulator.dev:${opt.port}`}
          label={`eqhost.txt for ${opt.name}`}
        />
        {opt.warning && (
          <div className="mt-3 flex gap-2.5 rounded border border-gold-400/20 bg-gold-400/5 p-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-gold-300 mt-0.5" aria-hidden="true" />
            <p className="text-parchment-300 text-xs leading-relaxed">{opt.warning}</p>
          </div>
        )}
      </div>
    </div>
  );
}
