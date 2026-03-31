const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || "";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  if (!TURNSTILE_SECRET) {
    // If no secret key configured, skip verification (dev/testing)
    console.warn("[turnstile] No TURNSTILE_SECRET_KEY configured, skipping verification");
    return true;
  }

  try {
    const body: Record<string, string> = {
      secret: TURNSTILE_SECRET,
      response: token,
    };
    if (ip) body.remoteip = ip;

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error("[turnstile] Verification error:", err);
    return false;
  }
}
