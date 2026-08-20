import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/log";
import { captureException, captureMessage, initObservability } from "@/lib/observability";

afterEach(() => vi.restoreAllMocks());

describe("log", () => {
  it("emits one JSON line carrying level, time, msg and context", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("hello", { venue: "katipunan" });
    expect(spy).toHaveBeenCalledOnce();
    const record = JSON.parse(spy.mock.calls[0][0] as string);
    expect(record.level).toBe("info");
    expect(record.msg).toBe("hello");
    expect(record.venue).toBe("katipunan");
    expect(typeof record.time).toBe("string");
  });

  it("routes each level to the matching console method", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(logSpy).toHaveBeenCalledTimes(2); // debug + info
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});

describe("observability without a Sentry DSN", () => {
  it("initObservability logs that Sentry is off and never throws", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => initObservability()).not.toThrow();
  });

  it("captureException logs the message + stack and never throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => captureException(new Error("boom"), { where: "test" })).not.toThrow();
    const record = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(record.level).toBe("error");
    expect(record.msg).toBe("boom");
    expect(record.where).toBe("test");
    expect(typeof record.stack).toBe("string");
  });

  it("captureException stringifies non-Error values", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    captureException("plain failure");
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string).msg).toBe("plain failure");
  });

  it("captureMessage logs a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    captureMessage("degraded path", { path: "/x" });
    const record = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(record.level).toBe("warn");
    expect(record.msg).toBe("degraded path");
  });
});
