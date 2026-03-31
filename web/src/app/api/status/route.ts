import { NextResponse } from "next/server";
import http from "http";
import os from "os";
import { readFileSync, statfsSync } from "fs";

export const dynamic = "force-dynamic";

// ── Host system metrics (safe, no sensitive data) ──

function getCpuUsage(): { usagePercent: number; cores: number } {
  const cores = os.cpus().length;
  try {
    const stat = readFileSync("/proc/stat", "utf8");
    const line = stat.split("\n")[0]; // "cpu  user nice system idle iowait irq softirq steal"
    const parts = line.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0); // idle + iowait
    const total = parts.reduce((a, b) => a + b, 0);
    // Store for delta calc — on first call, estimate from load avg
    const key = "__cpu_prev";
    const prev = (global as any)[key];
    (global as any)[key] = { idle, total, ts: Date.now() };
    if (prev) {
      const dTotal = total - prev.total;
      const dIdle = idle - prev.idle;
      const pct = dTotal > 0 ? Math.round(((dTotal - dIdle) / dTotal) * 100) : 0;
      return { usagePercent: Math.min(pct, 100), cores };
    }
    // Fallback: estimate from 1-min load avg
    const load1 = os.loadavg()[0];
    return { usagePercent: Math.min(Math.round((load1 / cores) * 100), 100), cores };
  } catch {
    const load1 = os.loadavg()[0];
    return { usagePercent: Math.min(Math.round((load1 / cores) * 100), 100), cores };
  }
}

function getMemory(): { totalMb: number; usedMb: number; usagePercent: number } {
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const get = (key: string) => {
      const match = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return match ? parseInt(match[1], 10) : 0;
    };
    const totalKb = get("MemTotal");
    const availKb = get("MemAvailable");
    const usedKb = totalKb - availKb;
    return {
      totalMb: Math.round(totalKb / 1024),
      usedMb: Math.round(usedKb / 1024),
      usagePercent: totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0,
    };
  } catch {
    const total = os.totalmem();
    const free = os.freemem();
    return {
      totalMb: Math.round(total / 1024 / 1024),
      usedMb: Math.round((total - free) / 1024 / 1024),
      usagePercent: Math.round(((total - free) / total) * 100),
    };
  }
}

function getDisk(): { totalGb: number; usedGb: number; usagePercent: number } {
  try {
    const stats = statfsSync("/");
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    return {
      totalGb: Math.round(totalBytes / 1024 / 1024 / 1024),
      usedGb: Math.round(usedBytes / 1024 / 1024 / 1024),
      usagePercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
    };
  } catch {
    return { totalGb: 0, usedGb: 0, usagePercent: 0 };
  }
}

function getNetwork(): { rxMbps: number; txMbps: number } {
  try {
    const net = readFileSync("/proc/net/dev", "utf8");
    const lines = net.split("\n").slice(2); // skip headers
    let rxBytes = 0, txBytes = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (!parts[0] || parts[0].startsWith("lo:")) continue;
      rxBytes += parseInt(parts[1], 10) || 0;
      txBytes += parseInt(parts[9], 10) || 0;
    }
    const key = "__net_prev";
    const prev = (global as any)[key];
    const now = Date.now();
    (global as any)[key] = { rxBytes, txBytes, ts: now };
    if (prev) {
      const dt = (now - prev.ts) / 1000;
      if (dt > 0) {
        return {
          rxMbps: Math.round(((rxBytes - prev.rxBytes) / dt / 1024 / 1024) * 100) / 100,
          txMbps: Math.round(((txBytes - prev.txBytes) / dt / 1024 / 1024) * 100) / 100,
        };
      }
    }
    return { rxMbps: 0, txMbps: 0 };
  } catch {
    return { rxMbps: 0, txMbps: 0 };
  }
}

function getUptime(): { seconds: number; formatted: string } {
  try {
    const raw = readFileSync("/proc/uptime", "utf8");
    const seconds = Math.floor(parseFloat(raw.split(" ")[0]));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    parts.push(`${mins}m`);
    return { seconds, formatted: parts.join(" ") };
  } catch {
    const seconds = os.uptime();
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    parts.push(`${mins}m`);
    return { seconds, formatted: parts.join(" ") };
  }
}

function getLoadAverage(): { load1: number; load5: number; load15: number } {
  const [load1, load5, load15] = os.loadavg();
  return {
    load1: Math.round(load1 * 100) / 100,
    load5: Math.round(load5 * 100) / 100,
    load15: Math.round(load15 * 100) / 100,
  };
}

interface ServiceStatus {
  name: string;
  status: "up" | "down";
  latencyMs?: number;
}

async function checkLoginserver(): Promise<{ service: ServiceStatus; servers: any[] }> {
  const apiUrl = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
  const token = process.env.LOGINSERVER_API_TOKEN || "";
  const start = Date.now();

  return new Promise((resolve) => {
    const req = http.get(`${apiUrl}/v1/servers/list`, {
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        const latencyMs = Date.now() - start;
        let servers: any[] = [];
        try { const json = JSON.parse(data); servers = Array.isArray(json) ? json : []; } catch {}
        resolve({
          service: { name: "loginserver", status: res.statusCode === 200 ? "up" : "down", latencyMs },
          servers,
        });
      });
    });
    req.on("error", () => {
      resolve({ service: { name: "loginserver", status: "down", latencyMs: Date.now() - start }, servers: [] });
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ service: { name: "loginserver", status: "down", latencyMs: 5000 }, servers: [] });
    });
  });
}

async function checkDatabase(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const { db } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    return { name: "database", status: "up", latencyMs: Date.now() - start };
  } catch {
    return { name: "database", status: "down", latencyMs: Date.now() - start };
  }
}

async function getDbStats() {
  try {
    const { db } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    const [accounts, worldServers, admins] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as cnt FROM login_accounts`),
      db.execute(sql`SELECT COUNT(*) as cnt FROM login_world_servers`),
      db.execute(sql`SELECT COUNT(*) as cnt FROM login_server_admins`),
    ]);
    // drizzle mysql2 returns [rows, fields] — rows is array of row objects
    const getCount = (result: any) => {
      const rows = Array.isArray(result) ? result[0] : result;
      const row = Array.isArray(rows) ? rows[0] : rows;
      return Number(row?.cnt ?? 0);
    };
    return {
      registeredAccounts: getCount(accounts),
      registeredWorldServers: getCount(worldServers),
      serverOperators: getCount(admins),
    };
  } catch (e) {
    console.error("getDbStats error:", e);
    return { registeredAccounts: 0, registeredWorldServers: 0, serverOperators: 0 };
  }
}

export async function GET() {
  const [lsResult, database] = await Promise.all([
    checkLoginserver(),
    checkDatabase(),
  ]);

  const { service: loginserver, servers } = lsResult;
  const services = [loginserver, database];
  const allUp = services.every((s) => s.status === "up");

  const connectedWorlds = servers.length;
  const totalPlayers = servers.reduce((sum: number, s: any) => sum + (s.players_online ?? 0), 0);

  // Public response: service health + player summary only
  const publicResponse: Record<string, unknown> = {
    overall: allUp ? "operational" : "degraded",
    loginserver: loginserver.status,
    database: database.status,
    summary: {
      connectedWorlds,
      totalPlayers,
    },
    checkedAt: new Date().toISOString(),
  };

  // Admin-only: system metrics, service latencies, DB stats
  try {
    const { getSession } = await import("@/lib/session");
    const session = await getSession();
    if (session.isLoggedIn && session.isAdmin) {
      const dbStats = await getDbStats();
      publicResponse.services = services;
      publicResponse.system = {
        cpu: getCpuUsage(),
        memory: getMemory(),
        disk: getDisk(),
        network: getNetwork(),
        uptime: getUptime(),
        load: getLoadAverage(),
      };
      publicResponse.platform = dbStats;
    }
  } catch {
    // Session check failed — return public response only
  }

  return NextResponse.json(publicResponse);
}
