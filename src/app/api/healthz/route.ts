import { NextResponse } from "next/server";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness in one. An orchestrator hits this on any host; the proxy
 * lets /api/healthz through unrewritten (see src/proxy.ts). Returns 503 if the
 * database is unreachable so a rolling deploy won't route traffic to a pod that
 * can't serve.
 */
export async function GET() {
  try {
    await sql`SELECT 1`;
    return NextResponse.json({ ok: true, db: "up" });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
