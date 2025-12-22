import createCallbackManager from "../../telegram-callback-factory/src";
import { CALLBACK_DATA_MAX_BYTES, getByteLength } from "./validation";

const getUtf8ByteLength = (value: string) => {
  try {
    return getByteLength(value);
  } catch (error) {
    void error;
  }
  if (typeof globalThis.Buffer !== "undefined" && typeof globalThis.Buffer.from === "function") {
    const buffer = globalThis.Buffer.from(value);
    if (typeof (buffer as { length?: number }).length === "number") {
      return (buffer as { length: number }).length;
    }
  }
  try {
    return unescape(encodeURIComponent(value)).length;
  } catch (error) {
    void error;
  }
  return value.length;
};

const manager = createCallbackManager({ maxLength: CALLBACK_DATA_MAX_BYTES });

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PREFIX_MAX_BYTES = 16;
const ACTION_MAX_BYTES = 24;
const DATA_MAX_BYTES = 256;
const DATA_MAX_DEPTH = 3;
const DATA_MAX_KEYS = 20;
const DATA_MAX_STRING_BYTES = 128;
const DATA_MAX_ARRAY_LENGTH = 20;
const MAX_TTL_SECONDS = 86400;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const validateIdentifier = (label: string, rawValue: unknown, maxBytes: number) => {
  if (typeof rawValue !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const value = rawValue.trim();
  if (!value) {
    throw new Error(`${label} must be non-empty`);
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} contains invalid characters`);
  }
  const bytes = getUtf8ByteLength(value);
  if (bytes > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  return value;
};

const validateDataValue = (
  value: unknown,
  path: string,
  state: { depth: number; keys: number }
): void => {
  if (value === null) return;
  const valueType = typeof value;
  if (valueType === "string") {
    const bytes = getUtf8ByteLength(value);
    if (bytes > DATA_MAX_STRING_BYTES) {
      throw new Error(`data value too long at ${path}`);
    }
    return;
  }
  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`data value must be a finite number at ${path}`);
    }
    return;
  }
  if (valueType === "boolean") return;

  if (Array.isArray(value)) {
    if (value.length > DATA_MAX_ARRAY_LENGTH) {
      throw new Error(`data array too long at ${path}`);
    }
    value.forEach((item, idx) => {
      validateDataValue(item, `${path}[${idx}]`, state);
    });
    return;
  }

  if (!isPlainObject(value)) {
    throw new Error(`data value must be a plain object at ${path}`);
  }
  if (state.depth >= DATA_MAX_DEPTH) {
    throw new Error(`data nesting too deep at ${path}`);
  }
  state.depth += 1;
  for (const [key, nested] of Object.entries(value)) {
    state.keys += 1;
    if (state.keys > DATA_MAX_KEYS) {
      throw new Error("data has too many keys");
    }
    if (!key || getUtf8ByteLength(key) > DATA_MAX_STRING_BYTES) {
      throw new Error(`data key invalid at ${path}`);
    }
    validateDataValue(nested, `${path}.${key}`, state);
  }
  state.depth -= 1;
};

const validateDataObject = (data: unknown) => {
  if (data === undefined) return {};
  if (!isPlainObject(data)) {
    throw new Error("data must be a plain object");
  }
  let json = "";
  try {
    json = JSON.stringify(data);
  } catch (error) {
    throw new Error("data must be JSON-serializable");
  }
  if (getUtf8ByteLength(json) > DATA_MAX_BYTES) {
    throw new Error("data payload too large");
  }
  const state = { depth: 0, keys: 0 };
  validateDataValue(data, "data", state);
  return data;
};

const validateOptions = (options: {
  prefix?: unknown;
  action?: unknown;
  data?: unknown;
  ttlSeconds?: unknown;
  nonce?: unknown;
}) => {
  const prefix = validateIdentifier("prefix", options.prefix ?? "btn", PREFIX_MAX_BYTES);
  const action = validateIdentifier("action", options.action ?? "action", ACTION_MAX_BYTES);
  const data = validateDataObject(options.data);
  if (options.ttlSeconds !== undefined) {
    if (typeof options.ttlSeconds !== "number" || !Number.isFinite(options.ttlSeconds)) {
      throw new Error("ttlSeconds must be a finite number");
    }
    if (options.ttlSeconds <= 0 || options.ttlSeconds > MAX_TTL_SECONDS) {
      throw new Error(`ttlSeconds must be between 1 and ${MAX_TTL_SECONDS}`);
    }
  }
  if (options.nonce !== undefined && typeof options.nonce !== "boolean") {
    throw new Error("nonce must be a boolean");
  }
  return { prefix, action, data };
};

export const buildCallbackData = (options: {
  prefix?: string;
  action?: string;
  data?: Record<string, unknown>;
  ttlSeconds?: number;
  nonce?: boolean;
}) => {
  let namespace: string;
  let action: string;
  let data: Record<string, unknown>;
  try {
    const validated = validateOptions(options);
    namespace = validated.prefix;
    action = validated.action;
    data = validated.data;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid callback options: ${error.message}`);
    }
    throw error;
  }

  const ttlMs = options.ttlSeconds && options.ttlSeconds > 0 ? options.ttlSeconds * 1000 : undefined;
  const nonce = options.nonce !== false;
  const raw = manager.make(namespace, action, data, { ttl: ttlMs, nonce });

  const bytes = getUtf8ByteLength(raw);
  if (bytes > CALLBACK_DATA_MAX_BYTES) {
    throw new Error(`callback_data exceeds ${CALLBACK_DATA_MAX_BYTES} bytes (got ${bytes}). Reduce payload size.`);
  }

  return { value: raw, bytes };
};
