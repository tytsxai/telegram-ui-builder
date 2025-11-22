import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueueSaveOperation,
  enqueueUpdateOperation,
  processPendingOps,
  readPendingOps,
  clearPendingOps,
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
});
