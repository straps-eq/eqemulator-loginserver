/**
 * Background schedule for the client probe, started from instrumentation.ts.
 *
 * Every 10 minutes it checks whether a cycle is due (interval since the last
 * stored result, default 6 hours) and whether the probe is enabled on this
 * node; restarts therefore do not cause extra probing. The first check waits
 * a few minutes after startup plus a random offset so nodes do not line up.
 */
const CHECK_EVERY_MS = 10 * 60 * 1000;
const FIRST_CHECK_MIN_MS = 5 * 60 * 1000;
const FIRST_CHECK_JITTER_MS = 10 * 60 * 1000;
/** A cycle that stored nothing (e.g. loginserver down) is retried after this. */
const RETRY_AFTER_MS = 60 * 60 * 1000;

const g = globalThis as unknown as { __clientProbeScheduler?: boolean };

export function startClientProbeScheduler(): void {
  if (g.__clientProbeScheduler) return;
  g.__clientProbeScheduler = true;

  let lastAttempt = 0;
  const check = async () => {
    try {
      const runner = await import("./runner");
      const { enabled } = await runner.isProbeEnabled();
      if (!enabled || runner.getProbeState().running) return;
      const { getLastProbeTime } = await import("./store");
      const last = await getLastProbeTime();
      if (last && Date.now() - last.getTime() < runner.probeIntervalMs()) return;
      if (Date.now() - lastAttempt < RETRY_AFTER_MS) return;
      lastAttempt = Date.now();
      await runner.runProbeCycle({ trigger: "schedule" });
    } catch (err) {
      console.error("[client-probe] scheduler error:", err);
    }
  };

  const first = FIRST_CHECK_MIN_MS + Math.floor(Math.random() * FIRST_CHECK_JITTER_MS);
  setTimeout(() => {
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS);
  }, first);
  console.log(`[client-probe] scheduler armed (first check in ${Math.round(first / 60000)} min)`);
}
