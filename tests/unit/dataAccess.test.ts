import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseDataAccess } from "@/lib/dataAccess";

const withRetry = vi.hoisted(() => vi.fn(async (op: () => unknown, opts?: unknown) => op()));
const logSupabaseError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseRetry", () => ({
  withRetry,
  logSupabaseError,
}));

describe("SupabaseDataAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withRetry.mockImplementation(async (op) => op());
  });

  it("fills missing user id when saving and wraps call with retry options", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "s1", user_id: "user-1" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1", retryAttempts: 2, backoffMs: 25 });
    const res = await da.saveScreen({ name: "n", message_content: "m", keyboard: [], is_public: false });

    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ user_id: "user-1" })]);
    expect(res).toEqual({ id: "s1", user_id: "user-1" });
    const [, options] = withRetry.mock.calls[0];
    expect(options).toMatchObject({ attempts: 2, backoffMs: 25, jitterRatio: 0.25 });
    expect(options?.requestId).toBeDefined();
  });

  it("updates screen scoped by id and user id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "s1", message_content: "updated" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const updateBuilder: any = { eq: vi.fn(), select };
    updateBuilder.eq.mockReturnValue(updateBuilder);

    const update = vi.fn().mockReturnValue(updateBuilder);
    const from = vi.fn().mockReturnValue({ update });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });

    const result = await da.updateScreen({
      screenId: "s1",
      update: { message_content: "updated", keyboard: [], updated_at: "now" },
    });

    expect(result).toEqual({ id: "s1", message_content: "updated" });
    expect(updateBuilder.eq).toHaveBeenCalledWith("id", "s1");
    expect(updateBuilder.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("applies user and screen filters when deleting layouts", async () => {
    const inSpy = vi.fn().mockReturnValue({ error: null });
    const eqSpy = vi.fn().mockReturnValue({ in: inSpy, error: null });
    const deleteSpy = vi.fn().mockReturnValue({ eq: eqSpy, in: inSpy, error: null });
    const from = vi.fn().mockReturnValue({ delete: deleteSpy });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
    const ids = await da.deleteLayouts({ userId: "user-1", ids: ["a", "b"] });

    expect(eqSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(inSpy).toHaveBeenCalledWith("screen_id", ["a", "b"]);
    expect(ids).toEqual(["a", "b"]);
  });

  it("skips screen ids filter when none provided for layout deletion", async () => {
    const inSpy = vi.fn();
    const eqSpy = vi.fn().mockReturnValue({ in: inSpy, error: null });
    const deleteSpy = vi.fn().mockReturnValue({ eq: eqSpy, in: inSpy, error: null });
    const from = vi.fn().mockReturnValue({ delete: deleteSpy });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
    await da.deleteLayouts({ userId: "user-1" });

    expect(eqSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(inSpy).not.toHaveBeenCalled();
  });

  it("loads pinned ids when available", async () => {
    const single = vi.fn().mockResolvedValue({ data: { pinned_ids: ["s1", "s2"] }, error: null });
    const eqSpy = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq: eqSpy, single });
    const from = vi.fn().mockReturnValue({ select });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
    const pins = await da.fetchPins({ userId: "user-1" });

    expect(from).toHaveBeenCalledWith("user_pins");
    expect(eqSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(pins).toEqual(["s1", "s2"]);
  });

  it("returns empty pins when row is missing", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const eqSpy = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq: eqSpy, single });
    const from = vi.fn().mockReturnValue({ select });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
    const pins = await da.fetchPins({ userId: "user-1" });

    expect(pins).toEqual([]);
  });

  it("throws when pin fetch fails with unexpected error", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: "500", message: "boom" } });
    const eqSpy = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq: eqSpy, single });
    const from = vi.fn().mockReturnValue({ select });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
    await expect(da.fetchPins({ userId: "user-1" })).rejects.toEqual({ code: "500", message: "boom" });
  });

  it("logs and rethrows errors from supabase operations", async () => {
    const failingError = new Error("db down");
    withRetry.mockImplementationOnce(async () => {
      throw failingError;
    });

    const inSpy = vi.fn().mockResolvedValue({ error: null });
    const eqSpy = vi.fn().mockReturnValue({ in: inSpy, error: null });
    const deleteSpy = vi.fn().mockReturnValue({ eq: eqSpy, in: inSpy, error: null });
    const from = vi.fn().mockReturnValue({ delete: deleteSpy });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });

    await expect(da.deleteScreens({ ids: ["s1"], userId: "user-1" })).rejects.toThrow("db down");
    expect(logSupabaseError).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", table: "screens", userId: "user-1", error: failingError }));
  });

  it("surfaces retry callbacks with action context when provided", async () => {
    const onRetry = vi.fn();
    withRetry.mockImplementationOnce(async (op, options: any) => {
      options?.onRetry?.({ attempt: 1, error: new Error("first fail"), nextDelayMs: 100, requestId: "req-xyz" });
      return op();
    });

    const single = vi.fn().mockResolvedValue({ data: { id: "s1", user_id: "user-1" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1", onRetry });
    await da.saveScreen({ name: "n", message_content: "m", keyboard: [], is_public: false });

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ action: "insert", table: "screens", userId: "user-1", requestId: "req-xyz" }),
    );
  });

  it("short-circuits bulk operations when payload is empty", async () => {
    const from = vi.fn();
    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });

    await expect(da.insertScreens([])).resolves.toEqual([]);
    await expect(da.upsertLayouts([])).resolves.toEqual([]);
    await expect(da.fetchLayouts({ userId: "user-1", ids: [] })).resolves.toEqual([]);

    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces supabase errors for save/update/delete", async () => {
    const saveSingle = vi.fn().mockResolvedValue({ data: null, error: new Error("insert failed") });
    const saveSelect = vi.fn().mockReturnValue({ single: saveSingle });
    const saveInsert = vi.fn().mockReturnValue({ select: saveSelect });
    const saveFrom = vi.fn().mockReturnValue({ insert: saveInsert });

    const updateSingle = vi.fn().mockResolvedValue({ data: null, error: new Error("update failed") });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateBuilder: any = { eq: vi.fn(), select: updateSelect };
    updateBuilder.eq.mockReturnValue(updateBuilder);

    const client = {
      from: (table: string) => {
        if (table === "screens") {
          return { insert: saveInsert, update: vi.fn().mockReturnValue(updateBuilder), delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue({ error: new Error("delete failed") }) }) }) };
        }
        return { insert: saveInsert };
      },
    } as unknown as { from: typeof saveFrom };

    const da = new SupabaseDataAccess(client, { userId: "user-1" });

    await expect(da.saveScreen({ name: "bad", message_content: "m", keyboard: [], is_public: false })).rejects.toThrow("insert failed");
    await expect(da.updateScreen({ screenId: "x", update: { message_content: "m" } })).rejects.toThrow("update failed");
    await expect(da.deleteScreens({ ids: ["x"], userId: "user-1" })).rejects.toThrow("delete failed");
  });

  it("throws when share helpers are called without a user id", async () => {
    const da = new SupabaseDataAccess({ from: vi.fn() } as unknown as { from: () => unknown }, {});
    await expect(da.publishShareToken({ screenId: "s1", token: "t" })).rejects.toThrow(/requires userId/);
    await expect(da.rotateShareToken("s1", "t2")).rejects.toThrow(/requires userId/);
    await expect(da.revokeShareToken("s1")).rejects.toThrow(/requires userId/);
  });

  it("falls back to safe ids when crypto.randomUUID fails", async () => {
    const randomUUIDSpy = globalThis.crypto ? vi.spyOn(globalThis.crypto, "randomUUID") : undefined;
    randomUUIDSpy?.mockImplementation(() => {
      throw new Error("nope");
    });
    try {
      const inSpy = vi.fn().mockResolvedValue({ error: null });
      const eqSpy = vi.fn().mockReturnValue({ in: inSpy });
      const deleteSpy = vi.fn().mockReturnValue({ eq: eqSpy, in: inSpy });
      const from = vi.fn().mockReturnValue({ delete: deleteSpy });

      const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
      await expect(da.deleteScreens({ ids: ["s1"], userId: "user-1" })).resolves.toEqual(["s1"]);
      const [, options] = withRetry.mock.calls[withRetry.mock.calls.length - 1];
      expect(String((options as { requestId: string }).requestId)).toMatch(/^req_/);
      expect(deleteSpy).toHaveBeenCalled();
    } finally {
      randomUUIDSpy?.mockRestore();
    }
  });

  it("inserts multiple screens and returns persisted rows", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: "s1" }, { id: "s2" }], error: null });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
    const payload = [
      { user_id: "user-1", name: "A", message_content: "m1", keyboard: [], is_public: false },
      { user_id: "user-1", name: "B", message_content: "m2", keyboard: [], is_public: false },
    ];
    const rows = await da.insertScreens(payload);

    expect(from).toHaveBeenCalledWith("screens");
    expect(insert).toHaveBeenCalledWith(payload);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "s1" });
  });

  it("fetches layouts scoped to the requesting user", async () => {
    const inSpy = vi.fn().mockResolvedValue({ data: [{ screen_id: "s1", x: 10, y: 20 }], error: null });
    const eqSpy = vi.fn().mockReturnValue({ in: inSpy });
    const select = vi.fn().mockReturnValue({ eq: eqSpy });
    const from = vi.fn().mockReturnValue({ select });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
    const rows = await da.fetchLayouts({ userId: "user-1", ids: ["s1"] });

    expect(select).toHaveBeenCalledWith("screen_id,x,y");
    expect(eqSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(inSpy).toHaveBeenCalledWith("screen_id", ["s1"]);
    expect(rows[0]).toMatchObject({ screen_id: "s1", x: 10, y: 20 });
  });

  it("upserts pinned ids with conflict handling", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
    const payload = { user_id: "user-1", pinned_ids: ["s1"] };
    const result = await da.upsertPins(payload);

    expect(from).toHaveBeenCalledWith("user_pins");
    expect(upsert).toHaveBeenCalledWith(payload, { onConflict: "user_id" });
    expect(result).toEqual(payload);
  });

  it("upserts layouts when payload is provided", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    const payload = [{ user_id: "user-1", screen_id: "s1", x: 1, y: 2 }];

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
    const result = await da.upsertLayouts(payload);

    expect(from).toHaveBeenCalledWith("screen_layouts");
    expect(upsert).toHaveBeenCalledWith(payload, { onConflict: "user_id,screen_id" });
    expect(result).toEqual(payload);
  });

  it("retrieves a public screen by share token", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "pub-1", share_token: "tok", is_public: true }, error: null });
    const eqSecond = vi.fn().mockReturnValue({ single });
    const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
    const select = vi.fn().mockReturnValue({ eq: eqFirst });
    const from = vi.fn().mockReturnValue({ select });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from });
    const row = await da.getPublicScreenByToken("tok");

    expect(from).toHaveBeenCalledWith("screens");
    expect(eqFirst).toHaveBeenCalledWith("share_token", "tok");
    expect(eqSecond).toHaveBeenCalledWith("is_public", true);
    expect(row?.id).toBe("pub-1");
  });

  it("clones a screen when copying for another user", async () => {
    const da = new SupabaseDataAccess({ from: vi.fn() } as unknown as { from: () => unknown });
    const saveSpy = vi.spyOn(da, "saveScreen").mockResolvedValue({ id: "copy-1" } as unknown as any);

    await da.copyScreenForUser(
      {
        id: "s1",
        name: "Src",
        message_content: "msg",
        keyboard: [],
        is_public: false,
        share_token: null,
        user_id: "user-1",
      } as any,
      "user-2",
      { nameSuffix: " copy" }
    );

    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-2",
        name: "Src copy",
        message_content: "msg",
      })
    );
  });

  it("throws when user id is missing for save/update", async () => {
    const da = new SupabaseDataAccess({ from: vi.fn() } as unknown as { from: () => unknown });
    await expect(da.saveScreen({ name: "NoUser", message_content: "m", keyboard: [], is_public: false })).rejects.toThrow(/requires userId/);
    await expect(da.updateScreen({ screenId: "s1", update: { message_content: "m" } })).rejects.toThrow(/requires userId/);
  });

  it("invokes retry callback with action metadata", async () => {
    const onRetry = vi.fn();
    const single = vi.fn().mockResolvedValue({ data: { id: "s1" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });

    withRetry.mockImplementationOnce(async (op, opts: any) => {
      opts?.onRetry?.({ attempt: 1, delayMs: 50, reason: "429", error: new Error("rate"), requestId: "req-1" });
      return op();
    });

    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1", onRetry });
    await da.saveScreen({ name: "Retry", message_content: "m", keyboard: [], is_public: false });

    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ action: "insert", table: "screens", userId: "user-1", attempt: 1 }));
  });

  it("falls back when crypto.randomUUID throws", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => { throw new Error("fail"); } } as unknown as Crypto);

    try {
      const single = vi.fn().mockResolvedValue({ data: { id: "s1" }, error: null });
      const select = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select });
      const from = vi.fn().mockReturnValue({ insert });

      const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });
      await da.saveScreen({ name: "Fallback", message_content: "m", keyboard: [], is_public: false });

      expect(insert).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects when pin upsert fails", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: new Error("no pins") });
    const from = vi.fn().mockReturnValue({ upsert });
    const da = new SupabaseDataAccess({ from } as unknown as { from: typeof from }, { userId: "user-1" });

    await expect(da.upsertPins({ user_id: "user-1", pinned_ids: [] })).rejects.toThrow("no pins");
  });
});
