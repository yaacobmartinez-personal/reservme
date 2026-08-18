/**
 * Verifies venue branding: the pure image validator (type + size + SVG block)
 * and that theme/logo/cover round-trip through storage to the public page.
 *
 *   npm run test:branding      (local: DATABASE_URL → docker, not Neon)
 */
import postgres from "postgres";

const ORG = "org_brand_test";
const OTHER = "org_brand_other";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// A valid 1×1 PNG, well under the caps.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const { validateImageDataUrl, isTheme, LOGO_MAX_BYTES } = await import("../src/lib/branding");
  const { getBranding } = await import("../src/lib/owner");
  const { getVenueBySlug } = await import("../src/lib/venue");

  const mkOrg = async (id: string) => {
    await sql`DELETE FROM organization WHERE id = ${id}`;
    await sql`INSERT INTO organization (id, name, slug) VALUES (${id}, ${id}, ${id})`;
    await sql`INSERT INTO venue (organization_id) VALUES (${id})`;
    await sql`INSERT INTO space (organization_id, name, slug, price_cents, sort_order, is_active)
              VALUES (${id}, 'Court 1', 'court-1', 90000, 0, true)`;
  };

  try {
    /* ── validator (pure) ── */
    check("accepts a small PNG data URL", validateImageDataUrl(PNG, LOGO_MAX_BYTES).ok);
    const big = "data:image/png;base64," + "A".repeat(200_000); // ~150 KB decoded
    check("rejects an oversized image", !validateImageDataUrl(big, LOGO_MAX_BYTES).ok);
    check("rejects a non-image", !validateImageDataUrl("data:text/plain;base64,SGk=", LOGO_MAX_BYTES).ok);
    check("rejects an SVG (XSS surface)",
      !validateImageDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", LOGO_MAX_BYTES).ok);
    check("rejects garbage", !validateImageDataUrl("not-a-data-url", LOGO_MAX_BYTES).ok);

    /* ── theme guard ── */
    check("isTheme accepts a preset", isTheme("ocean"));
    check("isTheme rejects an unknown theme", !isTheme("neon"));

    /* ── storage round-trip ── */
    await mkOrg(ORG);
    await mkOrg(OTHER);

    // The exact writes the action performs.
    await sql`UPDATE venue SET theme = 'ocean', cover_url = ${PNG} WHERE organization_id = ${ORG}`;
    await sql`UPDATE organization SET logo = ${PNG} WHERE id = ${ORG}`;

    const branding = await getBranding(ORG);
    check("getBranding returns the saved theme + images",
      branding.theme === "ocean" && branding.logo === PNG && branding.coverUrl === PNG,
      branding.theme);

    const venue = await getVenueBySlug(ORG);
    check("public venue carries theme/logo/cover",
      !!venue && venue.theme === "ocean" && venue.logo === PNG && venue.coverUrl === PNG);

    /* ── isolation + defaults ── */
    const other = await getBranding(OTHER);
    check("an untouched venue defaults to pine, no images",
      other.theme === "pine" && other.logo === null && other.coverUrl === null);

    // Clearing reverts.
    await sql`UPDATE organization SET logo = NULL WHERE id = ${ORG}`;
    await sql`UPDATE venue SET cover_url = NULL WHERE organization_id = ${ORG}`;
    const cleared = await getBranding(ORG);
    check("removing images clears them", cleared.logo === null && cleared.coverUrl === null);

    console.log(
      failures === 0
        ? "\nBranding verified: image validator, theme guard, storage round-trip, isolation.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
  } finally {
    await sql`DELETE FROM organization WHERE id IN (${ORG}, ${OTHER})`;
    await sql.end();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
