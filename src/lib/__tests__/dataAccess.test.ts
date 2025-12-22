import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseDataAccess } from "../dataAccess";
import * as supabaseRetry from "../supabaseRetry";

type UpsertSpies = {
  from: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};

type UpdateSpies = {
  from: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

type DeleteSpies = {
  from: ReturnType<typeof vi.fn>;
  deleteFn: ReturnType<typeof vi.fn>;
};

type InsertSpies = {
  from: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  single?: ReturnType<typeof vi.fn>;
};

type UpdateChainSpies = {
  from: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  firstEq: ReturnType<typeof vi.fn>;
  secondEq: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
};

type SelectSpies = {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single?: ReturnType<typeof vi.fn>;
  inFn?: ReturnType<typeof vi.fn>;
};

const buildUpsertClient = () => {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ upsert }));

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { from, upsert } satisfies UpsertSpies,
  };
};

const buildUpdateClient = () => {
  const update = vi.fn();
  const from = vi.fn(() => ({ update }));

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { from, update } satisfies UpdateSpies,
  };
};

const buildDeleteClient = () => {
  const deleteFn = vi.fn();
  const from = vi.fn(() => ({ delete: deleteFn }));

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { from, deleteFn } satisfies DeleteSpies,
  };
};

const buildInsertClient = (singleResult: { data: unknown; error: unknown }) => {
  const single = vi.fn().mockResolvedValue(singleResult);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { from, insert, select, single } satisfies InsertSpies,
  };
};

const buildInsertManyClient = (selectResult: { data: unknown; error: unknown }) => {
  const select = vi.fn().mockResolvedValue(selectResult);
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { from, insert, select } satisfies InsertSpies,
  };
};

const buildUpdateChainClient = (singleResult: { data: unknown; error: unknown }) => {
  const single = vi.fn().mockResolvedValue(singleResult);
  const select = vi.fn(() => ({ single }));
  const secondEq = vi.fn(() => ({ select }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const update = vi.fn(() => ({ eq: firstEq }));
  const from = vi.fn(() => ({ update }));

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { from, update, firstEq, secondEq, select, single } satisfies UpdateChainSpies,
  };
};

const buildSelectSingleClient = (singleResult: { data: unknown; error: unknown }) => {
  const single = vi.fn().mockResolvedValue(singleResult);
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { from, select, eq, single } satisfies SelectSpies,
  };
};

const buildSelectInClient = (selectResult: { data: unknown; error: unknown }) => {
  const inFn = vi.fn().mockResolvedValue(selectResult);
  const eq = vi.fn(() => ({ in: inFn }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { from, select, eq, inFn } satisfies SelectSpies,
  };
};

const buildDeleteLayoutsClient = () => {
  const query = {
    in: vi.fn().mockReturnThis(),
    then: (resolve: (value: { error: null }) => void, reject?: (reason: unknown) => void) =>
      Promise.resolve({ error: null }).then(resolve, reject),
  };
  const eq = vi.fn(() => query);
  const deleteFn = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: deleteFn }));

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { from, deleteFn, eq, query },
  };
};

const buildRpcClient = (rpcResult: { data: unknown; error: unknown }) => {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return {
    client: { rpc } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { rpc },
  };
};

const buildAbortableRpcClient = (rpcResult: { data: unknown; error: unknown }) => {
  const abortSignal = vi.fn().mockResolvedValue(rpcResult);
  const rpc = vi.fn(() => ({ abortSignal }));
  return {
    client: { rpc } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { rpc, abortSignal },
  };
};

describe("SupabaseDataAccess ownership checks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when upserting pins without userId", async () => {
    const { client, spies } = buildUpsertClient();
    const dataAccess = new SupabaseDataAccess(client);

    await expect(dataAccess.upsertPins({ pinned_ids: ["s1"] } as never)).rejects.toThrow(/requires userId/);
    expect(spies.upsert).not.toHaveBeenCalled();
  });

  it("injects userId into pin upserts", async () => {
    const { client, spies } = buildUpsertClient();
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    await dataAccess.upsertPins({ pinned_ids: ["s1"] } as never);

    expect(spies.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1" }),
      { onConflict: "user_id" },
    );
  });

  it("throws when upserting layouts without userId", async () => {
    const { client, spies } = buildUpsertClient();
    const dataAccess = new SupabaseDataAccess(client);

    await expect(
      dataAccess.upsertLayouts([{ screen_id: "s1", x: 0, y: 0 }] as never),
    ).rejects.toThrow(/requires userId/);
    expect(spies.upsert).not.toHaveBeenCalled();
  });

  it("rejects updates without userId", async () => {
    const { client, spies } = buildUpdateClient();
    const dataAccess = new SupabaseDataAccess(client);

    await expect(dataAccess.updateScreen({ screenId: "s1", update: {} } as never)).rejects.toThrow(
      /requires userId/,
    );
    expect(spies.update).not.toHaveBeenCalled();
  });

  it("rejects deletes without userId", async () => {
    const { client, spies } = buildDeleteClient();
    const dataAccess = new SupabaseDataAccess(client);

    await expect(dataAccess.deleteScreens({ ids: ["s1"] })).rejects.toThrow(/requires userId/);
    expect(spies.deleteFn).not.toHaveBeenCalled();
  });

  it("saves screens with user ownership", async () => {
    const { client, spies } = buildInsertClient({ data: { id: "s1" }, error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.saveScreen({ name: "Screen 1" } as never);

    expect(spies.insert).toHaveBeenCalledWith([expect.objectContaining({ user_id: "user-1" })]);
    expect(result).toEqual({ id: "s1" });
  });

  it("rejects saves when userId is null", async () => {
    const { client, spies } = buildInsertClient({ data: { id: "s1" }, error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: null });

    await expect(dataAccess.saveScreen({ name: "Screen 1" } as never)).rejects.toThrow(/requires userId/);
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("rejects share token updates when userId is undefined", async () => {
    const { client, spies } = buildUpdateChainClient({ data: { id: "s1" }, error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: undefined });

    await expect(dataAccess.publishShareToken({ screenId: "s1", token: "tok" })).rejects.toThrow(/requires userId/);
    expect(spies.update).not.toHaveBeenCalled();
  });

  it("inserts multiple screens for the active user", async () => {
    const { client, spies } = buildInsertManyClient({ data: [{ id: "s1" }, { id: "s2" }], error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.insertScreens([{ name: "One" }, { name: "Two" }] as never);

    expect(spies.insert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: "user-1" }),
      expect.objectContaining({ user_id: "user-1" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("short-circuits empty screen inserts", async () => {
    const { client, spies } = buildInsertManyClient({ data: [], error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.insertScreens([]);

    expect(result).toEqual([]);
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("updates screens scoped to the active user", async () => {
    const { client, spies } = buildUpdateChainClient({ data: { id: "s1" }, error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.updateScreen({ screenId: "s1", update: { name: "Updated" } } as never);

    expect(spies.update).toHaveBeenCalledWith({ name: "Updated" });
    expect(spies.firstEq).toHaveBeenCalledWith("id", "s1");
    expect(spies.secondEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual({ id: "s1" });
  });

  it("deletes screens scoped to the active user", async () => {
    const inFn = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn(() => ({ in: inFn }));
    const deleteFn = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ delete: deleteFn }));
    const client = { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0];
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.deleteScreens({ ids: ["s1", "s2"] });

    expect(deleteFn).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(inFn).toHaveBeenCalledWith("id", ["s1", "s2"]);
    expect(result).toEqual(["s1", "s2"]);
  });

  it("fetches pinned ids and ignores empty rows", async () => {
    const { client } = buildSelectSingleClient({ data: { pinned_ids: ["s1"] }, error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.fetchPins();

    expect(result).toEqual(["s1"]);
  });

  it("returns empty pins on not-found responses", async () => {
    const { client } = buildSelectSingleClient({ data: null, error: { code: "PGRST116" } });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.fetchPins();

    expect(result).toEqual([]);
  });

  it("upserts layouts with normalized userId", async () => {
    const { client, spies } = buildUpsertClient();
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.upsertLayouts([{ screen_id: "s1", x: 1, y: 2 }] as never);

    expect(spies.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ screen_id: "s1", user_id: "user-1" })],
      { onConflict: "user_id,screen_id" },
    );
    expect(result).toHaveLength(1);
  });

  it("short-circuits empty layout upserts", async () => {
    const { client, spies } = buildUpsertClient();
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.upsertLayouts([]);

    expect(result).toEqual([]);
    expect(spies.upsert).not.toHaveBeenCalled();
  });

  it("deletes layouts with optional ids", async () => {
    const { client, spies } = buildDeleteLayoutsClient();
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.deleteLayouts({ ids: ["s1"] });

    expect(spies.deleteFn).toHaveBeenCalled();
    expect(spies.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(spies.query.in).toHaveBeenCalledWith("screen_id", ["s1"]);
    expect(result).toEqual(["s1"]);
  });

  it("deletes layouts without filtering by ids", async () => {
    const { client, spies } = buildDeleteLayoutsClient();
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.deleteLayouts({});

    expect(spies.query.in).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("fetches layouts for a list of screens", async () => {
    const { client, spies } = buildSelectInClient({
      data: [{ screen_id: "s1", x: 0, y: 0 }],
      error: null,
    });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.fetchLayouts({ ids: ["s1"] });

    expect(spies.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(spies.inFn).toHaveBeenCalledWith("screen_id", ["s1"]);
    expect(result).toHaveLength(1);
  });

  it("returns empty layouts when no ids are provided", async () => {
    const { client } = buildSelectInClient({ data: [], error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.fetchLayouts({ ids: [] });

    expect(result).toEqual([]);
  });

  it("fetches public screens by token and normalizes arrays", async () => {
    const { client, spies } = buildRpcClient({ data: [{ id: "s1" }], error: null });
    const dataAccess = new SupabaseDataAccess(client);

    const result = await dataAccess.getPublicScreenByToken("token-1");

    expect(spies.rpc).toHaveBeenCalledWith("get_public_screen_by_token", { token: "token-1" });
    expect(result).toEqual({ id: "s1" });
  });

  it("uses abort signals when fetching public screens", async () => {
    const { client, spies } = buildAbortableRpcClient({ data: { id: "s1" }, error: null });
    const dataAccess = new SupabaseDataAccess(client);
    const controller = new AbortController();

    const result = await dataAccess.getPublicScreenByToken("token-2", { signal: controller.signal });

    expect(spies.abortSignal).toHaveBeenCalledWith(controller.signal);
    expect(result).toEqual({ id: "s1" });
  });

  it("copies screens with a localized suffix", async () => {
    const { client, spies } = buildInsertClient({ data: { id: "s2" }, error: null });
    const dataAccess = new SupabaseDataAccess(client);

    const result = await dataAccess.copyScreenForUser(
      { name: "源", message_content: "msg", keyboard: null, is_public: false, share_token: null } as never,
      "user-1",
      { nameSuffix: " Copy" },
    );

    expect(spies.insert).toHaveBeenCalledWith([expect.objectContaining({ user_id: "user-1", name: "源 Copy" })]);
    expect(result).toEqual({ id: "s2" });
  });

  it("publishes share tokens for the active user", async () => {
    const { client, spies } = buildUpdateChainClient({ data: { id: "s1" }, error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.publishShareToken({ screenId: "s1", token: "tok" });

    expect(spies.update).toHaveBeenCalledWith({ share_token: "tok", is_public: true });
    expect(result).toEqual({ id: "s1" });
  });

  it("rotates share tokens for the active user", async () => {
    const { client, spies } = buildUpdateChainClient({ data: { id: "s1" }, error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1", onRetry: vi.fn() });

    const result = await dataAccess.rotateShareToken("s1", "tok");

    expect(spies.update).toHaveBeenCalledWith({ share_token: "tok", is_public: true });
    expect(result).toEqual({ id: "s1" });
  });

  it("revokes share tokens for the active user", async () => {
    const { client, spies } = buildUpdateChainClient({ data: { id: "s1" }, error: null });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.revokeShareToken("s1");

    expect(spies.update).toHaveBeenCalledWith({ share_token: null, is_public: false });
    expect(result).toEqual({ id: "s1" });
  });

  it("retries on retryable errors and forwards retry metadata", async () => {
    const onRetry = vi.fn();
    const single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { status: 500 } })
      .mockResolvedValueOnce({ data: { id: "s1" }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const client = { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0];
    const dataAccess = new SupabaseDataAccess(client, {
      userId: "user-1",
      retryAttempts: 2,
      backoffMs: 0,
      jitterRatio: 0,
      onRetry,
    });

    const result = await dataAccess.saveScreen({ name: "Retry" } as never);

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ action: "insert", table: "screens", userId: "user-1" }),
    );
    expect(result).toEqual({ id: "s1" });
  });

  it("logs and rethrows terminal errors", async () => {
    const logSpy = vi.spyOn(supabaseRetry, "logSupabaseError").mockImplementation(() => undefined);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "req-1") });

    const single = vi.fn().mockResolvedValue({ data: null, error: { status: 400 } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const client = { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0];
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    await expect(dataAccess.saveScreen({ name: "Fail" } as never)).rejects.toBeTruthy();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "insert", table: "screens", userId: "user-1", requestId: "req-1" }),
    );

    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("falls back to generated request ids when crypto is missing", async () => {
    const logSpy = vi.spyOn(supabaseRetry, "logSupabaseError").mockImplementation(() => undefined);
    vi.stubGlobal("crypto", undefined);

    const single = vi.fn().mockResolvedValue({ data: null, error: { status: 400 } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const client = { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0];
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    await expect(dataAccess.saveScreen({ name: "Fail" } as never)).rejects.toBeTruthy();

    const requestId = (logSpy.mock.calls[0]?.[0] as { requestId?: string } | undefined)?.requestId;
    expect(requestId).toMatch(/^req_/);

    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("handles crypto.randomUUID errors gracefully", async () => {
    const logSpy = vi.spyOn(supabaseRetry, "logSupabaseError").mockImplementation(() => undefined);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => {
      throw new Error("boom");
    }) });

    const single = vi.fn().mockResolvedValue({ data: null, error: { status: 400 } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const client = { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0];
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    await expect(dataAccess.saveScreen({ name: "Fail" } as never)).rejects.toBeTruthy();

    const requestId = (logSpy.mock.calls[0]?.[0] as { requestId?: string } | undefined)?.requestId;
    expect(requestId).toMatch(/^req_/);

    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
