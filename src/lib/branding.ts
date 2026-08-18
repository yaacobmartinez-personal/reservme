/**
 * Venue branding — theme, logo, cover. Images are stored as size-capped data
 * URLs in the DB (no object storage wired); the validator here is the gate.
 *
 * This module is pure (no DB) so client components can import the themes,
 * caps and validator. The DB read lives in `src/lib/owner.ts` (server-only).
 */

export const THEMES = [
  { id: "pine", label: "Pine" },
  { id: "ocean", label: "Ocean" },
  { id: "violet", label: "Violet" },
  { id: "sunset", label: "Sunset" },
  { id: "rose", label: "Rose" },
  { id: "slate", label: "Slate" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));
export function isTheme(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.has(value);
}

export const LOGO_MAX_BYTES = 128 * 1024;
export const COVER_MAX_BYTES = 512 * 1024;

// PNG/JPEG/WebP only. SVG is deliberately excluded — it can carry script and we
// inject these straight into the public page.
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export type ImageCheck = { ok: true; bytes: number } | { ok: false; error: string };

/** Validates a base64 image data URL against an allowlist + a byte cap. Pure. */
export function validateImageDataUrl(value: string, maxBytes: number): ImageCheck {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.trim());
  if (!match) return { ok: false, error: "That doesn't look like an image file." };

  const mime = match[1];
  const b64 = match[2];
  if (!ALLOWED_MIME.has(mime)) return { ok: false, error: "Use a PNG, JPEG or WebP image." };

  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - padding;
  if (bytes <= 0) return { ok: false, error: "That image is empty." };
  if (bytes > maxBytes) {
    return { ok: false, error: `That image is too large (max ${Math.round(maxBytes / 1024)} KB).` };
  }
  return { ok: true, bytes };
}

export type Branding = {
  theme: ThemeId;
  logo: string | null;
  coverUrl: string | null;
};
