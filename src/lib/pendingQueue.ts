import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { computeBackoffDelay } from "./supabaseRetry";
import { publishSyncEvent } from "./syncTelemetry";

/**
 * Offline write queue persisted in `localStorage`.
 *
 * Contract (maintenance safety):
 * - Storage key: `pending_ops_v2_<userId|anon>` (see `buildKey`)
 * - Items are JSON-serialized; code changes here can affect data durability.
 * - `update` operations are de-duped by screen id to ensure replay applies the latest state.
 * - Version bumps must include a migration path and tests (see `reviveLegacy` and `src/lib/__tests__/pendingQueue.test.ts`).
 *
 * This module is intentionally UI-agnostic: enqueue/replay orchestration is handled by higher-level hooks.
 */
export type SavePayload = TablesInsert<"screens">;
export type UpdatePayload = { id: string; update: TablesUpdate<"screens"> };

export type PendingFailure = { at: number; message: string; requestId?: string };

type PendingBase = {
  id: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: number;
  failures?: PendingFailure[];
};

export type PendingItem =
  | (PendingBase & {
      kind: "save";
      payload: SavePayload;
    })
  | (PendingBase & {
      kind: "update";
      payload: UpdatePayload;
    });

const STORAGE_VERSION = "v2";
const buildKey = (userId?: string | null) => `pending_ops_${STORAGE_VERSION}_${userId ?? "anon"}`;
const now = () => Date.now();
const MAX_FAILURE_LOG = 5;
const MAX_QUEUE_SIZE = 100;
const memoryFallbackQueue = new Map<string, PendingItem[]>();

// Simple lock to prevent concurrent read-modify-write race conditions
let writeLock: Promise<void> = Promise.resolve();
const withLock = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  const prevLock = writeLock;
  let release: () => void;
  writeLock = new Promise((resolve) => { release = resolve; });
  await prevLock;
  try {
    return await fn();
  } finally {
    release!();
  }
};
const genId = () => {
  try {
    // @ts-expect-error crypto may not exist in all environments
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      // @ts-expect-error crypto.randomUUID exists in browsers/jsdom
      return crypto.randomUUID();
    }
  } catch (e) {
    void e;
  }
  return `pending_${now()}_${Math.random().toString(16).slice(2)}`;
};

export class PersistError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PersistError";
  }
}

const isQuotaExceeded = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const name = typeof (error as { name?: string }).name === "string" ? (error as { name?: string }).name : "";
  const code = typeof (error as { code?: number }).code === "number" ? (error as { code?: number }).code : undefined;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
};

const isStorageFullError = (error: unknown) => {
  if (isQuotaExceeded(error)) return true;
  const message =
    typeof (error as { message?: string }).message === "string"
      ? (error as { message?: string }).message
      : typeof error === "string"
        ? error
        : "";
  const name = typeof (error as { name?: string }).name === "string" ? (error as { name?: string }).name : "";
  const combined = `${name} ${message}`.toLowerCase();
  return (
    (combined.includes("quota") && combined.includes("exceed")) ||
    (combined.includes("storage") && (combined.includes("full") || combined.includes("quota") || combined.includes("exceed")))
  );
};

const trimQueue = (items: PendingItem[]) => {
  if (items.length <= MAX_QUEUE_SIZE) {
    return { items, dropped: 0 };
  }
  const dropped = items.length - MAX_QUEUE_SIZE;
  return { items: items.slice(dropped), dropped };
};

const notifyQueueTrim = (dropped: number) => {
  if (dropped <= 0) return;
  console.warn(`[PendingQueue] Dropped ${dropped} item(s) to stay within ${MAX_QUEUE_SIZE} entries.`);
  publishSyncEvent({
    scope: "queue",
    status: {
      state: "error",
      requestId: "queue-trim",
      message: `Offline queue exceeded ${MAX_QUEUE_SIZE} entries; dropped ${dropped}.`,
      at: now(),
    },
  });
};

const persist = (items: PendingItem[], userId?: string | null): boolean => {
  if (typeof localStorage === "undefined") return false;
  const { items: trimmed, dropped } = trimQueue(items);
  notifyQueueTrim(dropped);
  const key = buildKey(userId);
  try {
    localStorage.setItem(key, JSON.stringify(trimmed));
    memoryFallbackQueue.delete(key);
    return true;
  } catch (e) {
    if (isStorageFullError(e)) {
      console.warn("[PendingQueue] Storage quota exceeded; using in-memory fallback queue.");
      memoryFallbackQueue.set(key, trimmed);
      publishSyncEvent({
        scope: "queue",
        status: {
          state: "error",
          requestId: "queue-quota",
          message: "Offline queue stored in memory due to storage quota limit.",
          at: now(),
        },
      });
      return false;
    }
    console.error("[PendingQueue] Failed to persist queue:", e);
    throw new PersistError("Failed to persist offline queue. Storage may be full.", e);
  }
};

export const clearPendingOps = (userId?: string | null) => {
  const key = buildKey(userId);
  memoryFallbackQueue.delete(key);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch (e) {
    void e;
  }
};

const reviveLegacy = (userId: string | null | undefined) => {
  if (typeof localStorage === "undefined") return [];
  try {
    const rawV1 = localStorage.getItem(`pending_ops_${userId ?? "anon"}`);
    if (!rawV1) return [] as PendingItem[];
    const parsed = JSON.parse(rawV1);
    if (!Array.isArray(parsed)) return [] as PendingItem[];

    const migrated: PendingItem[] = parsed
      .filter((p) => p && typeof p === "object" && ("kind" in p || "payload" in p))
      .map((p) => {
        if (p.kind === "save") {
          const payload = p.payload as Record<string, unknown>;
          return {
            id: genId(),
            kind: "save" as const,
            payload: {
              user_id: userId ?? undefined,
              is_public: false,
              name: String(payload.name ?? "Untitled"),
              message_content: String(payload.message_content ?? ""),
              keyboard: payload.keyboard,
            },
            createdAt: now(),
            attempts: 0,
          };
        }
        if (p.kind === "update") {
          const payload = p.payload as Record<string, unknown>;
          return {
            id: genId(),
            kind: "update" as const,
            payload: {
              id: String(payload.id ?? ""),
              update: {
                message_content: String(payload.message_content ?? ""),
                keyboard: payload.keyboard,
              },
            },
            createdAt: now(),
            attempts: 0,
          };
        }
        return null;
      })
      .filter(Boolean) as PendingItem[];

    if (migrated.length > 0) {
      persist(migrated, userId);
      localStorage.removeItem(`pending_ops_${userId ?? "anon"}`);
    }
    return migrated;
  } catch {
    return [];
  }
};

export const readPendingOps = (userId?: string | null): PendingItem[] => {
  const key = buildKey(userId);
  const fallback = memoryFallbackQueue.get(key);
  if (fallback) {
    return [...fallback];
  }
  if (typeof localStorage === "undefined") return [];
  const normalizeFailures = (item: unknown, fallbackMessage?: string, fallbackAt?: number): PendingFailure[] | undefined => {
    if (!item) {
      if (fallbackMessage && typeof fallbackAt === "number") {
        return [{ at: fallbackAt, message: fallbackMessage }];
      }
      return undefined;
    }

    if (Array.isArray(item)) {
      const entries = item
        .map((f) => {
          if (!f || typeof f !== "object") return null;
          const at = (f as PendingFailure).at;
          const message = (f as PendingFailure).message;
          const requestId = typeof (f as PendingFailure).requestId === "string" ? (f as PendingFailure).requestId : undefined;
          if (typeof at !== "number" || typeof message !== "string") return null;
          return { at, message, requestId } as PendingFailure;
        })
        .filter(Boolean) as PendingFailure[];
      if (entries.length > 0) {
        return entries.slice(-MAX_FAILURE_LOG);
      }
    }

    if (fallbackMessage && typeof fallbackAt === "number") {
      return [{ at: fallbackAt, message: fallbackMessage }];
    }
    return undefined;
  };

  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return reviveLegacy(userId);
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const hydrated = parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        if (!("id" in item) || !("kind" in item)) return null;
        const attempts = typeof item.attempts === "number" ? item.attempts : 0;
        const createdAt = typeof item.createdAt === "number" ? item.createdAt : now();
        const lastAttemptAt = typeof (item as PendingItem).lastAttemptAt === "number" ? (item as PendingItem).lastAttemptAt : undefined;
        const lastError = typeof (item as PendingItem).lastError === "string" ? (item as PendingItem).lastError : undefined;
        const failures = normalizeFailures((item as PendingItem).failures, lastError, lastAttemptAt);
        return { ...item, attempts, createdAt, lastAttemptAt, failures, lastError } as PendingItem;
      })
      .filter(Boolean) as PendingItem[];
    const { items: trimmed, dropped } = trimQueue(hydrated);
    if (dropped > 0) {
      persist(trimmed, userId);
    }
    return trimmed;
  } catch {
    return [];
  }
};

export const enqueueSaveOperation = async (payload: SavePayload, userId?: string | null): Promise<PendingItem> => {
  return withLock(() => {
    const queue = readPendingOps(userId);
    const op: PendingItem = {
      id: genId(),
      kind: "save",
      payload,
      createdAt: now(),
      attempts: 0,
      failures: [],
    };
    queue.push(op);
    persist(queue, userId);
    return op;
  });
};

export const enqueueUpdateOperation = async (payload: UpdatePayload, userId?: string | null): Promise<PendingItem> => {
  return withLock(() => {
    const queue = readPendingOps(userId);
    // Replace older updates targeting the same screen to avoid stale writes
    const nextQueue = queue.filter((item) => !(item.kind === "update" && item.payload.id === payload.id));
    const op: PendingItem = {
      id: genId(),
      kind: "update",
      payload,
      createdAt: now(),
      attempts: 0,
      failures: [],
    };
    nextQueue.push(op);
    persist(nextQueue, userId);
    return op;
  });
};

type ProcessOptions = {
  userId?: string | null;
  maxAttempts?: number;
  backoffMs?: number;
  jitterRatio?: number;
  execute: (item: PendingItem) => Promise<void>;
  signal?: AbortSignal;
  onSuccess?: (item: PendingItem) => void;
  onItemFailure?: (item: PendingItem, error: unknown, meta: { attempt: number; delayMs?: number }) => void;
  onPermanentFailure?: (item: PendingItem, error: unknown) => void;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the pending queue in-order. Successful operations are removed.
 * Failures are retried with exponential backoff + jitter; each failure
 * is recorded on the item (lastError/lastAttemptAt/failures). After
 * maxAttempts items are dropped and surfaced via onPermanentFailure.
 */
export const processPendingOps = async (options: ProcessOptions) => {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 400;
  const jitterRatio = options.jitterRatio ?? 0.25;
  const queue = readPendingOps(options.userId);

  for (let i = 0; i < queue.length; ) {
    if (options.signal?.aborted) break;
    const item = queue[i];
    try {
      await options.execute(item);
      queue.splice(i, 1);
      persist(queue, options.userId);
      options.onSuccess?.(item);
      continue;
    } catch (error) {
      const attempts = item.attempts + 1;
      const failureAt = now();
      const message = error instanceof Error ? error.message : String(error);
      const requestId = typeof (error as { requestId?: string } | undefined)?.requestId === "string" ? (error as { requestId?: string }).requestId : undefined;
      const failures = [...(item.failures ?? []), { at: failureAt, message, requestId }].slice(-MAX_FAILURE_LOG);
      const updated: PendingItem = {
        ...item,
        attempts,
        lastError: message,
        lastAttemptAt: failureAt,
        failures,
      };
      const delayMs = computeBackoffDelay(backoffMs, attempts - 1, jitterRatio);
      publishSyncEvent({
        scope: "queue",
        status: {
          state: "error",
          requestId: requestId ?? item.id,
          message: `${item.kind} ${item.id} failed (${attempts}/${maxAttempts}): ${message}`,
          at: failureAt,
        },
      });
      if (attempts >= maxAttempts) {
        queue.splice(i, 1);
        persist(queue, options.userId);
        options.onItemFailure?.(updated, error, { attempt: attempts });
        options.onPermanentFailure?.(updated, error);
        continue;
      }
      queue[i] = updated;
      persist(queue, options.userId);
      options.onItemFailure?.(updated, error, { attempt: attempts, delayMs });
      if (options.signal?.aborted) break;
      await wait(delayMs);
      // retry the same index after backoff
    }
  }

  return queue;
};

export const savePendingOps = (items: PendingItem[], userId?: string | null) => {
  persist(items, userId);
};
