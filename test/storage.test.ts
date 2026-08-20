import { expect, it } from "vitest";
/**
 * Verifies the R2 storage layer. Environment-aware:
 *   - R2 unset (CI default): storeImage keeps a data URL inline (fallback).
 *   - R2 set (local, once you fill .env.development.local): a data URL is
 *     uploaded to R2, the returned URL is public and fetchable, then cleaned up.
 * Either way, http URLs pass through and invalid/oversized images are rejected.
 *
 *   npm run test:storage
 */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const { r2Configured, storeImage, dropImage, keyForUrl } = await import("../src/lib/storage/r2");
  const { COVER_MAX_BYTES } = await import("../src/lib/branding");

  // Independent of R2.
  const b = await storeImage("https://cdn.example.com/qr.png", "platform/instapay", COVER_MAX_BYTES);
  check("an http URL passes through unchanged", b.ok && b.url === "https://cdn.example.com/qr.png");
  const c = await storeImage("data:text/plain;base64,aGVsbG8=", "orgs/x/spaces", COVER_MAX_BYTES);
  check("a non-image data URL is rejected", c.ok === false);
  const d = await storeImage(PNG, "orgs/x/spaces", 10);
  check("an oversized image is rejected", d.ok === false);

  if (r2Configured()) {
    console.log("\n  R2 is CONFIGURED — real upload round-trip:\n");
    const a = await storeImage(PNG, "test/storage", COVER_MAX_BYTES);
    check(
      "a data URL uploads to R2 (not kept inline)",
      a.ok && a.url !== PNG && /^https:\/\//i.test(a.url),
      a.ok ? a.url : a.error,
    );

    if (a.ok) {
      let status = 0;
      let ctype = "";
      try {
        const res = await fetch(a.url);
        status = res.status;
        ctype = res.headers.get("content-type") ?? "";
      } catch (e) {
        status = -1;
        ctype = (e as Error).message;
      }
      check(
        "the stored URL is publicly reachable (200)",
        status === 200,
        `status ${status}${ctype ? ` · ${ctype}` : ""} — if this fails, R2_PUBLIC_URL must be the bucket's public r2.dev/custom-domain URL, and public access enabled`,
      );
      await dropImage(a.url);
      console.log("  (cleaned up the test object)");
    }
  } else {
    console.log("\n  R2 is UNCONFIGURED — inline data-URL fallback:\n");
    const a = await storeImage(PNG, "orgs/x/spaces", COVER_MAX_BYTES);
    check("a data URL is kept inline when R2 is off", a.ok && a.url === PNG);
    check("keyForUrl is null when R2 is off", keyForUrl("https://anything/x.png") === null);
  }

  console.log(
    failures === 0
      ? "\nStorage verified.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
}

it("R2 storage", async () => {
  await main();
  expect(failures, "one or more checks failed").toBe(0);
}, 30_000);
