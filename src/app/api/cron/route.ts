import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runScheduledJobs } from "@/lib/jobs/run-scheduled";
import { captureException } from "@/lib/observability";

export const dynamic = "force-dynamic";

/**
 * Worker-free scheduler. In a deploy with no background worker, an external cron
 * (GitHub Actions, cron-job.org, UptimeRobot, or a Render Cron Job) hits this to
 * run the time-based jobs — hold sweep, billing reminders + suspend, loyalty,
 * engagement. Every job is idempotent, so any frequency is safe; ~10 minutes is
 * a reasonable cadence.
 *
 * Protected by CRON_SECRET (Bearer token or ?key=). Disabled (404) when the
 * secret is unset, so it can't be triggered by accident. The proxy lets this
 * path through on any host (like /api/healthz), so the cron can hit the plain
 * service URL before custom domains are attached.
 */
function authorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const provided = bearer ?? request.nextUrl.searchParams.get("key");
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "cron disabled" }, { status: 404 });
  }
  if (!authorized(request, secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runScheduledJobs();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    captureException(error, { where: "api.cron" });
    return NextResponse.json({ ok: false, error: "job run failed" }, { status: 500 });
  }
}

export const POST = GET;
