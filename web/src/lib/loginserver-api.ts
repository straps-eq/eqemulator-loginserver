import http from "http";

const API_URL = process.env.LOGINSERVER_API_URL || "http://loginserver:6000";
const API_TOKEN = process.env.LOGINSERVER_API_TOKEN || "";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const payload = body ? JSON.stringify(body) : undefined;
  const url = new URL(`${API_URL}${path}`);

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_TOKEN}`,
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 400) {
            resolve({ ok: false, error: data || `HTTP ${res.statusCode}` });
            return;
          }
          try {
            const parsed = JSON.parse(data) as T;
            resolve({ ok: true, data: parsed });
          } catch {
            resolve({ ok: false, error: "Invalid JSON response" });
          }
        });
      }
    );
    req.on("error", (err) => resolve({ ok: false, error: String(err) }));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ ok: false, error: "Request timeout" });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Account APIs ──

export interface CreateAccountResult {
  data: {
    account_id: number;
  };
  message: string;
}

export async function createAccount(username: string, password: string) {
  return apiRequest<CreateAccountResult>("POST", "/v1/account/create", {
    username,
    password,
    email: "",
  });
}

export interface ValidateResult {
  data: {
    account_id: number;
  };
}

export async function validateCredentials(username: string, password: string) {
  return apiRequest<ValidateResult>(
    "POST",
    "/v1/account/credentials/validate/local",
    { username, password }
  );
}

export async function validateExternalCredentials(username: string, password: string) {
  return apiRequest<ValidateResult>(
    "POST",
    "/v1/account/credentials/validate/external",
    { username, password }
  );
}

export async function updatePassword(username: string, newPassword: string) {
  return apiRequest("POST", "/v1/account/credentials/update/local", {
    username,
    password: newPassword,
  });
}

// ── Server APIs ──

export interface ServerListItem {
  server_long_name: string;
  server_short_name: string;
  server_list_type_id: number;
  server_status: number;
  zones_booted: number;
  players_online: number;
  world_id: number;
}

export interface ServerListResult {
  data: ServerListItem[];
}

export async function getServerList() {
  return apiRequest<ServerListResult>("GET", "/v1/servers/list");
}

/**
 * Collapse duplicate world server entries returned by /v1/servers/list.
 *
 * The loginserver never evicts a world server whose TCP connection died
 * half-open, so a server that reconnects is appended as an additional entry
 * while the dead one lingers with permanently frozen counters. Entries arrive
 * in connection order, so the last occurrence is the live connection.
 *
 * The key is (short_name, long_name) — identical to the Prometheus series
 * identity in /api/metrics — so genuinely distinct servers are never merged.
 * The first-seen position is kept while the value is overwritten by the
 * last-seen entry, which yields stable ordering with live counters.
 */
export function dedupeLiveServers<
  T extends { server_short_name?: unknown; server_long_name?: unknown }
>(servers: T[]): T[] {
  const out: T[] = [];
  const indexBySeries = new Map<string, number>();
  for (const s of servers) {
    const key = `${String(s.server_short_name ?? "")}\u0000${String(s.server_long_name ?? "")}`;
    const seenAt = indexBySeries.get(key);
    if (seenAt === undefined) {
      indexBySeries.set(key, out.length);
      out.push(s);
    } else {
      out[seenAt] = s;
    }
  }
  return out;
}
