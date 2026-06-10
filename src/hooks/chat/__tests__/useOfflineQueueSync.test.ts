import { act, renderHook } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseDataAccess } from "@/lib/dataAccess";
import type { KeyboardRow, Screen } from "@/types/telegram";
import { useOfflineQueueSync } from "../useOfflineQueueSync";

const queuedSaveItem = vi.hoisted(() => ({
  id: "pending-save",
  kind: "save" as const,
  payload: {
    id: "local-screen",
    user_id: "user-1",
    name: "Queued screen",
    message_content: "message",
    keyboard: [
      {
        id: "row-1",
        buttons: [{ id: "btn-1", text: "Go", linked_screen_id: "local-screen" }],
      },
    ],
    is_public: false,
    share_token: null,
  },
  createdAt: 1,
  attempts: 0,
}));

const pendingQueueState = vi.hoisted(() => ({
  items: [] as unknown[],
}));

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/pendingQueue", () => ({
  clearPendingOps: vi.fn(() => {
    pendingQueueState.items = [];
  }),
  enqueueSaveOperation: vi.fn(),
  enqueueUpdateOperation: vi.fn(),
  readPendingOps: vi.fn(() => pendingQueueState.items),
  processPendingOps: vi.fn(async (options: { execute: (item: typeof queuedSaveItem) => Promise<void> }) => {
    const items = [...pendingQueueState.items] as typeof queuedSaveItem[];
    for (const item of items) {
      await options.execute(item);
    }
    pendingQueueState.items = [];
    return [];
  }),
}));

const user = { id: "user-1" } as User;

const makeKeyboard = (targetId: string): KeyboardRow[] => [
  {
    id: "row-1",
    buttons: [{ id: "btn-1", text: "Go", linked_screen_id: targetId }],
  },
];

const makeScreen = (id: string, keyboard: KeyboardRow[] = []): Screen => ({
  id,
  user_id: user.id,
  name: `Screen ${id}`,
  message_content: "message",
  keyboard,
  is_public: false,
  share_token: null,
});

describe("useOfflineQueueSync", () => {
  beforeEach(() => {
    localStorage.clear();
    pendingQueueState.items = [];
    Object.values(toast).forEach((fn) => fn.mockReset());
  });

  it("remaps temporary offline ids after a queued save is persisted", async () => {
    const localId = "local-screen";
    const serverId = "server-screen";
    let screens: Screen[] = [
      makeScreen(localId, makeKeyboard(localId)),
      makeScreen("other-screen", makeKeyboard(localId)),
    ];
    let currentScreenId: string | undefined = localId;
    let lastSavedSnapshot: { messageContent: string; keyboard: KeyboardRow[] } | null = null;
    let pendingQueueSize = 0;
    pendingQueueState.items = [queuedSaveItem];

    const dataAccess = {
      saveScreen: vi.fn().mockResolvedValue({
        ...makeScreen(serverId, makeKeyboard(localId)),
        name: "Queued screen",
      }),
      updateScreen: vi.fn(),
    } as unknown as SupabaseDataAccess;

    const onScreenIdReplaced = vi.fn((oldId: string, newId: string) => {
      currentScreenId = currentScreenId === oldId || !currentScreenId ? newId : currentScreenId;
    });
    const setScreens = vi.fn((value: Screen[] | ((prev: Screen[]) => Screen[])) => {
      screens = typeof value === "function" ? value(screens) : value;
    });
    const setCurrentScreenId = vi.fn((value: string | undefined | ((prev: string | undefined) => string | undefined)) => {
      currentScreenId = typeof value === "function" ? value(currentScreenId) : value;
    });
    const setLastSavedSnapshot = vi.fn((
      value:
        | { messageContent: string; keyboard: KeyboardRow[] }
        | null
        | ((prev: { messageContent: string; keyboard: KeyboardRow[] } | null) => { messageContent: string; keyboard: KeyboardRow[] } | null),
    ) => {
      lastSavedSnapshot = typeof value === "function" ? value(lastSavedSnapshot) : value;
    });
    const setPendingQueueSize = vi.fn((value: number) => {
      pendingQueueSize = value;
    });

    const { result } = renderHook(() =>
      useOfflineQueueSync({
        user,
        keyboard: makeKeyboard(localId),
        currentScreenId,
        serializeMessagePayload: () => "message",
        dataAccess,
        setScreens,
        setCurrentScreenId,
        setLastSavedSnapshot,
        setPendingQueueSize,
        onScreenIdReplaced,
      }),
    );

    await act(async () => {
      await result.current.replayPendingQueue();
    });

    expect(dataAccess.saveScreen).toHaveBeenCalledWith(expect.objectContaining({ id: localId }));
    expect(onScreenIdReplaced).toHaveBeenCalledWith(localId, serverId);
    expect(currentScreenId).toBe(serverId);
    expect(pendingQueueSize).toBe(0);
    expect(lastSavedSnapshot).toMatchObject({ messageContent: "message" });

    const savedScreen = screens.find((screen) => screen.id === serverId);
    const localScreen = screens.find((screen) => screen.id === localId);
    const otherScreen = screens.find((screen) => screen.id === "other-screen");
    expect(localScreen).toBeUndefined();
    expect(savedScreen?.keyboard[0]?.buttons[0]?.linked_screen_id).toBe(serverId);
    expect(otherScreen?.keyboard[0]?.buttons[0]?.linked_screen_id).toBe(serverId);
  });
});
