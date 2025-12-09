import createCallbackManager from "../../telegram-callback-factory/src";
import { CALLBACK_DATA_MAX_BYTES, getByteLength } from "./validation";

const base64FromUTF8 = (input: string) => {
  try {
    const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
    if (encoder) {
      const bytes = encoder.encode(input);
      let binary = "";
      bytes.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      return btoa(binary);
    }
  } catch (e) {
    void e;
  }
  // Fallback：利用 encodeURIComponent 处理非 ASCII，再交给 btoa
  try {
    return btoa(unescape(encodeURIComponent(input)));
  } catch (e) {
    void e;
  }
  // 最后兜底
  return btoa(input);
};

if (typeof globalThis.Buffer === "undefined") {
  // Minimal Buffer shim for browser builds (base64 only)
  // @ts-expect-error Browser polyfill
  globalThis.Buffer = {
    from: (input: string) => ({
      toString: (encoding?: string) => {
        if (encoding === "base64") {
          return base64FromUTF8(input);
        }
        return input;
      },
    }),
  };
}

const manager = createCallbackManager({ maxLength: CALLBACK_DATA_MAX_BYTES });

export const buildCallbackData = (options: {
  prefix?: string;
  action?: string;
  data?: Record<string, unknown>;
  ttlSeconds?: number;
  nonce?: boolean;
}) => {
  const namespace = (options.prefix || "btn").trim() || "btn";
  const action = (options.action || "action").trim() || "action";
  const ttlMs = options.ttlSeconds && options.ttlSeconds > 0 ? options.ttlSeconds * 1000 : undefined;
  const nonce = options.nonce !== false;
  const raw = manager.make(namespace, action, options.data ?? {}, { ttl: ttlMs, nonce });
  return { value: raw, bytes: getByteLength(raw) };
};
