import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  enqueueSaveOperation,
  enqueueUpdateOperation,
  processPendingOps,
  readPendingOps,
  clearPendingOps,
  savePendingOps,
  type PendingItem,
} from "../pendingQueue";

describe("pendingQueue", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("queues save operations with metadata", async () => {
    const op = await enqueueSaveOperation(
      {
        user_id: "user-1",
        name: "Test",
        message_content: "hello",
        keyboard: [],
        is_public: false,
      },
      "user-1"
    );

    const queue = readPendingOps("user-1");
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(op.id);
    expect(queue[0].attempts).toBe(0);
    expect(queue[0].payload.name).toBe("Test");
  });

  it("replaces update operations for the same screen", async () => {
    await enqueueUpdateOperation(
      { id: "screen-1", update: { message_content: "v1", keyboard: [] } },
      "user-1"
    );
    await enqueueUpdateOperation(
      { id: "screen-1", update: { message_content: "v2", keyboard: [] } },
      "user-1"
    );

    const queue = readPendingOps("user-1");
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.update?.message_content).toBe("v2");
  });

  it("processes queue with retries and drops after max attempts", async () => {
    await enqueueSaveOperation(
      {
        user_id: "user-1",
        name: "New",
        message_content: "content",
        keyboard: [],
        is_public: false,
      },
      "user-1"
    );
    await enqueueUpdateOperation(
      { id: "screen-1", update: { message_content: "update", keyboard: [] } },
      "user-1"
    );

    let updateAttempts = 0;
    const remaining = await processPendingOps({
      userId: "user-1",
      backoffMs: 1,
      maxAttempts: 2,
      execute: async (item) => {
        if (item.kind === "save") return;
        updateAttempts += 1;
        if (updateAttempts < 2) {
          throw new Error("temporary");
        }
      },
    });

    expect(updateAttempts).toBe(2);
    expect(remaining).toHaveLength(0);
    expect(readPendingOps("user-1")).toHaveLength(0);
  });

  it("persists retry metadata and waits before retrying failed items", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);

    try {
      await enqueueUpdateOperation({ id: "screen-1", update: { message_content: "retry", keyboard: [] } }, "user-1");

      const execute = vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValueOnce(undefined);

      const promise = processPendingOps({
        userId: "user-1",
        backoffMs: 20,
        maxAttempts: 2,
        jitterRatio: 0,
        execute,
      });

      await Promise.resolve();

      const persisted = readPendingOps("user-1");
      expect(persisted[0].attempts).toBe(1);
      expect(persisted[0].lastError).toBe("temporary");
      expect(persisted[0].lastAttemptAt).toBe(start);

      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
      const remaining = await promise;

      expect(execute).toHaveBeenCalledTimes(2);
      expect(remaining).toHaveLength(0);
      expect(readPendingOps("user-1")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears pending ops when requested", async () => {
    await enqueueSaveOperation(
      {
        user_id: "user-1",
        name: "Test",
        message_content: "hello",
        keyboard: [],
        is_public: false,
      },
      "user-1"
    );
    clearPendingOps("user-1");
    expect(readPendingOps("user-1")).toHaveLength(0);
  });

  it("stores failure history with timestamps", async () => {
    await enqueueUpdateOperation({ id: "screen-1", update: { message_content: "oops", keyboard: [] } }, "user-1");
    const controller = new AbortController();

    await processPendingOps({
      userId: "user-1",
      backoffMs: 1,
      jitterRatio: 0,
      signal: controller.signal,
      execute: async () => {
        throw new Error("network down");
      },
      onItemFailure: () => {
        controller.abort();
      },
    });

    const queue = readPendingOps("user-1");
    expect(queue).toHaveLength(1);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].lastError).toContain("network down");
    expect(queue[0].failures?.[0].message).toBe("network down");
    expect(typeof queue[0].failures?.[0].at).toBe("number");
  });

  it("respects pre-aborted signals before processing", async () => {
    await enqueueSaveOperation(
      { user_id: "user-1", name: "Abort", message_content: "msg", keyboard: [], is_public: false },
      "user-1",
    );
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn();

    const remaining = await processPendingOps({ userId: "user-1", signal: controller.signal, execute });

    expect(execute).not.toHaveBeenCalled();
    expect(remaining).toHaveLength(1);
  });

  it("passes failure log to permanent failure handler", async () => {
    await enqueueSaveOperation(
      {
        user_id: "user-1",
        name: "Boom",
        message_content: "fail me",
        keyboard: [],
        is_public: false,
      },
      "user-1"
    );

    const failures: unknown[] = [];
    await processPendingOps({
      userId: "user-1",
      maxAttempts: 3,
      backoffMs: 1,
      jitterRatio: 0,
      execute: async () => {
        throw new Error("always failing");
      },
      onPermanentFailure: (item) => {
        failures.push(item.failures);
      },
    });

    expect(failures).toHaveLength(1);
    const logged = failures[0] as { message: string }[];
    expect(logged).toHaveLength(3);
    expect(logged[0].message).toBe("always failing");
  });

  it("captures requestId from failure metadata", async () => {
    await enqueueSaveOperation(
      { user_id: "user-1", name: "Req", message_content: "msg", keyboard: [], is_public: false },
      "user-1",
    );

    const failures: PendingItem[] = [];
    await processPendingOps({
      userId: "user-1",
      maxAttempts: 1,
      execute: async () => {
        const err = new Error("fail");
        (err as Error & { requestId?: string }).requestId = "req-1";
        throw err;
      },
      onPermanentFailure: (item) => {
        failures.push(item);
      },
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].failures?.[0].requestId).toBe("req-1");
  });

  it("handles non-Error failures with default backoff settings", async () => {
    await enqueueSaveOperation(
      { user_id: "user-1", name: "Default", message_content: "msg", keyboard: [], is_public: false },
      "user-1",
    );
    const controller = new AbortController();

    await processPendingOps({
      userId: "user-1",
      signal: controller.signal,
      execute: async () => {
        throw "boom";
      },
      onItemFailure: () => {
        controller.abort();
      },
    });

    const queue = readPendingOps("user-1");
    expect(queue).toHaveLength(1);
    expect(queue[0].lastError).toBe("boom");
  });

  it("hydrates failures from lastError when explicit failures are absent", () => {
    const stored: Partial<PendingItem>[] = [
      {
        id: "saved-1",
        kind: "save",
        payload: { user_id: "user-1", name: "N", message_content: "c", keyboard: [], is_public: false },
        attempts: 1,
        lastError: "timeout",
        lastAttemptAt: 1234,
      },
    ];
    localStorage.setItem("pending_ops_v2_user-1", JSON.stringify(stored));

    const queue = readPendingOps("user-1");
    expect(queue[0].failures?.[0]).toMatchObject({ message: "timeout", at: 1234 });
  });

  it("returns empty array when stored JSON is malformed", () => {
    localStorage.setItem("pending_ops_v2_user-1", "{not-json");
    expect(readPendingOps("user-1")).toEqual([]);
  });

  it("returns empty when stored data is not an array", () => {
    localStorage.setItem("pending_ops_v2_user-1", JSON.stringify({ bad: true }));
    expect(readPendingOps("user-1")).toEqual([]);
  });

  it("filters invalid stored queue entries", () => {
    localStorage.setItem(
      "pending_ops_v2_user-1",
      JSON.stringify([
        null,
        { kind: "save" },
        { id: "ok-1", kind: "save", payload: { user_id: "u1", name: "Ok", message_content: "c", keyboard: [], is_public: false } },
      ]),
    );

    const queue = readPendingOps("user-1");
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe("ok-1");
  });

  it("returns empty when storage is unavailable", () => {
    const original = globalThis.localStorage;
    vi.stubGlobal("localStorage", undefined as unknown as Storage);
    try {
      expect(readPendingOps()).toEqual([]);
      expect(() => clearPendingOps()).not.toThrow();
    } finally {
      vi.stubGlobal("localStorage", original);
      vi.unstubAllGlobals();
    }
  });

  it("migrates legacy v1 queue entries", () => {
    localStorage.setItem(
      "pending_ops_anon",
      JSON.stringify([
        { kind: "save", payload: { name: "Old", message_content: "hi", keyboard: [] } },
        { kind: "update", payload: { id: "legacy", message_content: "later", keyboard: [] } },
      ]),
    );

    const migrated = readPendingOps(null);
    expect(migrated).toHaveLength(2);
    expect(migrated[0].kind).toBe("save");
    expect(migrated[1].kind).toBe("update");
    expect(localStorage.getItem("pending_ops_v2_anon")).toBeTruthy();
  });

  it("fills missing legacy save fields with defaults", () => {
    localStorage.setItem(
      "pending_ops_anon",
      JSON.stringify([{ kind: "save", payload: { keyboard: [] } }]),
    );

    const migrated = readPendingOps(null);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].kind).toBe("save");
    expect(migrated[0].payload.name).toBe("Untitled");
    expect(migrated[0].payload.message_content).toBe("");
  });

  it("fills missing legacy update fields with defaults", () => {
    localStorage.setItem(
      "pending_ops_anon",
      JSON.stringify([{ kind: "update", payload: { keyboard: [] } }]),
    );

    const migrated = readPendingOps(null);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].kind).toBe("update");
    expect(migrated[0].payload.id).toBe("");
    expect(migrated[0].payload.update.message_content).toBe("");
  });

  it("skips legacy entries missing kind and payload", () => {
    localStorage.setItem(
      "pending_ops_anon",
      JSON.stringify([{ bad: true }]),
    );

    const migrated = readPendingOps(null);
    expect(migrated).toEqual([]);
  });

  it("skips legacy payloads that do not produce valid items", () => {
    localStorage.setItem(
      "pending_ops_anon",
      JSON.stringify([{ kind: "delete", payload: { id: "nope" } }]),
    );

    const migrated = readPendingOps(null);
    expect(migrated).toEqual([]);
    expect(localStorage.getItem("pending_ops_v2_anon")).toBeNull();
  });

  it("normalizes failures when persisted logs are malformed", () => {
    const badFailures = [
      {
        id: "oops",
        kind: "save",
        payload: { user_id: "u1", name: "bad", message_content: "c", keyboard: [] },
        attempts: 1,
        createdAt: 1,
        lastError: "boom",
        lastAttemptAt: 1234,
        failures: [{ at: "invalid", message: 123 }],
      },
    ];
    localStorage.setItem("pending_ops_v2_anon", JSON.stringify(badFailures));
    const [item] = readPendingOps();
    expect(item.failures?.[0].message).toBe("boom");
    expect(item.failures?.[0].at).toBe(1234);
  });

  it("falls back when failures are non-array values", () => {
    const badFailures = [
      {
        id: "oops",
        kind: "save",
        payload: { user_id: "u1", name: "bad", message_content: "c", keyboard: [] },
        attempts: 1,
        createdAt: 1,
        lastError: "boom",
        lastAttemptAt: 1234,
        failures: { message: "nope" },
      },
    ];
    localStorage.setItem("pending_ops_v2_anon", JSON.stringify(badFailures));
    const [item] = readPendingOps();
    expect(item.failures?.[0]).toMatchObject({ message: "boom", at: 1234 });
  });

  it("falls back when failure entries are non-objects", () => {
    const badFailures = [
      {
        id: "oops",
        kind: "save",
        payload: { user_id: "u1", name: "bad", message_content: "c", keyboard: [] },
        attempts: 1,
        createdAt: 1,
        lastError: "boom",
        lastAttemptAt: 1234,
        failures: [null, "bad"],
      },
    ];
    localStorage.setItem("pending_ops_v2_anon", JSON.stringify(badFailures));
    const [item] = readPendingOps();
    expect(item.failures?.[0]).toMatchObject({ message: "boom", at: 1234 });
  });

  it("preserves valid failure logs when reading stored queues", () => {
    const stored: PendingItem[] = [
      {
        id: "fail-1",
        kind: "save",
        payload: { user_id: "user-1", name: "F", message_content: "c", keyboard: [], is_public: false },
        attempts: 1,
        createdAt: 1,
        lastError: "boom",
        lastAttemptAt: 2,
        failures: [{ at: 2, message: "boom", requestId: "req-9" }],
      },
    ];
    localStorage.setItem("pending_ops_v2_user-1", JSON.stringify(stored));
    const [item] = readPendingOps("user-1");
    expect(item.failures?.[0]).toMatchObject({ message: "boom", at: 2, requestId: "req-9" });
  });

  it("falls back to random id when crypto.randomUUID is missing", async () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", undefined as unknown as Crypto);
    try {
      const op = await enqueueSaveOperation(
        { user_id: "user-1", name: "No crypto", message_content: "c", keyboard: [], is_public: false },
        "user-1",
      );
      expect(op.id.startsWith("pending_")).toBe(true);
    } finally {
      vi.stubGlobal("crypto", original);
      vi.unstubAllGlobals();
    }
  });

  it("falls back to random id when crypto.randomUUID throws", async () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", { randomUUID: () => { throw new Error("boom"); } } as unknown as Crypto);
    try {
      const op = await enqueueSaveOperation(
        { user_id: "user-1", name: "Throw crypto", message_content: "c", keyboard: [], is_public: false },
        "user-1",
      );
      expect(op.id.startsWith("pending_")).toBe(true);
    } finally {
      vi.stubGlobal("crypto", original);
      vi.unstubAllGlobals();
    }
  });

  it("ignores legacy payloads that are not arrays", () => {
    localStorage.setItem("pending_ops_anon", JSON.stringify({ not: "array" }));
    expect(readPendingOps()).toEqual([]);
  });

  it("skips legacy items with unknown kinds", () => {
    localStorage.setItem(
      "pending_ops_anon",
      JSON.stringify([
        { kind: "save", payload: { name: "Keep", message_content: "hi", keyboard: [] } },
        { kind: "delete", payload: { id: "skip" } },
      ]),
    );

    const migrated = readPendingOps();
    expect(migrated).toHaveLength(1);
    expect(migrated[0].kind).toBe("save");
  });

  it("returns empty array when legacy storage read fails", () => {
    const originalGetItem = localStorage.getItem.bind(localStorage);
    localStorage.getItem = (key: string) => {
      if (key.startsWith("pending_ops_anon")) {
        throw new Error("blocked");
      }
      return originalGetItem(key);
    };

    try {
      expect(readPendingOps(null)).toEqual([]);
    } finally {
      localStorage.getItem = originalGetItem;
    }
  });

  it("propagates PersistError when localStorage writes fail", async () => {
    // Note: In jsdom environment, Storage.prototype.setItem mock may not intercept
    // the actual localStorage calls. This test verifies the error propagation path
    // when persist() throws. The withLock wrapper should propagate errors correctly.
    const originalPersist = localStorage.setItem.bind(localStorage);
    let callCount = 0;
    localStorage.setItem = (...args: Parameters<typeof localStorage.setItem>) => {
      callCount++;
      if (callCount > 0) {
        throw new Error("quota");
      }
      return originalPersist(...args);
    };

    try {
      await expect(
        enqueueSaveOperation({ user_id: "user-1", name: "Resilient", message_content: "msg", keyboard: [], is_public: false }, "user-1"),
      ).rejects.toThrow("Failed to persist offline queue");
    } finally {
      localStorage.setItem = originalPersist;
    }
  });

  it("falls back to memory when storage quota is exceeded", async () => {
    const originalPersist = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };

    try {
      const op = await enqueueSaveOperation(
        { user_id: "user-1", name: "Fallback", message_content: "msg", keyboard: [], is_public: false },
        "user-1",
      );
      const queue = readPendingOps("user-1");
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe(op.id);
    } finally {
      localStorage.setItem = originalPersist;
      clearPendingOps("user-1");
    }
  });

  it("limits queue size to 100 entries", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 101; i += 1) {
      const op = await enqueueSaveOperation(
        { user_id: "user-1", name: `Item-${i}`, message_content: "msg", keyboard: [], is_public: false },
        "user-1",
      );
      ids.push(op.id);
    }

    const queue = readPendingOps("user-1");
    expect(queue).toHaveLength(100);
    expect(queue.find((item) => item.id === ids[0])).toBeUndefined();
    expect(queue.find((item) => item.id === ids[100])).toBeTruthy();
  });

  it("swallows remove errors when clearing storage", () => {
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("forbidden");
    });
    expect(() => clearPendingOps()).not.toThrow();
    removeSpy.mockRestore();
  });

  it("swallows direct removeItem errors when clearing storage", () => {
    const originalRemove = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(() => clearPendingOps()).not.toThrow();
    } finally {
      localStorage.removeItem = originalRemove;
    }
  });

  it("saves provided pending ops directly", () => {
    const items: PendingItem[] = [
      {
        id: "direct-1",
        kind: "update",
        payload: { id: "s1", update: { name: "New", keyboard: [] } },
        createdAt: Date.now(),
        attempts: 2,
      },
    ];

    savePendingOps(items, "user-2");
    const stored = readPendingOps("user-2");
    expect(stored[0].id).toBe("direct-1");
    expect(stored[0].failures).toBeUndefined();
  });

  it("migrates legacy v1 queue entries", () => {
    const legacy = [
      { kind: "save", payload: { name: "Legacy", message_content: "msg", keyboard: [] } },
      { kind: "update", payload: { id: "legacy-1", message_content: "old", keyboard: [] } },
    ];
    localStorage.setItem("pending_ops_user-legacy", JSON.stringify(legacy));

    const migrated = readPendingOps("user-legacy");
    expect(migrated).toHaveLength(2);
    expect(migrated[0].kind).toBe("save");
    expect(migrated[1].kind).toBe("update");
  });

  it("trims oversized stored queues on read", () => {
    const stored: PendingItem[] = Array.from({ length: 101 }, (_, index) => ({
      id: `item-${index}`,
      kind: "save",
      payload: { user_id: "user-1", name: `Name-${index}`, message_content: "c", keyboard: [], is_public: false },
      createdAt: Date.now(),
      attempts: 0,
    }));
    localStorage.setItem("pending_ops_v2_user-1", JSON.stringify(stored));
    const setSpy = vi.spyOn(localStorage, "setItem");

    const queue = readPendingOps("user-1");
    expect(queue).toHaveLength(100);
    expect(queue[0].id).toBe("item-1");
    expect(setSpy).toHaveBeenCalled();
    setSpy.mockRestore();
  });
});
