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
