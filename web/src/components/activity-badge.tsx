import { ACTIVITY_LABELS, activityLevel, type Activity } from "@/lib/activity";
import { cn } from "@/lib/utils";

/** Text color per band. Idle is quiet, not alarming: a small world is still a world. */
export const ACTIVITY_TEXT: Record<Activity, string> = {
  idle: "text-parchment-500",
  low: "text-parchment-200",
  medium: "text-frost-300",
  high: "text-forest-400",
};

const BAR_ON: Record<Activity, string> = {
  idle: "bg-parchment-600",
  low: "bg-parchment-300",
  medium: "bg-frost-400",
  high: "bg-forest-400",
};

/** Three rising bars, lit up to the band (none for Idle), like a signal meter. */
export function ActivityBars({ activity, className }: { activity: Activity; className?: string }) {
  const lit = activityLevel(activity);
  return (
    <span className={cn("inline-flex items-end gap-[2px]", className)} aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-[1px]", i <= lit ? BAR_ON[activity] : "bg-parchment-600/30")}
          style={{ height: `${4 + i * 3}px` }}
        />
      ))}
    </span>
  );
}

/** Inline band: bars + label, e.g. in a server row. */
export function ActivityBadge({ activity, className }: { activity?: Activity | null; className?: string }) {
  const a: Activity = activity ?? "idle";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 font-display text-xs tracking-wider uppercase", ACTIVITY_TEXT[a], className)}
      title={`Activity: ${ACTIVITY_LABELS[a]}`}
    >
      <ActivityBars activity={a} />
      {ACTIVITY_LABELS[a]}
    </span>
  );
}
