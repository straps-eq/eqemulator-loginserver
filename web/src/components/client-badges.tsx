import { CLIENT_LABELS, CLIENT_ORDER, CLIENT_TITLES, type ClientId } from "@/lib/client-probe/labels";

/** Shape of PublicServer.client_support (lib/client-probe/store.ts). */
export interface ClientSupportView {
  checked_at: string;
  supported: string[];
  blocked: string[];
  unreachable: boolean;
}

function ordered(ids: string[]): ClientId[] {
  return CLIENT_ORDER.filter((c) => ids.indexOf(c) !== -1);
}

function checkedTitle(summary: ClientSupportView): string {
  const d = new Date(summary.checked_at);
  return Number.isNaN(d.getTime()) ? "" : `Checked ${d.toUTCString()}`;
}

/** One-line list for directory rows: "Titanium · RoF2 · ToB". Renders nothing if unknown. */
export function ClientSupportInline({ summary }: { summary?: ClientSupportView | null }) {
  if (!summary) return null;
  const supported = ordered(summary.supported);
  if (supported.length === 0) return null;
  return (
    <span className="text-[10px] text-parchment-600 truncate block" title={checkedTitle(summary)}>
      {supported.map((c, i) => (
        <span key={c}>
          {i > 0 && " · "}
          <span className={c === "tob" ? "text-frost-300" : undefined}>{CLIENT_LABELS[c]}</span>
        </span>
      ))}
    </span>
  );
}

/** Badges for the server detail page, with "not checked yet" handling. */
export function ClientSupportBadges({ summary }: { summary?: ClientSupportView | null }) {
  if (!summary) {
    return <span className="text-parchment-600 italic">Not checked yet</span>;
  }
  const supported = ordered(summary.supported);
  const blocked = ordered(summary.blocked);
  if (supported.length === 0 && blocked.length === 0) {
    return (
      <span className="text-parchment-600 italic" title={checkedTitle(summary)}>
        {summary.unreachable ? "Could not be checked" : "None detected"}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" title={checkedTitle(summary)}>
      {supported.map((c) =>
        c === "tob" ? (
          // ToB support is new: give it a little more shine than the rest
          <span
            key={c}
            title={CLIENT_TITLES[c]}
            className="inline-flex items-center gap-1 text-[9px] font-display uppercase tracking-wider text-frost-100 bg-frost-300/15 border border-frost-300/50 px-1.5 py-0.5 rounded shadow-glow-gold"
          >
            {CLIENT_LABELS[c]}
            <span className="rounded-sm bg-gradient-to-b from-[#f4d590] to-[#d4a650] px-1 text-[8px] font-bold leading-[1.4] text-[#1b2350]">
              New
            </span>
          </span>
        ) : (
          <span
            key={c}
            title={CLIENT_TITLES[c]}
            className="text-[9px] font-display uppercase tracking-wider text-frost-300 bg-frost-400/10 border border-frost-400/20 px-1.5 py-0.5 rounded"
          >
            {CLIENT_LABELS[c]}
          </span>
        )
      )}
      {blocked.map((c) => (
        <span
          key={c}
          title={`${CLIENT_TITLES[c]}: recognized but not allowed on this server`}
          className="text-[9px] font-display uppercase tracking-wider text-parchment-600 border border-parchment-700/30 px-1.5 py-0.5 rounded line-through"
        >
          {CLIENT_LABELS[c]}
        </span>
      ))}
    </span>
  );
}
