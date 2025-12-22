import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let pendingQueueSize = 0;
const sharedPendingItem = { id: "pending-1" };
const readPendingOpsMock = vi.fn(() => [sharedPendingItem]);
const loadScreensMock = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/chat/useChatState", () => ({
  useChatState: () => ({
    messageContent: "Hello",
    setMessageContent: vi.fn(),
    keyboard: [],
    setKeyboard: vi.fn(),
    parseMode: "HTML",
    setParseMode: vi.fn(),
    messageType: "text",
    setMessageType: vi.fn(),
    mediaUrl: "",
    setMediaUrl: vi.fn(),
    pushToHistory: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    editableJSON: "{}",
    setEditableJSON: vi.fn(),
    convertToTelegramFormat: vi.fn(() => ({})),
    serializeMessagePayload: vi.fn(() => "serialized"),
    loadMessagePayload: vi.fn(),
    loadTemplate: vi.fn(() => ({ ok: true })),
  }),
}));

vi.mock("@/hooks/chat/useSupabaseSync", () => ({
  useSupabaseSync: () => ({
    screens: [],
    setScreens: vi.fn(),
    pinnedIds: [],
    isLoading: false,
    loadScreens: loadScreensMock,
    saveScreen: vi.fn(),
    updateScreen: vi.fn(),
    deleteScreen: vi.fn(),
    deleteAllScreens: vi.fn(),
    handleTogglePin: vi.fn(),
    shareLoading: false,
    setShareLoading: vi.fn(),
    shareSyncStatus: { state: "idle" },
    setShareSyncStatus: vi.fn(),
    layoutSyncStatus: { state: "idle" },
    setLayoutSyncStatus: vi.fn(),
    pendingQueueSize,
    setPendingQueueSize: vi.fn(),
    logSyncEvent: vi.fn(),
    dataAccess: {
      publishShareToken: vi.fn(async () => ({})),
      rotateShareToken: vi.fn(async () => ({})),
      revokeShareToken: vi.fn(async () => ({})),
    },
    queueReplayCallbacks: {},
  }),
}));

vi.mock("@/hooks/chat/useKeyboardActions", () => ({
  useKeyboardActions: () => ({
    handleButtonTextChange: vi.fn(),
    handleButtonUpdate: vi.fn(),
    handleDeleteButton: vi.fn(),
    handleAddButton: vi.fn(),
    handleAddRow: vi.fn(),
    handleReorder: vi.fn(),
  }),
}));

vi.mock("@/hooks/chat/useScreenNavigation", () => ({
  useScreenNavigation: () => ({
    currentScreenId: undefined,
    setCurrentScreenId: vi.fn(),
    navigationHistory: [],
    entryScreenId: null,
    handleNavigateBack: vi.fn(),
    handleNavigateToScreen: vi.fn(),
    handleSetEntry: vi.fn(),
    handleJumpToEntry: vi.fn(),
  }),
  isEntrySet: () => false,
}));

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => false,
}));

vi.mock("@/hooks/useGlobalShortcuts", () => ({
  useGlobalShortcuts: vi.fn(),
}));

vi.mock("@/hooks/chat/useCodegen", () => ({
  useCodegen: () => ({
    codegenFramework: "react",
    setCodegenFramework: vi.fn(),
    codegenOutput: "",
    handleCopyCodegen: vi.fn(),
  }),
}));

vi.mock("@/hooks/chat/useAuthUser", () => ({
  useAuthUser: () => ({ user: { id: "user-1" }, setUser: vi.fn() }),
}));

vi.mock("@/hooks/chat/useOfflineQueueSync", () => ({
  useOfflineQueueSync: () => ({
    pendingOpsNotice: null,
    pendingQueueVersion: 0,
    retryingQueue: false,
    refreshPendingQueueSize: vi.fn(),
    queueSaveOperation: vi.fn(),
    queueUpdateOperation: vi.fn(),
    replayPendingQueue: vi.fn(),
    clearPendingQueue: vi.fn(),
  }),
}));

vi.mock("@/lib/pendingQueue", () => ({
  readPendingOps: (...args: unknown[]) => readPendingOpsMock(...args),
}));

import { useBuilderStore } from "../useBuilderStore";

describe("useBuilderStore performance selectors", () => {
  beforeEach(() => {
    pendingQueueSize = 0;
    readPendingOpsMock.mockClear();
    loadScreensMock.mockClear();
  });

  it("does not recompute pending items on unrelated state updates", () => {
    const { result } = renderHook(() => useBuilderStore());
    const initialPendingItems = result.current.bottomPanelProps.pendingItems;

    expect(readPendingOpsMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.dialogState.importDialog.setOpen(true);
    });

    expect(readPendingOpsMock).toHaveBeenCalledTimes(1);
    expect(result.current.bottomPanelProps.pendingItems).toBe(initialPendingItems);
  });

  it("keeps pending items stable with shallow equality on size changes", () => {
    const { result, rerender } = renderHook(() => useBuilderStore());
    const initialPendingItems = result.current.bottomPanelProps.pendingItems;

    pendingQueueSize = 1;
    rerender();

    expect(readPendingOpsMock).toHaveBeenCalledTimes(2);
    expect(result.current.bottomPanelProps.pendingItems).toBe(initialPendingItems);
  });
});
