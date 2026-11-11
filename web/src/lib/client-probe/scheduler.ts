/**
 * Background schedule for the client probe, started from instrumentation.ts.
 *
 * Every 10 minutes it checks whether a cycle is due (interval since the last
 * stored result, default 6 hours) and whether the probe is enabled on this
 * node; restarts therefore do not cause extra probing. The first check waits
 * a few minutes after startup plus a random offset so nodes do not line up.
 *
 * Every minute it also looks for connected worlds that have never been
 * probed for every client (a world that just registered or connected for the
 * first time, or a client that was just added) and
 * probes only those, so a new world gets its badges without waiting for the
 * next full cycle.
 */
const CHECK_EVERY_MS = 10 * 60 * 1000;
const FIRST_CHECK_MIN_MS = 5 * 60 * 1000;
const FIRST_CHECK_JITTER_MS = 10 * 60 * 1000;
/** A cycle that stored nothing (e.g. loginserver down) is retried after this. */
const RETRY_AFTER_MS = 60 * 60 * 1000;
const NEW_WORLD_CHECK_MS = 60 * 1000;
const NEW_WORLD_FIRST_CHECK_MS = 2 * 60 * 1000;
/** A new world whose probe stored nothing is tried again after this. */
const NEW_WORLD_RETRY_MS = 30 * 60 * 1000;

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

  const newWorldAttempts = new Map<number, number>();
  const checkNewWorlds = async () => {
    try {
      const runner = await import("./runner");
      const { enabled } = await runner.isProbeEnabled();
      if (!enabled || runner.getProbeState().running) return;
      const { getAllProbeRows } = await import("./store");
      // A world counts as probed once it has a result for every probed client,
      // so adding a client (like EQL) also gets every world tested for it.
      const wanted = runner.probeClients().map((c) => c.id as string);
      const have = new Map<number, Set<string>>();
      for (const r of await getAllProbeRows()) {
        const id = Number(r.world_server_id);
        if (!have.has(id)) have.set(id, new Set());
        have.get(id)!.add(r.client);
      }
      const probed = new Set(
        Array.from(have.entries()).filter(([, got]) => wanted.every((c) => got.has(c))).map(([id]) => id)
      );
      const { targets } = await runner.getTargets();
      const now = Date.now();
      const fresh = targets
        .map((t) => t.worldServerId)
        .filter((id) => !probed.has(id) && now - (newWorldAttempts.get(id) || 0) >= NEW_WORLD_RETRY_MS);
      if (fresh.length === 0) return;
      for (const id of fresh) newWorldAttempts.set(id, now);
      await runner.runProbeCycle({ trigger: "new world", worldServerIds: fresh });
    } catch (err) {
      console.error("[client-probe] new world check error:", err);
    }
  };
  setTimeout(() => {
    void checkNewWorlds();
    setInterval(() => void checkNewWorlds(), NEW_WORLD_CHECK_MS);
  }, NEW_WORLD_FIRST_CHECK_MS);

  const first = FIRST_CHECK_MIN_MS + Math.floor(Math.random() * FIRST_CHECK_JITTER_MS);
  setTimeout(() => {
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS);
  }, first);
  console.log(`[client-probe] scheduler armed (first check in ${Math.round(first / 60000)} min)`);
}
