/** URL-safe slug: "Court 2 · Panoramic" → "court-2-panoramic". */
export function slugify(input: string, fallbackPrefix = "item"): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || `${fallbackPrefix}-${Date.now().toString(36)}`;
}
