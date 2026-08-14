/**
 * Structured logging. One JSON object per line — greppable, and parseable by
 * any log pipeline (Fly, CloudWatch, Loki) without a shipper. Zero dependencies.
 *
 * Use this instead of bare console.* so production logs carry a level, a
 * timestamp, and context rather than loose strings.
 */

type Level = "debug" | "info" | "warn" | "error";

type Context = Record<string, unknown>;

function emit(level: Level, message: string, context?: Context) {
  const record = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...context,
  };

  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, context?: Context) => emit("debug", message, context),
  info: (message: string, context?: Context) => emit("info", message, context),
  warn: (message: string, context?: Context) => emit("warn", message, context),
  error: (message: string, context?: Context) => emit("error", message, context),
};
