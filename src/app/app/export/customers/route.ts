import { customersCsv } from "@/lib/export";
import { requireVenue } from "@/lib/tenancy";

export const dynamic = "force-dynamic";

export async function GET() {
  const venue = await requireVenue();
  const csv = await customersCsv(venue.organizationId, venue.timezone);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="customers-${venue.slug}.csv"`,
    },
  });
}
