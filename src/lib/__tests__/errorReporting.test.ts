import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError, sanitizeErrorData, setErrorReporter } from "../errorReporting";
import type { ErrorReportContext, ErrorReporter } from "../errorReporting";

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

describe("errorReporting", () => {
  it("setErrorReporter: sets and overwrites reporter; warns when overwriting different reporter", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const reporterA: ErrorReporter = () => {};
    const reporterB: ErrorReporter = () => {};

    setErrorReporter(reporterA);
    setErrorReporter(reporterB);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("[ErrorReporter] Overwriting existing reporter");
  });

  it("setErrorReporter: does not warn when setting same reporter again", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const reporter: ErrorReporter = () => {};

    setErrorReporter(reporter);
    setErrorReporter(reporter);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reportError: calls reporter when set (passes error + context)", () => {
    const fn = vi.fn();
    setErrorReporter(fn);

    const error = new Error("boom");
    const context: ErrorReportContext = { source: "supabase", action: "insert", requestId: "r1" };

    reportError(error, context);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(error, context);
  });

  it("reportError: is silent when no reporter set", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    setErrorReporter(null);
    reportError(new Error("no reporter"), { source: "window_error" });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reportError: catches reporter exceptions and logs console.error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = new Error("reporter failed");

    const badReporter: ErrorReporter = () => {
      throw thrown;
    };
    setErrorReporter(badReporter);

    expect(() => reportError(new Error("original"), { source: "unhandled_rejection" })).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[ErrorReporter] publish failed", thrown);
  });

  it("sanitizeErrorData: redacts sensitive keys recursively", () => {
    const input = {
      password: "hunter2",
      profile: {
        email: "user@example.com",
        apiKey: "abc123",
      },
      nested: [{ token: "t1" }, { ok: true }],
      ok: "keep",
    };

    const sanitized = sanitizeErrorData(input) as Record<string, unknown>;

    expect(sanitized.password).toBe("[REDACTED]");
    expect((sanitized.profile as Record<string, unknown>).email).toBe("[REDACTED]");
    expect((sanitized.profile as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect(((sanitized.nested as unknown[])[0] as Record<string, unknown>).token).toBe("[REDACTED]");
    expect(sanitized.ok).toBe("keep");
  });

  it("sanitizeErrorData: scrubs stack trace paths", () => {
    const stack = [
      "Error: boom",
      "    at /Users/jiesen/project/src/file.ts:10:5",
      "    at C:\\Users\\jiesen\\project\\src\\file.ts:20:7",
    ].join("\n");

    const sanitized = sanitizeErrorData({ stack }) as Record<string, unknown>;
    const sanitizedStack = sanitized.stack as string;

    expect(sanitizedStack).toContain("<redacted-path>");
    expect(sanitizedStack).not.toContain("/Users/jiesen");
    expect(sanitizedStack).not.toContain("C:\\Users\\jiesen");
  });

  it("sanitizeErrorData: handles Error instances", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at /Users/jiesen/project/src/file.ts:10:5";

    const sanitized = sanitizeErrorData(error) as Record<string, unknown>;

    expect(sanitized.message).toBe("boom");
    expect(sanitized.stack).toContain("<redacted-path>");
  });

  it("sanitizeErrorData: preserves non-plain objects and handles circular references", () => {
    const when = new Date("2024-01-01T00:00:00.000Z");
    const circular: Record<string, unknown> = { when };
    circular.self = circular;

    const sanitized = sanitizeErrorData(circular) as Record<string, unknown>;

    expect(sanitized.when).toBe(when);
    expect(sanitized.self).toBe("[CIRCULAR]");
  });

  it("sanitizeErrorData: handles stack keys with non-string values and errors without stack", () => {
    const error = new Error("no stack");
    (error as { stack?: string }).stack = undefined;

    const sanitizedError = sanitizeErrorData(error) as Record<string, unknown>;
    expect(sanitizedError.stack).toBeUndefined();

    const input = { stackInfo: { note: "ok" } };
    const sanitized = sanitizeErrorData(input) as Record<string, unknown>;

    expect((sanitized.stackInfo as Record<string, unknown>).note).toBe("ok");
  });

  it("sanitizeErrorData: enforces maximum depth and avoids infinite recursion", () => {
    const deep: Record<string, unknown> = { level: 0 };
    let cursor = deep;
    for (let i = 1; i <= 10; i += 1) {
      const next: Record<string, unknown> = { level: i };
      cursor.next = next;
      cursor = next;
    }

    const sanitized = sanitizeErrorData(deep) as Record<string, unknown>;
    let node = sanitized;
    for (let i = 0; i < 6; i += 1) {
      node = node.next as Record<string, unknown>;
    }

    expect(node.next).toBe("[MAX_DEPTH]");
  });
});
