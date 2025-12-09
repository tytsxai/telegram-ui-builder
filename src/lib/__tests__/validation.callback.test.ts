import { describe, it, expect } from "vitest";
import { validateCallbackData, CALLBACK_DATA_MAX_BYTES, CALLBACK_DATA_ERROR_MESSAGE } from "../validation";

describe("validateCallbackData", () => {
  it("accepts value within 64 bytes", () => {
    const value = "ok";
    expect(validateCallbackData(value)).toBe(value);
  });

  it("rejects overly long value", () => {
    const long = "x".repeat(128);
    expect(() => validateCallbackData(long)).toThrow(CALLBACK_DATA_ERROR_MESSAGE);
  });

  it("handles boundary", () => {
    const exact = "y".repeat(CALLBACK_DATA_MAX_BYTES);
    expect(validateCallbackData(exact)).toBe(exact);
  });
});

