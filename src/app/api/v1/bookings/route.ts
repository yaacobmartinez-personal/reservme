import { NextResponse } from "next/server";
import { sql } from "@/db";
import { bearerFrom, verifyApiKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/bookings — confirmed bookings, most recent first.
 * Optional ?from=ISO and ?limit=N (default 50, max 200). Bearer-key auth.
 */
export async function GET(request: Request) {
  const auth = await verifyApiKey(bearerFrom(request));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const fromRaw = url.searchParams.get("from");
  const from = fromRaw ? new Date(fromRaw) : null;
  const validFrom = from && !Number.isNaN(from.getTime()) ? from : null;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  const rows = await sql<
    {
      id: string;
      reference: string;
      space_name: string;
      customer_name: string | null;
      starts_at: Date;
      ends_at: Date;
      amount_cents: number;
      status: string;
    }[]
  >`
    SELECT r.id, r.reference, s.name AS space_name, c.name AS customer_name,
           r.starts_at, r.ends_at, r.amount_cents, r.status
    FROM reservation r
    JOIN space s ON s.id = r.space_id
    LEFT JOIN customer c ON c.id = r.customer_id
    WHERE r.organization_id = ${auth.organizationId}
      AND r.status = 'confirmed'
      ${validFrom ? sql`AND r.starts_at >= ${validFrom}` : sql``}
    ORDER BY r.starts_at DESC
    LIMIT ${limit}
  `;

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      space: r.space_name,
      customer: r.customer_name,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      amountCents: r.amount_cents,
      status: r.status,
    })),
  });
}
