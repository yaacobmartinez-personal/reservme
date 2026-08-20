/**
 * Verifies the R2 storage layer's graceful fallback. With no R2_* env set (the
 * default locally), storeImage must behave exactly as before: a data URL is
 * kept inline, an http URL passes through, invalid/oversized images are
 * rejected, and the delete/url helpers are safe no-ops.
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

  check("R2 is unconfigured locally", r2Configured() === false);

  const a = await storeImage(PNG, "orgs/x/spaces", COVER_MAX_BYTES);
  check("a data URL is kept inline when R2 is off", a.ok && a.url === PNG, a.ok ? "" : a.error);

  const b = await storeImage("https://cdn.example.com/qr.png", "platform/instapay", COVER_MAX_BYTES);
  check("an http URL passes through unchanged", b.ok && b.url === "https://cdn.example.com/qr.png");

  const c = await storeImage("data:text/plain;base64,aGVsbG8=", "orgs/x/spaces", COVER_MAX_BYTES);
  check("a non-image data URL is rejected", c.ok === false);

  const d = await storeImage(PNG, "orgs/x/spaces", 10);
  check("an oversized image is rejected", d.ok === false);

  check("keyForUrl is null when R2 is off", keyForUrl("https://anything/x.png") === null);

  let threw = false;
  try {
    await dropImage("https://anything/x.png");
    await dropImage(null);
  } catch {
    threw = true;
  }
  check("dropImage is a safe no-op when R2 is off", !threw);

  console.log(
    failures === 0
      ? "\nStorage verified: data-URL fallback, URL passthrough, validation, safe no-ops.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
