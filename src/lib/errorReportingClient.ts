import { setErrorReporter } from "@/lib/errorReporting";

const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 8000;

type SerializedError = {
  name?: string;
  message: string;
  stack?: string;
};

const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}...` : value);

const sanitizeUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    // Remove query params and hash that may contain tokens/PII
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
};

const redactContext = (context: unknown): unknown => {
  if (!context) return context;
  if (typeof context === "string") {
    return truncate(context, MAX_MESSAGE_LENGTH);
  }
  if (typeof context !== "object") return context;

  const safe = { ...(context as Record<string, unknown>) };
  const sensitiveKeys = ["token", "password", "secret", "key", "auth", "credential", "details"];
  for (const key of Object.keys(safe)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      safe[key] = "[REDACTED]";
    }
  }
  return safe;
};

const serializeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message || "Unknown error",
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: "Unserializable error" };
  }
};

const shrinkContext = (context: unknown) => {
  if (!context) return context;
  if (typeof context === "string") return truncate(context, MAX_MESSAGE_LENGTH);
  if (typeof context !== "object") return context;

  const { details, ...rest } = context as Record<string, unknown>;
  if (details === undefined) return context;
  return { ...rest, details: "[truncated]" };
};

const shrinkPayload = (payload: Record<string, unknown>) => {
  const trimmed: Record<string, unknown> = { ...payload, truncated: true };
  if (typeof trimmed.message === "string") {
    trimmed.message = truncate(trimmed.message, MAX_MESSAGE_LENGTH);
  }
  if (typeof trimmed.stack === "string") {
    trimmed.stack = truncate(trimmed.stack, MAX_STACK_LENGTH);
  }
  if ("context" in trimmed) {
    trimmed.context = shrinkContext(trimmed.context);
  }
  return trimmed;
};

const stripPayload = (payload: Record<string, unknown>) => {
  const trimmed = { ...payload };
  delete trimmed.context;
  delete trimmed.stack;
  delete trimmed.userAgent;
  delete trimmed.url;
  return trimmed;
};

const safeStringify = (payload: Record<string, unknown>) => {
  try {
    let json = JSON.stringify(payload);
    if (json.length <= MAX_PAYLOAD_BYTES) return json;

    let reduced = shrinkPayload(payload);
    json = JSON.stringify(reduced);
    if (json.length <= MAX_PAYLOAD_BYTES) return json;

    reduced = stripPayload(reduced);
    json = JSON.stringify(reduced);
    if (json.length <= MAX_PAYLOAD_BYTES) return json;

    return JSON.stringify({ message: "Error payload too large", truncated: true });
  } catch {
    return JSON.stringify({ message: "Failed to serialize error payload" });
  }
};

const sendPayload = (url: string, payload: Record<string, unknown>, apiKey?: string) => {
  const body = safeStringify(payload);
  if (apiKey) {
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body,
      keepalive: true,
    }).catch(() => undefined);
    return;
  }

  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(url, blob);
    return;
  }

  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
};

export const initErrorReporting = () => {
  const url = import.meta.env.VITE_ERROR_REPORTING_URL as string | undefined;
  if (!url || !import.meta.env.PROD) return;

  const apiKey = import.meta.env.VITE_ERROR_REPORTING_API_KEY as string | undefined;

  setErrorReporter((error, context) => {
    const serialized = serializeError(error);
    const payload = {
      ...serialized,
      message: truncate(serialized.message, MAX_MESSAGE_LENGTH),
      stack: serialized.stack ? truncate(serialized.stack, MAX_STACK_LENGTH) : undefined,
      context: redactContext(context),
      url: typeof window !== "undefined" ? sanitizeUrl(window.location.href) : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      release: import.meta.env.VITE_APP_VERSION ?? import.meta.env.VITE_COMMIT_SHA ?? undefined,
      env: import.meta.env.MODE,
      at: Date.now(),
    };
    sendPayload(url, payload, apiKey);
  });
};
