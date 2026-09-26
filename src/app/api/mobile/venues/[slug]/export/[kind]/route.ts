import { EXPORT_KINDS, exportCsv, type ExportKind } from "@/lib/mobile/growth-json";
import { fail, notFound } from "@/lib/mobile/respond";
import { isFailure, venueScope } from "@/lib/mobile/venue-scope";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; kind: string }> };

/**
 * GET — API-CONTRACT #47. `text/csv`, the same file the web dashboard
 * downloads: bookings, customers, or transactions (gross, discount, net). Any
 * member may export, as on the web; the app saves it and hands it to the
 * phone's share sheet.
 */
export async function GET(request: Request, { params }: Params) {
  const { slug, kind } = await params;
  const scope = await venueScope(request, slug);
  if (isFailure(scope)) return fail(scope.status, { error: "denied", message: scope.message });
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return notFound("No such export.");

  const csv = await exportCsv(kind as ExportKind, scope.organizationId, scope.timezone);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind}-${scope.slug}.csv"`,
      "cache-control": "no-store",
    },
  });
}
