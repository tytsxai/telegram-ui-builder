import type { PostgrestError } from "@supabase/supabase-js";

type RetryOptions = {
  attempts?: number;
  backoffMs?: number;
};

type Op<T> = () => Promise<T>;

export interface SupabaseErrorLog {
  table?: string;
  action: string;
  userId?: string;
  error: PostgrestError | null | unknown;
}

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

export const withRetry = async <T>(op: Op<T>, opts: RetryOptions = {}): Promise<T> => {
  const attempts = opts.attempts ?? 3;
  const backoff = opts.backoffMs ?? 350;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      // Postgrest errors might be wrapped; swallow only transient
      await wait(backoff * (i + 1));
    }
  }
  throw lastError;
};

export const logSupabaseError = (info: SupabaseErrorLog) => {
  if (!info.error) return;
  const err = info.error as Partial<PostgrestError>;
  console.error("[Supabase]", {
    action: info.action,
    table: info.table,
    userId: info.userId,
    code: err.code,
    message: err.message,
    details: err.details,
    hint: err.hint,
  });
};
