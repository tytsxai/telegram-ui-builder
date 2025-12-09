import { describe, it, expect } from "vitest";
import { buildCallbackData } from "../callbackHelper";
import { CALLBACK_DATA_MAX_BYTES } from "../validation";

describe("buildCallbackData", () => {
  it("keeps value within 64 bytes", () => {
    const longAction = "x".repeat(200);
    const { value, bytes } = buildCallbackData({ prefix: "btn", action: longAction, data: { id: "a" }, nonce: true });
    expect(bytes).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
    expect(typeof value).toBe("string");
  });

  it("returns a value when within limit", () => {
    const { value, bytes } = buildCallbackData({ prefix: "btn", action: "ok", data: { id: "1" }, nonce: false });
    expect(bytes).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
    expect(value.startsWith("btn:")).toBe(true);
  });
});

