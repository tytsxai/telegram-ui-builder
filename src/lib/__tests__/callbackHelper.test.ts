import { describe, it, expect, vi } from "vitest";
import { buildCallbackData } from "../callbackHelper";
import { CALLBACK_DATA_MAX_BYTES } from "../validation";

describe("buildCallbackData", () => {
  it("keeps value within 64 bytes", () => {
    const { value, bytes } = buildCallbackData({ prefix: "btn", action: "short", data: { id: "a" }, nonce: true });
    expect(bytes).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
    expect(typeof value).toBe("string");
  });

  it("returns a value when within limit", () => {
    const { value, bytes } = buildCallbackData({ prefix: "btn", action: "ok", data: { id: "1" }, nonce: false });
    expect(bytes).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
    expect(value.startsWith("btn:")).toBe(true);
  });

  it("rejects invalid prefix characters", () => {
    expect(() => buildCallbackData({ prefix: "bad:prefix", action: "ok" })).toThrow(/Invalid callback options/);
  });

  it("rejects empty action", () => {
    expect(() => buildCallbackData({ prefix: "btn", action: " " })).toThrow(/action must be non-empty/);
  });

  it("rejects non-plain data objects", () => {
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: [] as unknown as Record<string, unknown> })).toThrow(
      /data must be a plain object/
    );
  });

  it("rejects null data objects", () => {
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: null as unknown as Record<string, unknown> })).toThrow(
      /data must be a plain object/
    );
  });

  it("rejects overly long data values", () => {
    const longValue = "x".repeat(200);
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: { note: longValue } })).toThrow(/data value too long/);
  });

  it("rejects UTF-8 data values that exceed byte limits", () => {
    const emojiValue = "😀".repeat(40);
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: { note: emojiValue } })).toThrow(/data value too long/);
  });

  it("rejects deeply nested data", () => {
    const nested = { a: { b: { c: { d: "x" } } } };
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: nested })).toThrow(/data nesting too deep/);
  });

  it("rejects invalid ttlSeconds", () => {
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", ttlSeconds: 0 })).toThrow(/ttlSeconds/);
  });

  it("rejects invalid nonce type", () => {
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", nonce: "yes" as unknown as boolean })).toThrow(
      /nonce must be a boolean/
    );
  });

  it("rejects non-string prefix", () => {
    expect(() => buildCallbackData({ prefix: 123 as unknown as string, action: "ok" })).toThrow(/prefix must be a string/);
  });

  it("rejects overly long action", () => {
    const longAction = "a".repeat(50);
    expect(() => buildCallbackData({ prefix: "btn", action: longAction })).toThrow(/action exceeds/);
  });

  it("rejects large data payloads", () => {
    const bigData = { note: "x".repeat(400) };
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: bigData })).toThrow(/data payload too large/);
  });

  it("rejects non-finite numbers", () => {
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: { count: Infinity } })).toThrow(/finite number/);
  });

  it("rejects large arrays", () => {
    const bigArray = Array.from({ length: 25 }, () => "x");
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: { items: bigArray } })).toThrow(/data array too long/);
  });

  it("rejects invalid data keys", () => {
    const longKey = "k".repeat(200);
    expect(() =>
      buildCallbackData({ prefix: "btn", action: "ok", data: { [longKey]: "x" } })
    ).toThrow(/data key invalid/);
  });

  it("rejects non-plain nested objects", () => {
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: { meta: new Date() } })).toThrow(
      /data value must be a plain object/
    );
  });

  it("rejects too many data keys", () => {
    const manyKeys: Record<string, string> = {};
    for (let i = 0; i < 25; i += 1) {
      manyKeys[`k${i}`] = "v";
    }
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: manyKeys })).toThrow(/too many keys/);
  });

  it("rejects non-serializable data", () => {
    const badData = { id: BigInt(1) } as unknown as Record<string, unknown>;
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", data: badData })).toThrow(/JSON-serializable/);
  });

  it("accepts numeric values and small arrays", () => {
    const { value } = buildCallbackData({
      prefix: "btn",
      action: "ok",
      data: { count: 2, items: ["a", "b"], flag: true, note: null },
    });
    expect(value).toContain("btn:ok");
  });

  it("rejects non-finite ttlSeconds values", () => {
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", ttlSeconds: Number.NaN })).toThrow(/finite number/);
  });

  it("rejects ttlSeconds above the maximum", () => {
    expect(() => buildCallbackData({ prefix: "btn", action: "ok", ttlSeconds: 90000 })).toThrow(/between 1 and/);
  });

  it("uses defaults when options are omitted", () => {
    const { value } = buildCallbackData({});
    expect(value.startsWith("btn:action")).toBe(true);
  });

  it("accepts valid ttlSeconds and nonce values", () => {
    const { value } = buildCallbackData({ prefix: "btn", action: "ok", ttlSeconds: 30, nonce: false });
    expect(value.startsWith("btn:ok")).toBe(true);
  });

  it("polyfills Buffer when missing", async () => {
    const originalBuffer = globalThis.Buffer;
    try {
      vi.resetModules();
      // @ts-expect-error Simulate missing Buffer
      globalThis.Buffer = undefined;
      await import("../callbackHelper");
      const encoded = globalThis.Buffer.from("hello").toString("base64");
      expect(encoded).toBeTypeOf("string");
    } finally {
      globalThis.Buffer = originalBuffer;
    }
  });

  it("handles TextEncoder failures in base64 encoding", async () => {
    const originalBuffer = globalThis.Buffer;
    const originalTextEncoder = globalThis.TextEncoder;
    try {
      vi.resetModules();
      // @ts-expect-error Simulate missing Buffer
      globalThis.Buffer = undefined;
      globalThis.TextEncoder = class FakeEncoder {
        constructor() {
          throw new Error("fail");
        }
      } as unknown as typeof TextEncoder;
      await import("../callbackHelper");
      const encoded = globalThis.Buffer.from("hi").toString("base64");
      expect(encoded).toBeTypeOf("string");
    } finally {
      globalThis.Buffer = originalBuffer;
      globalThis.TextEncoder = originalTextEncoder;
    }
  });

  it("uses base64 fallback when TextEncoder is unavailable", async () => {
    const originalBuffer = globalThis.Buffer;
    const originalTextEncoder = globalThis.TextEncoder;
    const originalBtoa = globalThis.btoa;
    let callCount = 0;
    try {
      vi.resetModules();
      // @ts-expect-error Simulate missing Buffer
      globalThis.Buffer = undefined;
      // @ts-expect-error Simulate missing TextEncoder
      globalThis.TextEncoder = undefined;
      globalThis.btoa = ((input: string) => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("fail");
        }
        return originalBtoa(input);
      }) as typeof globalThis.btoa;
      await import("../callbackHelper");
      const encoded = globalThis.Buffer.from("ok").toString("base64");
      const raw = globalThis.Buffer.from("ok").toString("utf-8");
      expect(encoded).toBeTypeOf("string");
      expect(raw).toBe("ok");
      expect(callCount).toBe(2);
    } finally {
      globalThis.Buffer = originalBuffer;
      globalThis.TextEncoder = originalTextEncoder;
      globalThis.btoa = originalBtoa;
    }
  });

  it("exposes non-Error failures directly", () => {
    const badOptions = {
      get prefix() {
        throw "boom";
      },
      action: "ok",
    } as unknown as { prefix?: string; action?: string };
    expect(() => buildCallbackData(badOptions as unknown as { prefix?: string; action?: string })).toThrow("boom");
  });

  it("throws when callback data exceeds byte limit", async () => {
    try {
      vi.resetModules();
      vi.doMock("../validation", () => ({
        CALLBACK_DATA_MAX_BYTES: 64,
        getByteLength: (value: string) => (value.includes(":") ? 100 : 1),
      }));
      const { buildCallbackData: mockedBuild } = await import("../callbackHelper");
      expect(() => mockedBuild({ prefix: "btn", action: "ok" })).toThrow(/callback_data exceeds/);
    } finally {
      vi.resetModules();
      vi.unmock("../validation");
    }
  });

  it("falls back to UTF-8 byte length when getByteLength fails", async () => {
    try {
      vi.resetModules();
      vi.doMock("../validation", () => ({
        CALLBACK_DATA_MAX_BYTES: 64,
        getByteLength: () => {
          throw new Error("TextEncoder unavailable");
        },
      }));
      const { buildCallbackData: mockedBuild } = await import("../callbackHelper");
      const emojiValue = "😀".repeat(40);
      expect(() => mockedBuild({ prefix: "btn", action: "ok", data: { note: emojiValue } })).toThrow(/data value too long/);
    } finally {
      vi.resetModules();
      vi.unmock("../validation");
    }
  });
});
