import { describe, it, expect, vi } from "vitest";
import { logSupabaseError } from "../supabaseRetry";

describe("supabaseRetry logging", () => {
  it("emits requestId even when missing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logSupabaseError({ action: "test", table: "screens", error: { code: "E", message: "err" } });
    expect(spy).toHaveBeenCalled();
    const payload = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.requestId).toBeTruthy();
    spy.mockRestore();
  });
});
