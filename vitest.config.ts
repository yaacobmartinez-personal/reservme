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
      include: ["src/**"],
      exclude: ["src/**/*.test.ts", "**/*.d.ts"],
      reporter: ["text", "html", "lcov"],
    },
  },
});
