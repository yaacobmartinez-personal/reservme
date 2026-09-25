import { NextResponse } from "next/server";
import { lastAuthCodeCapture } from "@/lib/email/auth-emails";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/dev-only/last-code — the last six-digit code we would have
 * emailed, so scripts/test-mobile-api.ts can finish flows that are otherwise
 * only completable from a mailbox.
 *
 * Not under `_test`: a leading underscore makes an App Router folder private
 * and the route silently does not exist — which is exactly how this was found.
 *
 * This hands out a live credential, so it is closed twice: it needs
 * AUTH_TEST_CAPTURE=1, which nothing but the test scripts sets, and it refuses
 * outright in a production build even if that variable is somehow present.
 * Both checks, because one of them will eventually be got wrong.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production" || process.env.AUTH_TEST_CAPTURE !== "1") {
    return new NextResponse("Not found", { status: 404 });
  }
  const capture = lastAuthCodeCapture();
  if (!capture) return NextResponse.json({ code: null });
  return NextResponse.json(capture);
}
