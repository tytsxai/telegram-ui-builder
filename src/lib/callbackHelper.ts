import createCallbackManager from "../../telegram-callback-factory/src";
import { CALLBACK_DATA_MAX_BYTES, getByteLength } from "./validation";

if (typeof globalThis.Buffer === "undefined") {
  // Minimal Buffer shim for browser builds (base64 only)
  // @ts-expect-error Browser polyfill
  globalThis.Buffer = {
    from: (input: string) => ({
      toString: (encoding?: string) => {
        if (encoding === "base64") {
          return btoa(input);
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
