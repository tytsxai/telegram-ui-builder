import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let pendingQueueSize = 0;
const sharedPendingItem = { id: "pending-1" };
const readPendingOpsMock = vi.fn(() => [sharedPendingItem]);
const loadScreensMock = vi.fn();
const updateScreenMock = vi.fn();
const queueUpdateOperationMock = vi.fn();
const setScreensMock = vi.fn();
const setKeyboardMock = vi.fn();
const pushToHistoryMock = vi.fn();
const serializeMessagePayloadMock = vi.fn(() => "serialized");
const setParseModeMock = vi.fn();
const setMessageTypeMock = vi.fn();
const setMediaUrlMock = vi.fn();
const loadMessagePayloadMock = vi.fn();
const handleNavigateToScreenMock = vi.fn();
let parseModeState: "HTML" | "MarkdownV2" = "HTML";
let messageTypeState: "text" | "photo" | "video" = "text";
let mediaUrlState = "";
let currentScreenId = undefined as string | undefined;
let screensState: Array<{
  id: string;
  name: string;
  message_content: string;
  keyboard: Array<{ id: string; buttons: Array<{ id: string; text: string; linked_screen_id?: string }> }>;
  parse_mode?: "HTML" | "MarkdownV2";
  message_type?: "text" | "photo" | "video";
  media_url?: string | null;
}> = [];

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
    setKeyboard: setKeyboardMock,
    parseMode: parseModeState,
    setParseMode: setParseModeMock,
    messageType: messageTypeState,
    setMessageType: setMessageTypeMock,
    mediaUrl: mediaUrlState,
    setMediaUrl: setMediaUrlMock,
    pushToHistory: pushToHistoryMock,
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    editableJSON: "{}",
    setEditableJSON: vi.fn(),
    convertToTelegramFormat: vi.fn(() => ({})),
    serializeMessagePayload: serializeMessagePayloadMock,
    loadMessagePayload: loadMessagePayloadMock,
    loadTemplate: vi.fn(() => ({ ok: true })),
  }),
}));

vi.mock("@/hooks/chat/useSupabaseSync", () => ({
  useSupabaseSync: () => ({
    screens: screensState,
    setScreens: setScreensMock,
    pinnedIds: [],
    isLoading: false,
    loadScreens: loadScreensMock,
    saveScreen: vi.fn(),
    updateScreen: updateScreenMock,
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
    currentScreenId,
    setCurrentScreenId: vi.fn(),
    navigationHistory: [],
    entryScreenId: null,
    handleNavigateBack: vi.fn(),
    handleNavigateToScreen: handleNavigateToScreenMock,
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
    queueUpdateOperation: queueUpdateOperationMock,
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
    parseModeState = "HTML";
    messageTypeState = "text";
    mediaUrlState = "";
    currentScreenId = undefined;
    screensState = [];
    readPendingOpsMock.mockClear();
    loadScreensMock.mockClear();
    updateScreenMock.mockReset();
    queueUpdateOperationMock.mockReset();
    setKeyboardMock.mockReset();
    pushToHistoryMock.mockReset();
    setParseModeMock.mockReset();
    setMessageTypeMock.mockReset();
    setMediaUrlMock.mockReset();
    loadMessagePayloadMock.mockReset();
    handleNavigateToScreenMock.mockReset();
    setScreensMock.mockImplementation((value) => {
      screensState = typeof value === "function" ? value(screensState) : value;
    });
    serializeMessagePayloadMock.mockImplementation(() => "serialized");
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

  it("persists parse mode and media metadata when updating the current screen", async () => {
    currentScreenId = "screen-1";
    parseModeState = "MarkdownV2";
    messageTypeState = "photo";
    mediaUrlState = "https://cdn.test/image.png";
    updateScreenMock.mockResolvedValue({});
    serializeMessagePayloadMock.mockImplementation(() => "{\"type\":\"photo\",\"text\":\"hello\",\"mediaUrl\":\"https://cdn.test/image.png\",\"parse_mode\":\"MarkdownV2\"}");

    const { result } = renderHook(() => useBuilderStore());

    await act(async () => {
      await result.current.leftPanelProps.onUpdateScreen();
    });

    expect(updateScreenMock).toHaveBeenCalledWith({
      screenId: "screen-1",
      update: expect.objectContaining({
        message_content: "{\"type\":\"photo\",\"text\":\"hello\",\"mediaUrl\":\"https://cdn.test/image.png\",\"parse_mode\":\"MarkdownV2\"}",
        parse_mode: "MarkdownV2",
        message_type: "photo",
        media_url: "https://cdn.test/image.png",
      }),
    });
  });

  it("saves flow-diagram links for non-current screens instead of leaving them only in local state", async () => {
    screensState = [
      {
        id: "screen-1",
        name: "Source",
        message_content: "source",
        keyboard: [{ id: "row-1", buttons: [{ id: "btn-1", text: "Go" }] }],
      },
      {
        id: "screen-2",
        name: "Target",
        message_content: "target",
        keyboard: [],
      },
    ];
    currentScreenId = "screen-2";
    updateScreenMock.mockResolvedValue({});

    const { result } = renderHook(() => useBuilderStore());

    await act(async () => {
      result.current.dialogState.flowDiagram.onCreateLink?.("screen-1", "screen-2");
      await Promise.resolve();
    });

    expect(updateScreenMock).toHaveBeenCalledWith({
      screenId: "screen-1",
      update: expect.objectContaining({
        keyboard: expect.arrayContaining([
          expect.objectContaining({
            buttons: expect.arrayContaining([
              expect.objectContaining({ linked_screen_id: "screen-2" }),
            ]),
          }),
        ]),
      }),
    });
    expect(queueUpdateOperationMock).not.toHaveBeenCalled();
  });

  it("loads the target screen into the editor when preview navigation follows a linked button", () => {
    screensState = [
      {
        id: "screen-1",
        name: "Source",
        message_content: "source",
        keyboard: [{ id: "row-1", buttons: [{ id: "btn-1", text: "Go", linked_screen_id: "screen-2" }] }],
      },
      {
        id: "screen-2",
        name: "Target",
        message_content: "{\"type\":\"photo\",\"text\":\"target\",\"mediaUrl\":\"https://cdn.test/target.png\",\"parse_mode\":\"MarkdownV2\"}",
        keyboard: [{ id: "row-2", buttons: [] }],
        parse_mode: "MarkdownV2",
        message_type: "photo",
        media_url: "https://cdn.test/target.png",
      },
    ];
    currentScreenId = "screen-1";

    const { result } = renderHook(() => useBuilderStore());

    act(() => {
      result.current.centerCanvasProps.onToggleMode();
    });

    act(() => {
      result.current.centerCanvasProps.onButtonClick({
        id: "btn-1",
        text: "Go",
        linked_screen_id: "screen-2",
      });
    });

    expect(handleNavigateToScreenMock).toHaveBeenCalledWith("screen-2");
    expect(loadMessagePayloadMock).toHaveBeenCalledWith("{\"type\":\"photo\",\"text\":\"target\",\"mediaUrl\":\"https://cdn.test/target.png\",\"parse_mode\":\"MarkdownV2\"}");
    expect(setParseModeMock).toHaveBeenCalledWith("MarkdownV2");
    expect(setMessageTypeMock).toHaveBeenCalledWith("photo");
    expect(setMediaUrlMock).toHaveBeenCalledWith("https://cdn.test/target.png");
    expect(setKeyboardMock).toHaveBeenCalledWith([{ id: "row-2", buttons: [] }]);
  });
});
