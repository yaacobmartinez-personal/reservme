// Copies the single-source marketing content into this standalone app.
//
// The marketing site is a walled-off static export (its build can't import
// across the package boundary — see next.config.ts `turbopack.root`). So instead
// of importing the shared module, we copy it in as `_shared.ts` before every
// build/dev. The copy is committed too, so a marketing-only checkout (without the
// parent repo) still builds from the last-synced content.
//
// One source of truth: packages/marketing-content/index.ts. Never edit _shared.ts
// by hand — test/marketing-content.test.ts fails if the two drift.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../packages/marketing-content/index.ts");
const dest = resolve(here, "../src/content/_shared.ts");

if (!existsSync(source)) {
  // Marketing-only checkout: keep the committed copy, don't fail the build.
  console.warn(`[sync-shared-content] source not found (${source}); using committed _shared.ts`);
  process.exit(0);
}

const header = `// GENERATED — do not edit. Source: packages/marketing-content/index.ts
// Regenerate with: npm run sync-content  (runs automatically before dev/build)
`;
const body = readFileSync(source, "utf8");
writeFileSync(dest, header + "\n" + body);
console.log(`[sync-shared-content] wrote ${dest}`);
