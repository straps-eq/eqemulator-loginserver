import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // When behind Cloudflare proxy, skip our CSP — Cloudflare injects nonces which
  // cause browsers to ignore 'unsafe-inline', breaking its own challenge scripts.
  // Operators can configure CSP via Cloudflare dashboard instead.
  const behindCloudflare = request.headers.has("cf-ray");

  if (!behindCloudflare) {
    const csp = [
      `default-src 'self'`,
      `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com`,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src 'self' https://fonts.gstatic.com`,
      `img-src 'self' data: blob: https:`,
      `connect-src 'self' https://cloudflareinsights.com`,
      `frame-src https://challenges.cloudflare.com`,
      `frame-ancestors 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
    ].join("; ");
    response.headers.set("Content-Security-Policy", csp);
  }

  // Security headers that don't conflict with Cloudflare
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  return response;
}

export const config = {
  matcher: [
    // Match all paths except static files and images
    {
      source: "/((?!_next/static|_next/image|favicon.ico|uploads/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
