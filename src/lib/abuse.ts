import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";

/**
 * Best-effort client IP from proxy headers. Behind a real proxy (Fly, Vercel,
 * nginx) the left-most x-forwarded-for entry is the client. Falls back to a
 * constant so the rate limiter still has a stable-ish key in local dev.
 */
export function clientIp(headers: ReadonlyHeaders): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "0.0.0.0";
}

/**
 * Cloudflare Turnstile verification — a no-op that PASSES until TURNSTILE_SECRET
 * is set, so the app runs without it and turns on the moment a key is added.
 *
 * When enabled, the booking form must render the Turnstile widget and post its
 * token as `turnstileToken`; see docs/launch-readiness.md P1-1. Until then this
 * returns true and the rate limiter carries the load.
 */
export async function verifyTurnstile(
  token: string | null,
  ip: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true; // not configured — allow

  if (!token) return false;

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      },
    );
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // If the check itself errors, fail closed — a broken verifier must not
    // become an open door once it's been switched on.
    return false;
  }
}
