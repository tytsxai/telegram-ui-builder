import { describe, it, expect, vi, afterEach } from "vitest";
import {
  logSupabaseError,
  withRetry,
  computeBackoffDelay,
  classifyRetryableError,
  BASE_DELAY,
  MAX_DELAY,
  MAX_ATTEMPTS,
} from "../supabaseRetry";

describe("supabaseRetry logging", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("emits requestId even when missing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logSupabaseError({ action: "test", table: "screens", error: { code: "E", message: "err" } });
    expect(spy).toHaveBeenCalled();
    const payload = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.requestId).toBeTruthy();
    spy.mockRestore();
  });

  it("skips logging when error is empty", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logSupabaseError({ action: "test", error: null });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("classifies retryable errors consistently", () => {
    expect(classifyRetryableError({ status: 429 })).toBe("429");
    expect(classifyRetryableError({ status: 503 })).toBe("5xx");
    expect(classifyRetryableError({ code: "429" })).toBe("429");
    expect(classifyRetryableError({ code: "50001" })).toBe("5xx");
    expect(classifyRetryableError({ message: "NetworkError when attempting to fetch" })).toBe("network");
    expect(classifyRetryableError({ message: "other failure" })).toBeNull();
  });

  it("returns null for empty errors and detects message-based network issues", () => {
    expect(classifyRetryableError(null)).toBeNull();
    expect(classifyRetryableError({})).toBeNull();
    expect(classifyRetryableError({ message: "ECONNRESET" })).toBe("network");
  });

  it("uses exponential backoff for 429 errors", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const op = vi
      .fn()
      .mockRejectedValueOnce({ code: "429", message: "rate limited" })
      .mockResolvedValueOnce("ok");

    const promise = withRetry(op, { attempts: 2, backoffMs: 100, jitterRatio: 0 });
    await vi.runAllTimersAsync();

    expect(await promise).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
    const timeouts = timeoutSpy.mock.calls.map(([, delay]) => delay);
    expect(timeouts[0]).toBe(100);
    expect(computeBackoffDelay(100, 2, 0)).toBe(400);
    randomSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  it("defaults to the base delay for the first retry", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const op = vi.fn().mockRejectedValueOnce({ status: 500 }).mockResolvedValueOnce("ok");

    const promise = withRetry(op, { attempts: 2, jitterRatio: 0 });
    await vi.runAllTimersAsync();

    expect(await promise).toBe("ok");
    expect(timeoutSpy.mock.calls[0]?.[1]).toBe(BASE_DELAY);
    randomSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  it("retries network failures with jittered delay", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const op = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce("ok");

    const promise = withRetry(op, { attempts: 2, backoffMs: 80 });
    await vi.runAllTimersAsync();

    expect(await promise).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
    const delay = timeoutSpy.mock.calls[0]?.[1] as number;
    expect(delay).toBeGreaterThan(80);
    randomSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  it("caps backoff delay at MAX_DELAY", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(1);
    const delay = computeBackoffDelay(1000, 10, 0.25);
    expect(delay).toBe(MAX_DELAY);
    randomSpy.mockRestore();
  });

  it("clamps negative backoff delays to zero", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const op = vi.fn().mockRejectedValueOnce({ status: 500 }).mockResolvedValueOnce("ok");

    const promise = withRetry(op, { attempts: 2, backoffMs: -50, jitterRatio: -1 });
    await vi.runAllTimersAsync();

    expect(await promise).toBe("ok");
    expect(timeoutSpy.mock.calls[0]?.[1]).toBe(0);
    randomSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  it("caps excessive retry attempts", async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const op = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const promise = withRetry(op, { attempts: MAX_ATTEMPTS + 4, backoffMs: 10 });
    const expectation = expect(promise).rejects.toBeInstanceOf(TypeError);
    await vi.runAllTimersAsync();
    await expectation;
    expect(op).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(timeoutSpy).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
    timeoutSpy.mockRestore();
  });

  it("enforces a minimum of one attempt", async () => {
    const op = vi.fn().mockResolvedValueOnce("ok");
    await expect(withRetry(op, { attempts: 0 })).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });
});
