/**
 * Next runs this once at server startup. We initialise observability here and
 * capture server-side request errors. Guarded to the Node runtime — @sentry/node
 * doesn't run on the edge, and this app has no edge routes.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initObservability } = await import("./lib/observability");
  initObservability();
}

export async function onRequestError(
  error: unknown,
  ...rest: unknown[]
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureException } = await import("./lib/observability");
  const request = rest[0] as { path?: string } | undefined;
  captureException(error, { source: "onRequestError", path: request?.path });
}
