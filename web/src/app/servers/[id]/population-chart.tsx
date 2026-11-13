"use client";

import { useEffect, useState, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { ACTIVITY_LABELS, ACTIVITY_ORDER, type Activity } from "@/lib/activity";

/**
 * Activity history from /api/servers/[id]/history: a band level (0 idle ..
 * 3 high) and a coarse position inside the band (pos 0..1) per sample.
 */
interface StatsData {
  history: { level: number; pos?: number; time: string }[];
  /** avg / max only for the world's owner and admins. */
  stats: { typical: Activity | null; busiest: Activity | null; samples: number; avg?: number; max?: number };
}

/** Horizontal zone per band behind the line: fill, edge line and label color. */
const ZONES = [
  { fill: "rgba(120,110,100,0.07)", edge: "rgba(184,158,122,0.10)", label: "rgba(184,158,122,0.55)" },
  { fill: "rgba(217,204,180,0.07)", edge: "rgba(217,204,180,0.14)", label: "rgba(217,204,180,0.70)" },
  { fill: "rgba(212,166,80,0.10)", edge: "rgba(212,166,80,0.20)", label: "rgba(227,194,122,0.85)" },
  { fill: "rgba(109,166,122,0.12)", edge: "rgba(109,166,122,0.24)", label: "rgba(130,190,145,0.90)" },
];

/**
 * Chart height for a sample: band i fills [i, i+1]. Idle sits in the middle
 * of its zone; other bands move between 0.12 and 0.88 of theirs by position.
 */
function plotY(level: number, pos: number | undefined): number {
  if (level <= 0) return 0.5;
  return level + 0.12 + (pos ?? 0.5) * 0.76;
}

function UPlotChart({ data }: { data: StatsData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  // Build uPlot chart
  useEffect(() => {
    if (!containerRef.current || data.history.length < 2) return;

    const timestamps = data.history.map((h) => Math.floor(new Date(h.time).getTime() / 1000));
    const ys = data.history.map((h) => plotY(h.level, h.pos));
    const plotData: uPlot.AlignedData = [timestamps, ys];

    const gradientFill = (u: uPlot) => {
      const ctx = u.ctx;
      const { top, height } = u.bbox;
      const grad = ctx.createLinearGradient(0, top, 0, top + height);
      grad.addColorStop(0, "rgba(212,166,80,0.18)");
      grad.addColorStop(0.4, "rgba(212,166,80,0.06)");
      grad.addColorStop(1, "rgba(212,166,80,0.0)");
      return grad;
    };

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      padding: [8, 12, 0, 0],
      cursor: {
        x: true,
        y: false,
        points: {
          size: 8,
          fill: "rgba(212,166,80,0.9)",
          stroke: "rgba(212,166,80,0.4)",
          width: 2,
        },
      },
      legend: { show: false },
      axes: [
        {
          stroke: "rgba(217,204,180,0.35)",
          grid: { stroke: "rgba(212,166,80,0.04)", width: 1 },
          ticks: { stroke: "rgba(212,166,80,0.06)", width: 1, size: 4 },
          font: "9px 'JetBrains Mono', monospace",
          labelFont: "9px 'JetBrains Mono', monospace",
          gap: 4,
          size: 32,
          values: (u: uPlot, vals: number[]) =>
            vals.map((v) => {
              const d = new Date(v * 1000);
              return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            }),
        },
        {
          // Band names readable at a glance (the axis stroke is the label color)
          stroke: "rgba(217,204,180,0.65)",
          ticks: { show: false },
          font: "10px 'JetBrains Mono', monospace",
          labelFont: "10px 'JetBrains Mono', monospace",
          gap: 6,
          size: 58,
          // One tick per zone, at its middle, labelled with the band name.
          splits: () => [0.5, 1.5, 2.5, 3.5],
          values: (u: uPlot, vals: number[]) => vals.map((v) => ACTIVITY_LABELS[ACTIVITY_ORDER[Math.floor(v)]] ?? ""),
          grid: { show: false },
        },
      ],
      scales: {
        x: { time: true },
        // Always the full Idle..High scale, so a quiet world reads as quiet, not as a dramatic swing.
        y: { auto: false, range: [0, 4] },
      },
      series: [
        {},
        {
          label: "Activity",
          stroke: "rgba(212,166,80,0.85)",
          width: 2,
          fill: gradientFill as any,
          points: { show: false },
          paths: uPlot.paths.spline!(),
        },
      ],
      hooks: {
        drawClear: [
          (u: uPlot) => {
            const ctx = u.ctx;
            const { left, width } = u.bbox;
            ctx.save();
            for (let i = 0; i < ZONES.length; i++) {
              const top = Math.round(u.valToPos(i + 1, "y", true));
              const bottom = Math.round(u.valToPos(i, "y", true));
              ctx.fillStyle = ZONES[i].fill;
              ctx.fillRect(left, top, width, bottom - top);
              // Thin edge between zones
              ctx.fillStyle = ZONES[i].edge;
              ctx.fillRect(left, top, width, 1);
            }
            ctx.restore();
          },
        ],
      },
    };

    if (plotRef.current) plotRef.current.destroy();
    plotRef.current = new uPlot(opts, plotData, containerRef.current);

    const onResize = () => {
      if (containerRef.current && plotRef.current) {
        plotRef.current.setSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [data]);

  return <div ref={containerRef} className="w-full h-full uplot-dark" />;
}

export function PopulationChart({ serverId, shortName }: { serverId: number; shortName?: string }) {
  const [data, setData] = useState<StatsData | null>(null);
  const [days, setDays] = useState(1);
  const [mounted, setMounted] = useState(false);
  const apiId = shortName ? encodeURIComponent(shortName) : serverId;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/servers/${apiId}/history?days=${days}`);
        if (res.ok) setData(await res.json());
      } catch {}
    };
    load();
    const interval = setInterval(load, 60 * 1000);
    return () => clearInterval(interval);
  }, [apiId, days]);

  const step = days <= 1 ? "1m" : days <= 7 ? "5m" : "15m";

  return (
    <div className={`relative overflow-hidden rounded-lg border border-frost-400/10 transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-[#151b2e] via-[#1b2238] to-[#080d14]" />
      <div className="absolute top-0 left-0 w-16 h-px bg-gradient-to-r from-frost-400/20 to-transparent" />
      <div className="absolute top-0 left-0 h-16 w-px bg-gradient-to-b from-frost-400/20 to-transparent" />
      <div className="absolute bottom-0 right-0 w-16 h-px bg-gradient-to-l from-frost-400/20 to-transparent" />
      <div className="absolute bottom-0 right-0 h-16 w-px bg-gradient-to-t from-frost-400/20 to-transparent" />

      <div className="relative px-4 pt-4 pb-3 sm:px-5 sm:pt-4 sm:pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="h-1 w-1 rounded-full bg-frost-400" />
              <div className="absolute inset-0 h-1 w-1 rounded-full bg-frost-400 animate-ping opacity-30" />
            </div>
            <span className="font-display text-[9px] tracking-[0.25em] uppercase text-frost-400/60">
              Activity History
            </span>
            {data && data.stats.samples > 0 && data.stats.typical && (
              <span className="text-[9px] text-parchment-600 font-mono ml-2">
                typical {ACTIVITY_LABELS[data.stats.typical].toLowerCase()}
                {data.stats.busiest ? ` · busiest ${ACTIVITY_LABELS[data.stats.busiest].toLowerCase()}` : ""}
              </span>
            )}
            {data && typeof data.stats.avg === "number" && typeof data.stats.max === "number" && (
              <span className="text-[9px] text-parchment-500 font-mono ml-2" title="Only you can see exact numbers">
                avg {data.stats.avg} · peak {data.stats.max} players (only visible to you)
              </span>
            )}
          </div>
          <div className="flex gap-0.5">
            {[
              { d: 1, label: "24H" },
              { d: 7, label: "7D" },
              { d: 30, label: "30D" },
            ].map(({ d, label }) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2 py-0.5 rounded text-[9px] font-display tracking-wider uppercase transition-all duration-300 ${
                  days === d
                    ? "bg-frost-400/10 text-frost-400 border border-frost-400/15"
                    : "text-parchment-600 hover:text-parchment-400 border border-transparent"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {data && data.history.length > 1 ? (
          <div className="h-44 sm:h-48">
            <UPlotChart data={data} />
          </div>
        ) : data && data.history.length <= 1 ? (
          <div className="h-44 sm:h-48 flex flex-col items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-frost-400/30 animate-pulse mb-3" />
            <p className="text-parchment-600 text-[10px] font-display tracking-wide uppercase">
              Collecting telemetry data
            </p>
            <p className="text-parchment-700 text-[9px] mt-1">
              Prometheus recording every 60s. Check back shortly.
            </p>
          </div>
        ) : (
          <div className="h-44 sm:h-48 flex items-center justify-center">
            <div className="h-1.5 w-1.5 rounded-full bg-frost-400/40 animate-pulse" />
          </div>
        )}

        {data && data.history.length > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-frost-400/5 text-[8px] text-parchment-700 uppercase tracking-[0.15em] font-mono">
            <span>{data.stats.samples} samples · {step} resolution</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1 w-1 rounded-full bg-frost-400/50 animate-pulse" />
              prometheus
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
