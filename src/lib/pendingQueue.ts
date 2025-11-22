import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type SavePayload = TablesInsert<"screens">;
export type UpdatePayload = { id: string; update: TablesUpdate<"screens"> };

export type PendingItem =
  | {
      id: string;
      kind: "save";
      payload: SavePayload;
      createdAt: number;
      attempts: number;
      lastError?: string;
      lastAttemptAt?: number;
    }
  | {
      id: string;
      kind: "update";
      payload: UpdatePayload;
      createdAt: number;
      attempts: number;
      lastError?: string;
      lastAttemptAt?: number;
    };

const STORAGE_VERSION = "v2";
const buildKey = (userId?: string | null) => `pending_ops_${STORAGE_VERSION}_${userId ?? "anon"}`;
const now = () => Date.now();
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

const persist = (items: PendingItem[], userId?: string | null) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(buildKey(userId), JSON.stringify(items));
  } catch (e) {
    void e;
  }
};

export const clearPendingOps = (userId?: string | null) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(buildKey(userId));
  } catch (e) {
    void e;
  }
};

const reviveLegacy = (userId: string | null | undefined) => {
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
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(buildKey(userId));
    if (!raw) {
      return reviveLegacy(userId);
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        if (!("id" in item) || !("kind" in item)) return null;
        const attempts = typeof item.attempts === "number" ? item.attempts : 0;
        const createdAt = typeof item.createdAt === "number" ? item.createdAt : now();
        const lastAttemptAt = typeof (item as PendingItem).lastAttemptAt === "number" ? (item as PendingItem).lastAttemptAt : undefined;
        return { ...item, attempts, createdAt, lastAttemptAt } as PendingItem;
      })
      .filter(Boolean) as PendingItem[];
  } catch {
    return [];
  }
};

export const enqueueSaveOperation = (payload: SavePayload, userId?: string | null): PendingItem => {
  const queue = readPendingOps(userId);
  const op: PendingItem = {
    id: genId(),
    kind: "save",
    payload,
    createdAt: now(),
    attempts: 0,
  };
  queue.push(op);
  persist(queue, userId);
  return op;
};

export const enqueueUpdateOperation = (payload: UpdatePayload, userId?: string | null): PendingItem => {
  const queue = readPendingOps(userId);
  // Replace older updates targeting the same screen to avoid stale writes
  const nextQueue = queue.filter((item) => !(item.kind === "update" && item.payload.id === payload.id));
  const op: PendingItem = {
    id: genId(),
    kind: "update",
    payload,
    createdAt: now(),
    attempts: 0,
  };
  nextQueue.push(op);
  persist(nextQueue, userId);
  return op;
};

type ProcessOptions = {
  userId?: string | null;
  maxAttempts?: number;
  backoffMs?: number;
  execute: (item: PendingItem) => Promise<void>;
  signal?: AbortSignal;
  onSuccess?: (item: PendingItem) => void;
  onPermanentFailure?: (item: PendingItem, error: unknown) => void;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the pending queue in-order. Successful operations are removed.
 * Failures are retried with backoff; after maxAttempts they are dropped
 * and surfaced via onPermanentFailure.
 */
export const processPendingOps = async (options: ProcessOptions) => {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 400;
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
      const updated: PendingItem = {
        ...item,
        attempts,
        lastError: error instanceof Error ? error.message : String(error),
        lastAttemptAt: Date.now(),
      };
      if (attempts >= maxAttempts) {
        queue.splice(i, 1);
        persist(queue, options.userId);
        options.onPermanentFailure?.(updated, error);
        continue;
      }
      queue[i] = updated;
      persist(queue, options.userId);
      await wait(backoffMs * attempts);
      // retry the same index after backoff
    }
  }

  return queue;
};

export const savePendingOps = (items: PendingItem[], userId?: string | null) => {
  persist(items, userId);
};
