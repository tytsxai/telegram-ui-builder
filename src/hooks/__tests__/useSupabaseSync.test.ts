import { renderHook, act } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { publishSyncEvent } from "@/lib/syncTelemetry";
import { useSupabaseSync } from "../chat/useSupabaseSync";
import type { Screen } from "@/types/telegram";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

const supabaseFrom = vi.hoisted(() => vi.fn());

const mockDataAccess = vi.hoisted(() => ({
  saveScreen: vi.fn(),
  updateScreen: vi.fn(),
  deleteScreens: vi.fn(),
  upsertPins: vi.fn(),
  publishShareToken: vi.fn(),
  rotateShareToken: vi.fn(),
  revokeShareToken: vi.fn(),
}));

const baseScreen: Screen = {
  id: "screen-1",
  user_id: "user-1",
  name: "Main",
  message_content: "hello",
  keyboard: [],
};

vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/syncTelemetry", () => ({ publishSyncEvent: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: supabaseFrom },
}));
vi.mock("@/lib/dataAccess", () => {
  const SupabaseDataAccess = vi.fn(function MockSupabaseDataAccess() {
    return mockDataAccess;
  });
  return { SupabaseDataAccess };
});

const mockUser = { id: "user-1" } as User;

describe("useSupabaseSync", () => {
  beforeEach(() => {
    Object.values(mockDataAccess).forEach((fn) => fn.mockReset());
    vi.mocked(publishSyncEvent).mockReset();

    const screensChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [baseScreen], error: null }),
        }),
      }),
    };

    const pinsChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { pinned_ids: ["screen-1"] }, error: null }),
        }),
      }),
    };

    supabaseFrom.mockReset();
    supabaseFrom.mockImplementation((table) => {
      if (table === "screens") return screensChain;
      if (table === "user_pins") return pinsChain;
      return { select: vi.fn() };
    });

    Object.values(toast).forEach((fn) => fn.mockReset());
  });

  it("loads screens and pinned ids for the current user", async () => {
    const { result } = renderHook(() => useSupabaseSync(mockUser));

    await act(async () => {
      await result.current.loadScreens();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.screens[0]).toMatchObject({ id: "screen-1", name: "Main" });
    expect(result.current.pinnedIds).toEqual(["screen-1"]);
    expect(result.current.shareSyncStatus.state).toBe("success");
  });

  it("logs pin fetch errors but still resolves load", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseFrom.mockImplementation((table) => {
      if (table === "screens") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [baseScreen], error: null }),
            }),
          }),
        };
      }
      if (table === "user_pins") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { code: "500", message: "boom" } }),
            }),
          }),
        };
      }
      return { select: vi.fn() };
    });

    const { result } = renderHook(() => useSupabaseSync(mockUser));
    await act(async () => {
      await result.current.loadScreens();
    });

    expect(consoleSpy).toHaveBeenCalledWith("Error loading pins:", expect.anything());
    consoleSpy.mockRestore();
  });

  it("sets share sync status to error when loading fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    supabaseFrom.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: new Error("load failed") }),
        }),
      }),
    }));

    const { result } = renderHook(() => useSupabaseSync(mockUser));

    await act(async () => {
      await result.current.loadScreens();
    });

    expect(result.current.shareSyncStatus.state).toBe("error");
    expect(toast.error).toHaveBeenCalledWith("Failed to load screens");
    consoleSpy.mockRestore();
  });

  it("saves a screen and appends it to state", async () => {
    const saved = { ...baseScreen, id: "screen-2", name: "Saved" };
    mockDataAccess.saveScreen.mockResolvedValue(saved);

    const { result } = renderHook(() => useSupabaseSync(mockUser));

    await act(async () => {
      await result.current.saveScreen({
        user_id: mockUser.id,
        name: "Saved",
        message_content: "content",
        keyboard: [],
        is_public: false,
      });
    });

    expect(mockDataAccess.saveScreen).toHaveBeenCalled();
    expect(result.current.screens).toEqual(expect.arrayContaining([saved as Screen]));
    expect(result.current.shareLoading).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Screen saved");
    expect(result.current.shareSyncStatus.state).toBe("success");
  });

  it("updates an existing screen in state", async () => {
    const updated = { ...baseScreen, id: "screen-1", message_content: "updated" };
    mockDataAccess.updateScreen.mockResolvedValue(updated);

    const { result } = renderHook(() => useSupabaseSync(mockUser));

    act(() => {
      result.current.setScreens([baseScreen]);
    });

    await act(async () => {
      await result.current.updateScreen({
        screenId: "screen-1",
        update: { message_content: "updated", keyboard: [], updated_at: new Date().toISOString() },
      });
    });

    expect(mockDataAccess.updateScreen).toHaveBeenCalledWith({
      screenId: "screen-1",
      update: expect.objectContaining({ message_content: "updated" }),
    });
    expect(result.current.screens[0].message_content).toBe("updated");
  });

  it("surfaces errors when updating screens fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDataAccess.updateScreen.mockRejectedValue(new Error("update boom"));

    const { result } = renderHook(() => useSupabaseSync(mockUser));

    await expect(
      act(async () => {
        await result.current.updateScreen({
          screenId: "screen-1",
          update: { message_content: "fail", keyboard: [] },
        });
      })
    ).rejects.toThrow("update boom");

    expect(toast.error).toHaveBeenCalledWith("Failed to update screen");
    consoleSpy.mockRestore();
  });

  it("sets share status to error when saving fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDataAccess.saveScreen.mockRejectedValue(new Error("fail to save"));

    const { result } = renderHook(() => useSupabaseSync(mockUser));

    await act(async () => {
      await expect(
        result.current.saveScreen({
          user_id: mockUser.id,
          name: "Bad",
          message_content: "content",
          keyboard: [],
          is_public: false,
        })
      ).rejects.toThrow("fail to save");
    });

    expect(result.current.shareSyncStatus.state).toBe("error");
    expect(result.current.shareLoading).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Failed to save screen");
    consoleSpy.mockRestore();
  });

  it("deletes a screen and updates local state", async () => {
    const { result } = renderHook(() => useSupabaseSync(mockUser));

    act(() => {
      result.current.setScreens([baseScreen]);
    });

    await act(async () => {
      await result.current.deleteScreen("screen-1");
    });

    expect(mockDataAccess.deleteScreens).toHaveBeenCalledWith({ ids: ["screen-1"], userId: mockUser.id });
    expect(result.current.screens).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith("Screen deleted");
  });

  it("handles bulk delete failures gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDataAccess.deleteScreens.mockRejectedValue(new Error("bulk failed"));

    const { result } = renderHook(() => useSupabaseSync(mockUser));
    act(() => {
      result.current.setScreens([baseScreen]);
    });

    await act(async () => {
      await result.current.deleteAllScreens();
    });

    expect(mockDataAccess.deleteScreens).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Failed to delete all screens");
    expect(result.current.screens).toHaveLength(1);
    consoleSpy.mockRestore();
  });

  it("logs error when deleting a single screen fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDataAccess.deleteScreens.mockRejectedValue(new Error("delete failed"));

    const { result } = renderHook(() => useSupabaseSync(mockUser));
    act(() => {
      result.current.setScreens([baseScreen]);
    });

    await act(async () => {
      await result.current.deleteScreen("screen-1");
    });

    expect(toast.error).toHaveBeenCalledWith("Failed to delete screen");
    expect(result.current.screens).toHaveLength(1);
    consoleSpy.mockRestore();
  });

  it("deletes all screens and clears state", async () => {
    const { result } = renderHook(() => useSupabaseSync(mockUser));
    act(() => {
      result.current.setScreens([baseScreen]);
    });

    await act(async () => {
      await result.current.deleteAllScreens();
    });

    expect(mockDataAccess.deleteScreens).toHaveBeenCalledWith({ ids: ["screen-1"], userId: mockUser.id });
    expect(result.current.screens).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith("All screens deleted");
  });

  it("reverts pinned ids when upsert fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDataAccess.upsertPins.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useSupabaseSync(mockUser));

    act(() => {
      result.current.setPinnedIds([]);
    });

    await act(async () => {
      await result.current.handleTogglePin("screen-99");
    });

    expect(result.current.pinnedIds).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("Failed to update pins");

    consoleSpy.mockRestore();
  });

  it("toggles pins and persists when upsert succeeds", async () => {
    const { result } = renderHook(() => useSupabaseSync(mockUser));

    await act(async () => {
      await result.current.loadScreens();
    });

    await act(async () => {
      result.current.setPinnedIds(["screen-1"]);
    });

    expect(result.current.pinnedIds).toEqual(["screen-1"]);

    await act(async () => {
      await result.current.handleTogglePin("screen-2");
    });

    expect(result.current.pinnedIds).toEqual(["screen-1", "screen-2"]);
    expect(mockDataAccess.upsertPins).toHaveBeenCalledWith({ user_id: mockUser.id, pinned_ids: ["screen-1", "screen-2"] });
  });

  it("removes pinned ids when toggled off", async () => {
    const { result } = renderHook(() => useSupabaseSync(mockUser));

    act(() => {
      result.current.setPinnedIds(["screen-1"]);
    });

    await act(async () => {
      await result.current.handleTogglePin("screen-1");
    });

    expect(result.current.pinnedIds).toEqual([]);
    expect(mockDataAccess.upsertPins).toHaveBeenCalledWith({ user_id: mockUser.id, pinned_ids: [] });
  });

  it("emits layout sync events with telemetry payload", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { result } = renderHook(() => useSupabaseSync(mockUser));

    act(() => {
      result.current.setPendingQueueSize(2);
    });

    act(() => {
      result.current.logSyncEvent("layout", { state: "pending", requestId: "req-123", message: "layout sync" });
    });

    expect(publishSyncEvent).toHaveBeenCalledWith({
      scope: "layout",
      status: expect.objectContaining({ state: "pending", requestId: "req-123", message: "layout sync" }),
    });

    consoleSpy.mockRestore();
  });

  it("exposes queue replay callbacks that publish telemetry", () => {
    const { result } = renderHook(() => useSupabaseSync(mockUser));
    const failure = { requestId: "req-queue", message: "network fail", at: Date.now() };
    const pendingItem = {
      id: "pending-1",
      kind: "save" as const,
      attempts: 1,
      lastAttemptAt: failure.at,
      lastError: failure.message,
      failures: [failure],
    };

    act(() => {
      result.current.queueReplayCallbacks.onItemFailure?.(pendingItem as any, new Error("network"), { attempt: 2, delayMs: 50 });
    });

    expect(publishSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "queue",
        status: expect.objectContaining({
          state: "error",
          message: expect.stringContaining("retrying in 50ms"),
        }),
      }),
    );

    act(() => {
      result.current.queueReplayCallbacks.onSuccess?.(pendingItem as any);
    });

    expect(publishSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "queue",
        status: expect.objectContaining({ state: "success" }),
      }),
    );
  });

  it("publishes queue telemetry when no previous failures exist", () => {
    const { result } = renderHook(() => useSupabaseSync(mockUser));
    const pendingItem = {
      id: "pending-2",
      kind: "save" as const,
      attempts: 0,
      lastAttemptAt: 123,
      failures: [],
    };

    act(() => {
      result.current.queueReplayCallbacks.onItemFailure?.(pendingItem as any, "offline", { attempt: 1 });
    });

    expect(publishSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "queue",
        status: expect.objectContaining({
          state: "error",
          message: expect.stringContaining("pending-2 replay failed (attempt 1): offline"),
        }),
      }),
    );

    act(() => {
      result.current.queueReplayCallbacks.onSuccess?.(pendingItem as any);
    });

    expect(publishSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "queue",
        status: expect.objectContaining({
          state: "success",
          requestId: expect.any(String),
        }),
      }),
    );
  });

  it("publishes queue retries without delay metadata", () => {
    const { result } = renderHook(() => useSupabaseSync(mockUser));
    act(() => {
      result.current.queueReplayCallbacks.onItemFailure?.(
        {
          id: "pending-2",
          kind: "update",
          attempts: 0,
          lastAttemptAt: Date.now(),
          failures: [],
        } as any,
        new Error("transient"),
        { attempt: 1 }
      );
    });

    expect(publishSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "queue",
        status: expect.objectContaining({
          state: "error",
          message: expect.stringContaining("attempt 1"),
        }),
      }),
    );
  });

  it("assigns request ids for queue success without prior failures", () => {
    const { result } = renderHook(() => useSupabaseSync(mockUser));
    act(() => {
      result.current.queueReplayCallbacks.onSuccess?.(
        {
          id: "pending-3",
          kind: "save",
          failures: [],
        } as any,
      );
    });

    expect(publishSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "queue",
        status: expect.objectContaining({ requestId: expect.any(String), state: "success" }),
      }),
    );
  });

  it("falls back to default messages when errors are non-Error values", async () => {
    supabaseFrom.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: "boom" }),
        }),
      }),
    }));

    const { result } = renderHook(() => useSupabaseSync(mockUser));
    await act(async () => {
      await result.current.loadScreens();
    });
    expect(result.current.shareSyncStatus.message).toBe("加载失败");

    mockDataAccess.saveScreen.mockRejectedValueOnce("bad save");
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.saveScreen({
          user_id: mockUser.id,
          name: "bad",
          message_content: "m",
          keyboard: [],
          is_public: false,
        });
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toEqual("bad save");
    expect(result.current.shareSyncStatus.message).toBe("保存失败");
  });

  it("handles empty pin rows without crashing", async () => {
    const screensChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [baseScreen], error: null }),
        }),
      }),
    };

    const pinsChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    };

    supabaseFrom.mockImplementation((table) => {
      if (table === "screens") return screensChain;
      if (table === "user_pins") return pinsChain;
      return { select: vi.fn() };
    });

    const { result } = renderHook(() => useSupabaseSync(mockUser));

    await act(async () => {
      await result.current.loadScreens();
    });

    expect(result.current.pinnedIds).toEqual([]);
  });

  it("no-ops when user is null", async () => {
    const { result } = renderHook(() => useSupabaseSync(null));

    await act(async () => {
      await result.current.loadScreens();
    });

    await act(async () => {
      const saved = await result.current.saveScreen({
        user_id: "anon",
        name: "Anon",
        message_content: "content",
        keyboard: [],
        is_public: false,
      });
      expect(saved).toBeNull();
    });

    await act(async () => {
      await result.current.updateScreen({ screenId: "x", update: { message_content: "m", keyboard: [] } });
      await result.current.deleteScreen("x");
      await result.current.deleteAllScreens();
    });

    act(() => {
      result.current.handleTogglePin("x");
    });

    expect(mockDataAccess.saveScreen).not.toHaveBeenCalled();
    expect(mockDataAccess.deleteScreens).not.toHaveBeenCalled();
  });
});
