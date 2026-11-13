/**
 * Activity bands: what the public site shows instead of player counts.
 *
 * Idle = nobody on, then Low / Medium / High by the admin tier thresholds
 * (platform_config tier_medium_min_players / tier_high_min_players). Exact
 * counts stay in Prometheus and the admin pages; public pages and APIs only
 * ever get the band.
 *
 * Pure module: safe to import from client components and unit tests.
 */

export type Activity = "idle" | "low" | "medium" | "high";

export const ACTIVITY_ORDER: Activity[] = ["idle", "low", "medium", "high"];

export const ACTIVITY_LABELS: Record<Activity, string> = {
  idle: "Idle",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export interface ActivityThresholds {
  /** Players at or above this are Medium. */
  mediumMin: number;
  /** Players at or above this are High. */
  highMin: number;
}

/** Low 1-74, Medium 75-250, High 251+. */
export const DEFAULT_THRESHOLDS: ActivityThresholds = { mediumMin: 75, highMin: 251 };

export function activityFor(players: number | null | undefined, t: ActivityThresholds = DEFAULT_THRESHOLDS): Activity {
  const n = Number(players) || 0;
  if (n <= 0) return "idle";
  if (n >= t.highMin) return "high";
  if (n >= t.mediumMin) return "medium";
  return "low";
}

/** 0 = idle ... 3 = high, for charts. */
export function activityLevel(a: Activity): number {
  return ACTIVITY_ORDER.indexOf(a);
}

export function activityFromLevel(level: number): Activity {
  const i = Math.max(0, Math.min(ACTIVITY_ORDER.length - 1, Math.round(level)));
  return ACTIVITY_ORDER[i];
}

/** Parse threshold config values, falling back to the defaults on anything unusable. */
export function parseThresholds(mediumRaw?: string | null, highRaw?: string | null): ActivityThresholds {
  const medium = parseInt(mediumRaw || "", 10);
  const high = parseInt(highRaw || "", 10);
  const mediumMin = Number.isFinite(medium) && medium >= 1 ? medium : DEFAULT_THRESHOLDS.mediumMin;
  const highMin = Number.isFinite(high) && high > mediumMin ? high : Math.max(DEFAULT_THRESHOLDS.highMin, mediumMin + 1);
  return { mediumMin, highMin };
}
