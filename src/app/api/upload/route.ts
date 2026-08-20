import { NextResponse } from "next/server";
import { currentPlatformAdmin } from "@/lib/admin/access";
import { COVER_MAX_BYTES, maxSizeLabel } from "@/lib/branding";
import { putImageBytes } from "@/lib/storage/r2";
import { currentVenue } from "@/lib/tenancy";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Where each upload purpose is keyed, and who may write it. */
const PURPOSE: Record<string, { dir: string; scope: "venue" | "platform" }> = {
  logo: { dir: "logo", scope: "venue" },
  cover: { dir: "cover", scope: "venue" },
  space: { dir: "spaces", scope: "venue" },
  instapay: { dir: "instapay", scope: "platform" },
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Direct image upload. The browser POSTs the file here (multipart), we store it
 * in R2 (or return a data URL when R2 is unconfigured) and hand back a URL the
 * owner's form then submits — so the Server Action body stays tiny.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const purpose = PURPOSE[String(form.get("purpose") ?? "")];

  if (!purpose) return bad("Unknown upload purpose.");
  if (!(file instanceof File)) return bad("No file was uploaded.");
  if (!ALLOWED.has(file.type)) return bad("Use a PNG, JPEG or WebP image.");
  if (file.size > COVER_MAX_BYTES) return bad(`That image is too large (max ${maxSizeLabel(COVER_MAX_BYTES)}).`);

  // Authorise, and derive the key prefix from *who* you are, never the client.
  let keyPrefix: string | null = null;
  if (purpose.scope === "venue") {
    const venue = await currentVenue();
    if (venue && (venue.role === "owner" || venue.role === "admin")) {
      keyPrefix = `orgs/${venue.organizationId}/${purpose.dir}`;
    }
  } else {
    const admin = await currentPlatformAdmin();
    if (admin) keyPrefix = `platform/${purpose.dir}`;
  }
  if (!keyPrefix) return bad("Not allowed.", 403);

  const bytes = Buffer.from(await file.arrayBuffer());
  const url = await putImageBytes(bytes, file.type, keyPrefix);
  return NextResponse.json({ url });
}
