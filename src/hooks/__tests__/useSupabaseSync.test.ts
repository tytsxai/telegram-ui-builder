import { renderHook, act } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
});
