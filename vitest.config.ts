import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the app's "@/…" alias so imported src modules resolve.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // migrate + seed once; each worker fills the env from test-env.
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup-env.ts"],
    // These are integration tests sharing one Postgres — and one of them fires
    // 24 parallel bookings at a single row. Run files serially so they don't
    // trample each other's data.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      // Coverage measures the framework-independent logic layer this unit suite
      // is responsible for: src/lib (booking engine, tenancy, billing, email,
      // storage, admin), src/db (schema + connection), and src/content. The
      // Next.js surface — src/app pages/layouts/route handlers/Server Actions and
      // src/components React UI — is exercised by the HTTP suites (test:onboarding,
      // test:admin, test:jobs) and browser walkthroughs, not by unit tests, so
      // counting it here would only misreport what this suite covers.
      include: ["src/lib/**", "src/db/**", "src/content/**"],
      exclude: ["src/**/*.test.ts", "**/*.d.ts"],
      reporter: ["text", "html", "lcov"],
    },
  },
});
