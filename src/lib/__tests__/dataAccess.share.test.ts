import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseDataAccess } from "../dataAccess";

type ChainSpies = {
  from: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  firstEq: ReturnType<typeof vi.fn>;
  secondEq: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
};

const buildClient = (singleResult: any) => {
  const single = vi.fn().mockResolvedValue(singleResult);
  const select = vi.fn(() => ({ single }));
  const secondEq = vi.fn(() => ({ select }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const update = vi.fn(() => ({ eq: firstEq }));
  const from = vi.fn(() => ({ update }));

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataAccess>[0],
    spies: { from, update, firstEq, secondEq, select, single } satisfies ChainSpies,
  };
};

describe("SupabaseDataAccess share helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes share token and marks screen public", async () => {
    const { client, spies } = buildClient({
      data: { id: "s1", share_token: "token-1", is_public: true },
      error: null,
    });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.publishShareToken({ screenId: "s1", token: "token-1" });

    expect(spies.update).toHaveBeenCalledWith({ share_token: "token-1", is_public: true });
    expect(spies.firstEq).toHaveBeenCalledWith("id", "s1");
    expect(spies.secondEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(result?.share_token).toBe("token-1");
  });

  it("rotates share tokens and forces public visibility", async () => {
    const { client, spies } = buildClient({
      data: { id: "s1", share_token: "token-2", is_public: true },
      error: null,
    });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.rotateShareToken("s1", "token-2");

    expect(spies.from).toHaveBeenCalledWith("screens");
    expect(spies.update).toHaveBeenCalledWith({ share_token: "token-2", is_public: true });
    expect(spies.firstEq).toHaveBeenCalledWith("id", "s1");
    expect(spies.secondEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(spies.select).toHaveBeenCalled();
    expect(result?.share_token).toBe("token-2");
    expect(result?.is_public).toBe(true);
  });

  it("revokes share tokens and makes the screen private", async () => {
    const { client, spies } = buildClient({
      data: { id: "s1", share_token: null, is_public: false },
      error: null,
    });
    const dataAccess = new SupabaseDataAccess(client, { userId: "user-1" });

    const result = await dataAccess.revokeShareToken("s1");

    expect(spies.from).toHaveBeenCalledWith("screens");
    expect(spies.update).toHaveBeenCalledWith({ share_token: null, is_public: false });
    expect(spies.firstEq).toHaveBeenCalledWith("id", "s1");
    expect(spies.secondEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(spies.select).toHaveBeenCalled();
    expect(result?.is_public).toBe(false);
    expect(result?.share_token).toBeNull();
  });

  it("throws when rotating or revoking without a user id", async () => {
    const { client } = buildClient({ data: null, error: null });
    const dataAccess = new SupabaseDataAccess(client);
    await expect(dataAccess.rotateShareToken("s1", "tok")).rejects.toThrow(/requires userId/);
    await expect(dataAccess.revokeShareToken("s1")).rejects.toThrow(/requires userId/);
  });
});
