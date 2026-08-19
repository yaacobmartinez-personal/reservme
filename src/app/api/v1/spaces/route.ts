import { NextResponse } from "next/server";
import { sql } from "@/db";
import { bearerFrom, verifyApiKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

/** GET /api/v1/spaces — the org's active bookable spaces. Bearer-key auth. */
export async function GET(request: Request) {
  const auth = await verifyApiKey(bearerFrom(request));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await sql<
    {
      id: string;
      name: string;
      slug: string;
      kind: string;
      price_cents: number;
      capacity: number;
      slot_minutes: number;
    }[]
  >`
    SELECT id, name, slug, kind, price_cents, capacity, slot_minutes
    FROM space
    WHERE organization_id = ${auth.organizationId} AND is_active
    ORDER BY sort_order, name
  `;

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      kind: r.kind,
      priceCents: r.price_cents,
      capacity: r.capacity,
      slotMinutes: r.slot_minutes,
    })),
  });
}
