import { describe, it, expect, vi, afterEach } from "vitest";
import { logSupabaseError, withRetry, computeBackoffDelay } from "../supabaseRetry";

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
});
