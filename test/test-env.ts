/**
 * The environment the test suite runs against. Defaults to the local docker
 * Postgres (see docker-compose.yml) and throwaway auth values, so the suite runs
 * from a fresh clone with NO `.env*` file. CI (and anyone who wants to point
 * elsewhere) overrides by exporting these before running.
 *
 * Never points at production: DATABASE_URL only falls back to the local docker
 * DB, never Neon.
 */
export const TEST_ENV: Record<string, string> = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://reservme:reservme_dev_password@localhost:5433/reservme",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "test-secret-thirty-two-bytes-minimum-0",
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://app.localhost:3000",
  NEXT_PUBLIC_APEX_HOST: process.env.NEXT_PUBLIC_APEX_HOST ?? "localhost:3000",
  NEXT_PUBLIC_APP_HOST: process.env.NEXT_PUBLIC_APP_HOST ?? "app.localhost:3000",
  NEXT_PUBLIC_ADMIN_HOST: process.env.NEXT_PUBLIC_ADMIN_HOST ?? "admin.localhost:3000",
  NEXT_PUBLIC_PROTOCOL: process.env.NEXT_PUBLIC_PROTOCOL ?? "http",
};
