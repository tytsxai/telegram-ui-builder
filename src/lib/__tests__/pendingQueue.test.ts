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

  it("queues save operations with metadata", () => {
    const op = enqueueSaveOperation(
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

  it("replaces update operations for the same screen", () => {
    enqueueUpdateOperation(
      { id: "screen-1", update: { message_content: "v1", keyboard: [] } },
      "user-1"
    );
    enqueueUpdateOperation(
      { id: "screen-1", update: { message_content: "v2", keyboard: [] } },
      "user-1"
    );

    const queue = readPendingOps("user-1");
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.update?.message_content).toBe("v2");
  });

  it("processes queue with retries and drops after max attempts", async () => {
    enqueueSaveOperation(
      {
        user_id: "user-1",
        name: "New",
        message_content: "content",
        keyboard: [],
        is_public: false,
      },
      "user-1"
    );
    enqueueUpdateOperation(
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
      enqueueUpdateOperation({ id: "screen-1", update: { message_content: "retry", keyboard: [] } }, "user-1");

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

  it("clears pending ops when requested", () => {
    enqueueSaveOperation(
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
    enqueueUpdateOperation({ id: "screen-1", update: { message_content: "oops", keyboard: [] } }, "user-1");
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

  it("passes failure log to permanent failure handler", async () => {
    enqueueSaveOperation(
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

  it("falls back to random id when crypto.randomUUID is missing", () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", undefined as unknown as Crypto);
    try {
      const op = enqueueSaveOperation(
        { user_id: "user-1", name: "No crypto", message_content: "c", keyboard: [], is_public: false },
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

  it("continues when localStorage writes fail", () => {
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    expect(() =>
      enqueueSaveOperation({ user_id: "user-1", name: "Resilient", message_content: "msg", keyboard: [], is_public: false }, "user-1"),
    ).not.toThrow();
    setSpy.mockRestore();
  });

  it("swallows remove errors when clearing storage", () => {
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("forbidden");
    });
    expect(() => clearPendingOps()).not.toThrow();
    removeSpy.mockRestore();
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
});
