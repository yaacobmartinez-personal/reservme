import { maxSizeLabel } from "@/lib/branding";

/**
 * Client-side image upload: validate, POST the file to /api/upload, and return
 * the stored URL (an R2 https URL, or a data URL when R2 is unconfigured). The
 * caller puts that short string in its form, so the Server Action never carries
 * the raw image.
 */

const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

export type UploadPurpose = "logo" | "cover" | "space" | "instapay";

export async function uploadImage(
  file: File,
  purpose: UploadPurpose,
  maxBytes: number,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, error: "Use a PNG, JPEG or WebP image." };
  }
  if (file.size > maxBytes) {
    return { ok: false, error: `That image is too large (max ${maxSizeLabel(maxBytes)}).` };
  }

  const body = new FormData();
  body.set("file", file);
  body.set("purpose", purpose);

  let res: Response;
  try {
    res = await fetch("/api/upload", { method: "POST", body });
  } catch {
    return { ok: false, error: "Upload failed — check your connection." };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: (err as { error?: string }).error ?? "Upload failed." };
  }
  const data = (await res.json()) as { url?: string };
  return data.url ? { ok: true, url: data.url } : { ok: false, error: "Upload failed." };
}
