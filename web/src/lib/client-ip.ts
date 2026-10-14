import type { NextRequest } from "next/server";

/**
 * Client IP for rate limiting and audit logs.
 *
 * nginx sets X-Real-IP to $remote_addr, replacing anything the client sent, so
 * it is the only header a client cannot forge. X-Forwarded-For is built with
 * $proxy_add_x_forwarded_for, which APPENDS the real address to whatever the
 * client supplied — its first entry is attacker-controlled and must never be
 * trusted. When X-Real-IP is absent, fall back to the last XFF entry, which is
 * the hop closest to us.
 */
export function getClientIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return "unknown";
}

/**
 * True for container-to-container calls on the Docker network (loginserver,
 * Prometheus) that did not pass through nginx.
 *
 * Every request nginx proxies carries X-Real-IP, and a client cannot remove a
 * header nginx sets. Internal callers hit web:3000 directly and never send it.
 */
export function isDirectInternalRequest(req: NextRequest): boolean {
  return !req.headers.has("x-real-ip");
}
