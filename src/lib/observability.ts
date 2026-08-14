import * as Sentry from "@sentry/node";
import { log } from "./log";

/**
 * Error capture that always logs (structured) and additionally forwards to
 * Sentry when SENTRY_DSN is set. With no DSN it's a pure logger — the app runs
 * fully unconfigured, same as email and Turnstile.
 *
 * @sentry/node is server-only. This module must never be imported into a client
 * component; capture on the server (actions, route handlers, the worker) covers
 * where the risk actually is.
 */

let initialized = false;

export function initObservability(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.info("observability: Sentry not configured", { sentry: false });
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Error tracking only for soft launch; turn up when we want traces.
    tracesSampleRate: 0,
  });
  log.info("observability: Sentry initialized", { sentry: true });
}

function sentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

type Context = Record<string, unknown>;

/** Log an error and forward it to Sentry when configured. Never throws. */
export function captureException(error: unknown, context?: Context): void {
  const message = error instanceof Error ? error.message : String(error);
  log.error(message, {
    ...context,
    stack: error instanceof Error ? error.stack : undefined,
  });

  if (!sentryEnabled()) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Capturing must never itself throw into the caller's path.
  }
}

/** A noteworthy non-error condition (e.g. a degraded-but-handled path). */
export function captureMessage(message: string, context?: Context): void {
  log.warn(message, context);
  if (!sentryEnabled()) return;
  try {
    Sentry.captureMessage(message, context ? { extra: context } : undefined);
  } catch {
    /* swallow */
  }
}
