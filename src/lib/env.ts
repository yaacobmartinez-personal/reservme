import { z } from "zod";

/**
 * Fail at boot with a readable message rather than at the first query with
 * "connection string required". Server-only values are read lazily so that
 * importing this module from a client component can't leak them.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be ≥32 chars"),
  BETTER_AUTH_URL: z.string().url(),
});

let cached: z.infer<typeof serverSchema> | null = null;

export function serverEnv() {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid server environment:\n${issues}\n\nCopy .env.example to .env.local.`);
  }

  cached = parsed.data;
  return cached;
}

/* Public host config. Inlined at build time, safe on the client. */
export const APEX_HOST = process.env.NEXT_PUBLIC_APEX_HOST ?? "localhost:3000";
export const APP_HOST = process.env.NEXT_PUBLIC_APP_HOST ?? "app.localhost:3000";
export const ADMIN_HOST =
  process.env.NEXT_PUBLIC_ADMIN_HOST ?? "admin.localhost:3000";
export const PROTOCOL = process.env.NEXT_PUBLIC_PROTOCOL ?? "http";

export const apexUrl = (path = "") => `${PROTOCOL}://${APEX_HOST}${path}`;
export const appUrl = (path = "") => `${PROTOCOL}://${APP_HOST}${path}`;
export const adminUrl = (path = "") => `${PROTOCOL}://${ADMIN_HOST}${path}`;

/** The public booking page for a venue, e.g. https://reservme.pro/katipunan */
export const venueUrl = (slug: string) => apexUrl(`/${slug}`);
