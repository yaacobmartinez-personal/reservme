import { NextResponse } from "next/server";

/**
 * The one error shape docs/API-CONTRACT.md promises, in one place.
 *
 *   { error, message?, fieldErrors?, reason? }
 *
 * `error` is the machine-readable slug the app switches on; `message` is what
 * a person reads. The Flutter side (`ApiError`) parses exactly this, so a route
 * that invents its own shape shows up as a blank snackbar rather than a
 * refusal anybody can act on.
 */
export type ErrorBody = {
  error: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  reason?: string;
  [key: string]: unknown;
};

export function ok<T extends object>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(status: number, body: ErrorBody) {
  return NextResponse.json(body, { status });
}

export const unauthorized = (message = "Sign in again to continue.") =>
  fail(401, { error: "unauthorized", message });

export const notFound = (message = "Not found.") => fail(404, { error: "not_found", message });

export const invalid = (fieldErrors: Record<string, string>, message?: string) =>
  fail(400, { error: "invalid", message, fieldErrors });

export const conflict = (reason: string, message: string, extra: Record<string, unknown> = {}) =>
  fail(409, { error: "conflict", reason, message, ...extra });

export const rateLimited = (message = "Too many attempts. Try again in a few minutes.") =>
  fail(429, { error: "rate_limited", message });

/**
 * Better Auth throws `APIError` with its own status and body. Map it onto our
 * shape rather than letting a 500 escape — an app that gets a 500 for a wrong
 * password shows "Something went wrong", which is both wrong and unhelpful.
 */
export function fromAuthError(error: unknown, fallback: string): NextResponse {
  const e = error as { status?: string | number; statusCode?: number; body?: { message?: string } };
  const status = typeof e?.statusCode === "number" ? e.statusCode : 0;
  const message = e?.body?.message;

  if (status === 401 || status === 403) {
    return fail(401, { error: "unauthorized", message: message ?? fallback });
  }
  if (status === 422 || status === 400) {
    return fail(400, { error: "invalid", message: message ?? fallback });
  }
  if (status === 429) return rateLimited(message);
  return fail(status >= 400 && status < 600 ? status : 500, {
    error: "server_error",
    message: message ?? fallback,
  });
}
