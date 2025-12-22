export type ErrorReportContext = {
  source: "react_error_boundary" | "window_error" | "unhandled_rejection" | "supabase" | string;
  action?: string;
  table?: string;
  userId?: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

export type ErrorReporter = (error: unknown, context?: ErrorReportContext) => void;

let reporter: ErrorReporter | null = null;

const REDACTED_VALUE = "[REDACTED]";
const CIRCULAR_VALUE = "[CIRCULAR]";
const MAX_DEPTH_VALUE = "[MAX_DEPTH]";
const MAX_RECURSION_DEPTH = 6;

export const SENSITIVE_KEYS = [
  "password",
  "token",
  "secret",
  "email",
  "auth",
  "credential",
  "api_key",
  "apikey",
  "key",
];

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isSensitiveKey = (key: string) => {
  const lowered = key.toLowerCase();
  if (lowered === "key" || lowered.endsWith("key") || lowered.endsWith("_key") || lowered.endsWith("-key")) {
    return true;
  }
  return SENSITIVE_KEYS.some((sensitive) => lowered.includes(sensitive));
};

const sanitizeStackTrace = (stack: string) => {
  if (!stack.includes("\n")) return stack;
  return stack.replace(/(?:file:\/\/)?(?:[A-Za-z]:\\|\/)[^\s)]+/g, "<redacted-path>");
};

const sanitizeErrorDataInternal = (input: unknown, seen: WeakSet<object>, depth: number): unknown => {
  if (depth > MAX_RECURSION_DEPTH) return MAX_DEPTH_VALUE;
  if (input instanceof Error) {
    return {
      name: input.name,
      message: input.message,
      stack: input.stack ? sanitizeStackTrace(input.stack) : undefined,
    };
  }

  if (typeof input === "string") {
    return sanitizeStackTrace(input);
  }

  if (!input || typeof input !== "object") return input;

  if (seen.has(input)) return CIRCULAR_VALUE;
  seen.add(input);

  if (Array.isArray(input)) {
    try {
      return input.map((value) => sanitizeErrorDataInternal(value, seen, depth + 1));
    } finally {
      seen.delete(input);
    }
  }

  if (!isPlainObject(input)) {
    seen.delete(input);
    return input;
  }

  const output: Record<string, unknown> = {};
  try {
    for (const [key, value] of Object.entries(input)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED_VALUE;
        continue;
      }

      if (key.toLowerCase().includes("stack")) {
        output[key] =
          typeof value === "string" ? sanitizeStackTrace(value) : sanitizeErrorDataInternal(value, seen, depth + 1);
        continue;
      }

      output[key] = sanitizeErrorDataInternal(value, seen, depth + 1);
    }
  } finally {
    seen.delete(input);
  }

  return output;
};

export const sanitizeErrorData = (input: unknown, seen: WeakSet<object> = new WeakSet()): unknown =>
  sanitizeErrorDataInternal(input, seen, 0);

export const setErrorReporter = (fn: ErrorReporter | null) => {
  if (reporter && fn && reporter !== fn) {
    console.warn("[ErrorReporter] Overwriting existing reporter");
  }
  reporter = fn;
};

export const reportError = (error: unknown, context?: ErrorReportContext) => {
  if (!reporter) return;
  try {
    reporter(error, context);
  } catch (err) {
    console.error("[ErrorReporter] publish failed", err);
  }
};
