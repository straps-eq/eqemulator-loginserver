export async function register() {
  // Metrics collection is now handled by Prometheus scraping /api/metrics

  // Server-side only
  if (typeof window === "undefined" && process.env.NODE_ENV === "production") {
    const port = process.env.PORT || "3000";
    const syncSecret = process.env.FEDERATION_SYNC_SECRET || "";

    // ── Startup self-check: validate DB schema & grants via /api/health ──
    setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost:${port}/api/health`);
        if (res.ok) {
          const data = await res.json();
          if (data.issues && data.issues.length > 0) {
            console.warn(`[startup] ⚠ ${data.issues.length} issue(s) detected:`);
            data.issues.forEach((msg: string) => console.warn(`  → ${msg}`));
            console.warn("[startup] Run ./scripts/validate.sh for full diagnostics");
          } else {
            console.log(`[startup] ✓ DB schema and grants validated (${data.passed} checks passed)`);
          }
        }
      } catch {
        // Server not ready yet — will be validated on next restart
      }
    }, 10_000); // Wait 10s for app + DB to be ready

    // ── Automatic federation sync cycle ──
    const SYNC_INTERVAL_MS = 60_000; // 60 seconds
    let syncRunning = false;

    // Delay first sync to let the app fully start
    setTimeout(() => {
      setInterval(async () => {
        if (syncRunning || !syncSecret) return;
        syncRunning = true;
        try {
          const res = await fetch(`http://localhost:${port}/api/federation/sync`, {
            method: "POST",
            headers: { "x-sync-secret": syncSecret },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.changesApplied > 0 || (data.errors && data.errors.length > 0)) {
              console.log(`[federation] auto-sync: ${data.peersChecked} peers, ${data.changesApplied} changes`, data.errors?.length ? data.errors : "");
            }
          }
        } catch {
          // Server not ready yet or sync endpoint unavailable — silent retry
        } finally {
          syncRunning = false;
        }
      }, SYNC_INTERVAL_MS);

      console.log("[federation] auto-sync started (60s interval)");
    }, 15_000); // Wait 15s for app startup
  }
}
