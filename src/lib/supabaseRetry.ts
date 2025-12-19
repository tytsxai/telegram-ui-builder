import type { PostgrestError } from "@supabase/supabase-js";
import { reportError } from "./errorReporting";

export type RetryReason = "429" | "5xx" | "network";

export type RetryEvent = {
  attempt: number;
  delayMs: number;
  reason: RetryReason;
  error: unknown;
  requestId?: string;
};

type RetryOptions = {
  attempts?: number;
  backoffMs?: number;
  jitterRatio?: number;
  requestId?: string;
  onRetry?: (event: RetryEvent) => void;
};

type Op<T> = () => Promise<T>;

export interface SupabaseErrorLog {
  table?: string;
  action: string;
  userId?: string;
  requestId?: string;
  error: PostgrestError | null | unknown;
}

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
const fallbackRequestId = () => `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const isNetworkError = (error: unknown) => {
  if (!error) return false;
  if (error instanceof TypeError) return true;
  const message = (error as Error)?.message ?? "";
  return message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("ECONN");
};

export const classifyRetryableError = (error: unknown): RetryReason | null => {
  const code = (error as Partial<PostgrestError> | undefined)?.code;
  const status = (error as { status?: number } | undefined)?.status;
  if (status === 429) return "429";
  if (typeof status === "number" && status >= 500) return "5xx";
  if (code === "429") return "429";
  if (typeof code === "string" && code.startsWith("5")) return "5xx";
  if (isNetworkError(error)) return "network";
  return null;
};

export const computeBackoffDelay = (base: number, attemptIndex: number, jitterRatio = 0.25) => {
  const factor = Math.max(1, Math.pow(2, attemptIndex));
  const delay = base * factor;
  const jitter = delay * jitterRatio * Math.random();
  return Math.round(delay + jitter);
};

export const withRetry = async <T>(op: Op<T>, opts: RetryOptions = {}): Promise<T> => {
  const attempts = opts.attempts ?? 3;
  const backoff = opts.backoffMs ?? 350;
  const jitterRatio = opts.jitterRatio ?? 0.25;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      const reason = classifyRetryableError(err);
      const isLastAttempt = i === attempts - 1;
      if (!reason || isLastAttempt) {
        break;
      }
      const delayMs = computeBackoffDelay(backoff, i, jitterRatio);
      opts.onRetry?.({
        attempt: i + 1,
        delayMs,
        reason,
        error: err,
        requestId: opts.requestId,
      });
      await wait(delayMs);
    }
  }
  throw lastError;
};

export const logSupabaseError = (info: SupabaseErrorLog) => {
  if (!info.error) return;
  const requestId = info.requestId || fallbackRequestId();
  const err = info.error as Partial<PostgrestError>;
  console.error("[Supabase]", {
    requestId,
    action: info.action,
    table: info.table,
    userId: info.userId,
    code: err.code,
    message: err.message,
    details: err.details,
    hint: err.hint,
  });
  reportError(info.error, {
    source: "supabase",
    action: info.action,
    table: info.table,
    userId: info.userId,
    requestId,
    details: {
      code: err.code,
      message: err.message,
      details: err.details,
      hint: err.hint,
    },
  });
};
