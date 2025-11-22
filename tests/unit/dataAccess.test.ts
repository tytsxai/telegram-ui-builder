import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseDataAccess } from "@/lib/dataAccess";
import type { PostgrestError } from "@supabase/supabase-js";

type MockClient = ReturnType<typeof buildMockClient>;

const buildMockClient = () => {
  const from = vi.fn();
  const select = vi.fn();
  const insert = vi.fn();
  const update = vi.fn();
  const deleteFn = vi.fn();
  const upsert = vi.fn();
  const single = vi.fn();
  const eq = vi.fn();
  const inFn = vi.fn();

  // chainable stubs
  from.mockReturnValue({ select, insert, update, delete: deleteFn, upsert });
  insert.mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
  upsert.mockReturnValue({});
  select.mockReturnValue({ eq, single, in: inFn });
  update.mockReturnValue({ eq, select, single });
  deleteFn.mockReturnValue({ eq, in: inFn });
  inFn.mockReturnValue({});

  return { from, select, insert, update, delete: deleteFn, upsert, single, eq, in: inFn };
};

describe("SupabaseDataAccess", () => {
  let mock: MockClient;
  let da: SupabaseDataAccess;

  beforeEach(() => {
    mock = buildMockClient();
    da = new SupabaseDataAccess(mock as unknown as { from: MockClient["from"] }, { userId: "user-1", retryAttempts: 1, backoffMs: 1 });
  });

  it("saves screen and returns data", async () => {
    mock.insert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "s1" }, error: null }) }) });

    const res = await da.saveScreen({ user_id: "user-1", name: "n", message_content: "m", keyboard: [], is_public: false });
    expect(res).toEqual({ id: "s1" });
    expect(mock.from).toHaveBeenCalledWith("screens");
  });

  it("updates screen and scopes to user", async () => {
    mock.select.mockReturnValue({ single: () => ({ data: { id: "s1" }, error: null }) });
    mock.update.mockReturnValue({ eq: vi.fn().mockReturnThis(), select: mock.select, single: vi.fn().mockReturnValue({ data: { id: "s1" }, error: null }) });

    const res = await da.updateScreen({ screenId: "s1", update: { message_content: "m", user_id: "user-1" } });
    expect(res).toEqual({ id: "s1" });
    expect(mock.update).toHaveBeenCalled();
  });

  it("upserts layouts in bulk", async () => {
    mock.upsert.mockResolvedValue({ error: null });
    const rows = await da.upsertLayouts([{ user_id: "user-1", screen_id: "s1", x: 1, y: 2 }]);
    expect(rows).toHaveLength(1);
    expect(mock.from).toHaveBeenCalledWith("screen_layouts");
  });

  it("logs and throws on error", async () => {
    const err: PostgrestError = { message: "bad", details: "", hint: "", code: "400" };
    mock.insert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockRejectedValue(err) }) });
    await expect(da.saveScreen({ user_id: "user-1", name: "n", message_content: "m", keyboard: [], is_public: false })).rejects.toBe(err);
  });
});
