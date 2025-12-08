import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useChatState } from "@/hooks/chat/useChatState";
import { useSupabaseSync } from "@/hooks/chat/useSupabaseSync";
import { useKeyboardActions } from "@/hooks/chat/useKeyboardActions";
import { isEntrySet, useScreenNavigation } from "@/hooks/chat/useScreenNavigation";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useCodegen } from "@/hooks/chat/useCodegen";
import { useAuthUser } from "@/hooks/chat/useAuthUser";
import { validateKeyboard, validateMessageContent } from "@/lib/validation";
import type { TemplateDefinition } from "@/types/templates";
import {
  clearPendingOps,
  enqueueSaveOperation,
  enqueueUpdateOperation,
  processPendingOps,
  readPendingOps,
} from "@/lib/pendingQueue";
import type { Json, TablesUpdate } from "@/integrations/supabase/types";
import type { SaveScreenInput } from "@/lib/dataAccess";
import type { KeyboardButton, KeyboardRow, Screen } from "@/types/telegram";
import { MessageBubbleHandle } from "@/components/MessageBubble";

type ImportInlineButton = Partial<KeyboardButton> & { text?: string };
type ImportInlineKeyboard = ImportInlineButton[][];
type ImportPayload = {
  text?: string;
  message_content?: string;
  parse_mode?: string;
  reply_markup?: { inline_keyboard?: ImportInlineKeyboard };
  keyboard?: KeyboardRow[];
  photo?: string;
  video?: string;
};

type OnboardingProgress = { template: boolean; preview: boolean; share: boolean };

const ONBOARDING_STATE_KEY = "telegram_ui_onboarding_state_v1";
const ONBOARDING_DISMISS_KEY = "telegram_ui_onboarding_done_v1";

const cloneKeyboard = (rows: KeyboardRow[]): KeyboardRow[] =>
  rows.map((row) => ({
    ...row,
    buttons: row.buttons.map((btn) => ({ ...btn })),
  }));

const createDefaultKeyboard = (): KeyboardRow[] => [
  {
    id: "row-1",
    buttons: [
      { id: "btn-1", text: "Button 1", callback_data: "btn_1_action" },
      { id: "btn-2", text: "Button 2", callback_data: "btn_2_action" },
    ],
  },
];

const isNetworkError = (error: unknown) => {
  if (!error) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (error instanceof TypeError) return true;
  const message = (error as Error)?.message ?? "";
  return message.includes("Failed to fetch") || message.includes("NetworkError");
};

const safeRandomId = () => {
  try {
    // @ts-expect-error crypto may not exist in all environments
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      // @ts-expect-error randomUUID polyfill for browsers
      return crypto.randomUUID();
    }
  } catch (e) {
    void e;
  }
  return `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const useBuilderStore = () => {
  const navigate = useNavigate();
  const messageBubbleRef = useRef<MessageBubbleHandle>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queuedToastShownRef = useRef(false);

  const { user } = useAuthUser();
  const isOffline = useNetworkStatus();

  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJSON, setImportJSON] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [newScreenName, setNewScreenName] = useState("");
  const [flowDiagramOpen, setFlowDiagramOpen] = useState(false);
  const [circularDialogOpen, setCircularDialogOpen] = useState(false);
  const [detectedCircularPaths, setDetectedCircularPaths] = useState<string[][]>([]);
  const [allowCircular, setAllowCircular] = useState(false);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState<OnboardingProgress>({ template: false, preview: false, share: false });
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [buttonEditDialogOpen, setButtonEditDialogOpen] = useState(false);
  const [editingButtonData, setEditingButtonData] = useState<{ rowId: string; buttonId: string; button: KeyboardButton } | null>(null);
  const [pendingOpsNotice, setPendingOpsNotice] = useState(false);
  const [retryingQueue, setRetryingQueue] = useState(false);
  const [jsonSyncError, setJsonSyncError] = useState<string | null>(null);
  const [isClearingScreens, setIsClearingScreens] = useState(false);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<{ messageContent: string; keyboard: KeyboardRow[] } | null>(null);

  useEffect(() => {
    try {
      const savedProgress = localStorage.getItem(ONBOARDING_STATE_KEY);
      if (savedProgress) {
        const parsed = JSON.parse(savedProgress) as Partial<OnboardingProgress>;
        setOnboardingProgress((prev) => ({ ...prev, ...parsed }));
      }
      const dismissed = localStorage.getItem(ONBOARDING_DISMISS_KEY) === "1";
      if (dismissed) {
        setOnboardingDismissed(true);
      }
    } catch (e) {
      void e;
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(onboardingProgress));
    } catch (e) {
      void e;
    }
  }, [onboardingProgress]);

  const {
    messageContent,
    setMessageContent,
    keyboard,
    setKeyboard,
    parseMode,
    setParseMode,
    messageType,
    setMessageType,
    mediaUrl,
    setMediaUrl,
    pushToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    editableJSON,
    setEditableJSON,
    convertToTelegramFormat,
    serializeMessagePayload,
    loadMessagePayload,
    loadTemplate,
  } = useChatState();

  const completeOnboardingStep = useCallback((step: keyof OnboardingProgress) => {
    setOnboardingProgress((prev) => (prev[step] ? prev : { ...prev, [step]: true }));
  }, []);

  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    try {
      localStorage.setItem(ONBOARDING_DISMISS_KEY, "1");
    } catch (e) {
      void e;
    }
  }, []);

  const {
    screens,
    setScreens,
    pinnedIds,
    isLoading,
    loadScreens,
    saveScreen,
    updateScreen,
    deleteScreen,
    deleteAllScreens,
    handleTogglePin,
    shareLoading,
    setShareLoading,
    shareSyncStatus,
    setShareSyncStatus,
    layoutSyncStatus,
    setLayoutSyncStatus,
    pendingQueueSize,
    setPendingQueueSize,
    logSyncEvent,
    dataAccess,
    queueReplayCallbacks,
  } = useSupabaseSync(user);

  const {
    handleButtonTextChange,
    handleButtonUpdate,
    handleDeleteButton,
    handleAddButton,
    handleAddRow,
    handleReorder,
  } = useKeyboardActions(setKeyboard, pushToHistory, messageContent, keyboard);

  const {
    currentScreenId,
    setCurrentScreenId,
    navigationHistory,
    entryScreenId,
    handleNavigateBack,
    handleNavigateToScreen,
    handleSetEntry,
    handleJumpToEntry
  } = useScreenNavigation(screens, setScreens, loadScreens);

  const {
    codegenFramework,
    setCodegenFramework,
    codegenOutput,
    handleCopyCodegen
  } = useCodegen(convertToTelegramFormat, messageType);

  const refreshPendingQueueSize = useCallback(() => {
    const size = readPendingOps(user?.id).length;
    setPendingQueueSize(size);
    setPendingOpsNotice(size > 0);
    if (size === 0) {
      queuedToastShownRef.current = false;
    }
  }, [setPendingQueueSize, user?.id]);

  useEffect(() => {
    refreshPendingQueueSize();
  }, [refreshPendingQueueSize]);

  useEffect(() => {
    if (user) {
      loadScreens();
    }
  }, [user, loadScreens]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  }, [navigate]);

  const applyScreenState = useCallback(
    (screen: Screen) => {
      loadMessagePayload(screen.message_content);
      if (screen.parse_mode) setParseMode(screen.parse_mode);
      if (screen.message_type) setMessageType(screen.message_type);
      if (screen.media_url) setMediaUrl(screen.media_url);
      setKeyboard(screen.keyboard as KeyboardRow[]);
      setLastSavedSnapshot({
        messageContent: screen.message_content,
        keyboard: cloneKeyboard(screen.keyboard as KeyboardRow[]),
      });
      setCurrentScreenId(screen.id);
    },
    [loadMessagePayload, setParseMode, setMessageType, setMediaUrl, setKeyboard, setLastSavedSnapshot, setCurrentScreenId]
  );

  const togglePreviewMode = useCallback(() => {
    setIsPreviewMode((prev) => {
      const next = !prev;
      if (next) {
        completeOnboardingStep("preview");
      }
      return next;
    });
  }, [completeOnboardingStep]);

  const handleButtonClick = useCallback(
    (button: KeyboardButton) => {
      if (!isPreviewMode) return;
      if (button.linked_screen_id) {
        handleNavigateToScreen(button.linked_screen_id);
      } else if (button.url) {
        window.open(button.url, "_blank");
      } else {
        toast.info(`Callback: ${button.callback_data}`);
      }
    },
    [handleNavigateToScreen, isPreviewMode]
  );

  const queueSaveOperation = useCallback(
    (payload: SaveScreenInput) => {
      const id = payload.id ?? safeRandomId();
      const queuedPayload = { ...payload, id };
      enqueueSaveOperation(queuedPayload, user?.id);
      setScreens((prev) => [
        ...prev,
        {
          id,
          name: queuedPayload.name,
          message_content: queuedPayload.message_content,
          keyboard: cloneKeyboard(keyboard),
          parse_mode: parseMode,
          message_type: messageType,
          media_url: mediaUrl,
          share_token: queuedPayload.share_token ?? null,
          is_public: queuedPayload.is_public ?? false,
          created_at: new Date().toISOString(),
          updated_at: null,
          user_id: queuedPayload.user_id,
        } as Screen,
      ]);
      setCurrentScreenId(id);
      refreshPendingQueueSize();
      setPendingOpsNotice(true);
      if (!queuedToastShownRef.current) {
        toast.info("网络不可用，已排队保存请求");
        queuedToastShownRef.current = true;
      }
    },
    [keyboard, mediaUrl, messageType, parseMode, refreshPendingQueueSize, setCurrentScreenId, setScreens, setPendingOpsNotice, user?.id],
  );

  const queueUpdateOperation = useCallback(
    (updatePayload: TablesUpdate<"screens">) => {
      if (!currentScreenId) return;
      enqueueUpdateOperation({ id: currentScreenId, update: updatePayload }, user?.id);
      setScreens((prev) =>
        prev.map((s) =>
          s.id === currentScreenId
            ? ({
              ...s,
              message_content: updatePayload.message_content ?? s.message_content,
              keyboard: updatePayload.keyboard ? cloneKeyboard(updatePayload.keyboard as KeyboardRow[]) : s.keyboard,
              name: updatePayload.name ?? s.name,
              updated_at: updatePayload.updated_at ?? s.updated_at,
            } as Screen)
            : s,
        ),
      );
      refreshPendingQueueSize();
      setPendingOpsNotice(true);
      if (!queuedToastShownRef.current) {
        toast.info("网络不可用，更新已排队");
        queuedToastShownRef.current = true;
      }
    },
    [currentScreenId, refreshPendingQueueSize, setScreens, setPendingOpsNotice, user?.id],
  );

  const replayPendingQueue = useCallback(async () => {
    if (!user) {
      refreshPendingQueueSize();
      return;
    }

    const queued = readPendingOps(user.id);
    if (queued.length === 0) {
      refreshPendingQueueSize();
      return;
    }

    setRetryingQueue(true);
    try {
      const remaining = await processPendingOps({
        userId: user.id,
        backoffMs: 400,
        maxAttempts: 3,
        ...(queueReplayCallbacks ?? {}),
        execute: async (item) => {
          if (item.kind === "save") {
            const saved = await dataAccess.saveScreen(item.payload);
            if (saved) {
              setScreens((prev) => {
                const idx = prev.findIndex((s) => s.id === (item.payload.id ?? (saved as Screen).id));
                if (idx === -1) return prev;
                const next = [...prev];
                next[idx] = { ...(saved as Screen), keyboard: (saved as Screen).keyboard as KeyboardRow[] } as Screen;
                return next;
              });
              setLastSavedSnapshot({
                messageContent: item.payload.message_content,
                keyboard: cloneKeyboard(item.payload.keyboard as KeyboardRow[]),
              });
              setCurrentScreenId((current) => current ?? (saved as Screen).id);
            }
          } else {
            const updated = await dataAccess.updateScreen({ screenId: item.payload.id, update: item.payload.update });
            setScreens((prev) =>
              prev.map((s) =>
                s.id === item.payload.id
                  ? ({ ...(updated as Screen), keyboard: (updated as Screen).keyboard as KeyboardRow[] } as Screen)
                  : s,
              ),
            );
            if (item.payload.update.message_content || item.payload.update.keyboard) {
              setLastSavedSnapshot({
                messageContent: (item.payload.update.message_content as string) ?? serializeMessagePayload(),
                keyboard: item.payload.update.keyboard
                  ? cloneKeyboard(item.payload.update.keyboard as KeyboardRow[])
                  : cloneKeyboard(keyboard),
              });
            }
          }
        },
        onItemFailure: queueReplayCallbacks.onItemFailure,
        onSuccess: queueReplayCallbacks.onSuccess,
        onPermanentFailure: () => {
          setPendingOpsNotice(true);
          toast.error("离线队列重试失败，请检查网络后重试");
        },
      });
      setPendingQueueSize(remaining.length);
      setPendingOpsNotice(remaining.length > 0);
      if (remaining.length === 0) {
        queuedToastShownRef.current = false;
        toast.success("离线队列已同步");
      }
    } finally {
      setRetryingQueue(false);
    }
  }, [
    dataAccess,
    keyboard,
    refreshPendingQueueSize,
    serializeMessagePayload,
    setCurrentScreenId,
    setPendingOpsNotice,
    setPendingQueueSize,
    setScreens,
    queueReplayCallbacks,
    user,
  ]);

  const clearPendingQueue = useCallback(() => {
    clearPendingOps(user?.id);
    refreshPendingQueueSize();
    setPendingOpsNotice(false);
    toast.success("已清空离线队列");
  }, [refreshPendingQueueSize, setPendingOpsNotice, user?.id]);

  const createNewScreen = useCallback(() => {
    setMessageContent("Welcome to the Telegram UI Builder!\n\nEdit this message directly.");
    setKeyboard(createDefaultKeyboard());
    setCurrentScreenId(undefined);
    setNewScreenName("");
    setLastSavedSnapshot({
      messageContent: "Welcome to the Telegram UI Builder!\n\nEdit this message directly.",
      keyboard: cloneKeyboard(createDefaultKeyboard()),
    });
    toast.success("New screen created");
  }, [setMessageContent, setKeyboard, setCurrentScreenId]);

  const handleApplyTemplate = useCallback(
    (template: TemplateDefinition) => {
      const result = loadTemplate(template);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (template.name) {
        setNewScreenName((prev) => prev || template.name);
      }
      setTemplateLibraryOpen(false);
      setIsPreviewMode(false);
      completeOnboardingStep("template");
      toast.success(`已载入模板${template.name ? `：${template.name}` : ""}`);
    },
    [completeOnboardingStep, loadTemplate, setNewScreenName],
  );

  const handleSaveScreen = useCallback(async () => {
    if (!user) {
      toast.error("Please sign in to save screens");
      return;
    }
    if (!newScreenName.trim()) {
      toast.error("Please enter a screen name");
      return;
    }

    try {
      validateMessageContent(messageContent);
      validateKeyboard(keyboard);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "内容不合法，保存已取消");
      return;
    }

    const payload: SaveScreenInput = {
      user_id: user.id,
      name: newScreenName,
      message_content: serializeMessagePayload(),
      keyboard: keyboard as Json,
      is_public: false,
      share_token: null,
    };

    if (isOffline) {
      queueSaveOperation(payload);
      return;
    }

    try {
      const savedScreen = await saveScreen(payload);
      if (savedScreen) {
        applyScreenState({
          ...(savedScreen as Screen),
          keyboard: keyboard as KeyboardRow[],
          message_content: serializeMessagePayload(),
          parse_mode: parseMode,
          message_type: messageType,
          media_url: mediaUrl,
        } as Screen);
        setNewScreenName("");
        setLastSavedSnapshot({
          messageContent: payload.message_content,
          keyboard: cloneKeyboard(keyboard),
        });
      }
    } catch (error) {
      if (isNetworkError(error)) {
        queueSaveOperation(payload);
        return;
      }
    }
  }, [
    applyScreenState,
    isOffline,
    keyboard,
    mediaUrl,
    messageContent,
    messageType,
    newScreenName,
    parseMode,
    queueSaveOperation,
    saveScreen,
    serializeMessagePayload,
    setLastSavedSnapshot,
    setNewScreenName,
    user,
  ]);

  const handleUpdateScreen = useCallback(async () => {
    if (!currentScreenId || !user) return;

    try {
      validateMessageContent(messageContent);
      validateKeyboard(keyboard);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "内容不合法，更新已取消");
      return;
    }

    const updatePayload: TablesUpdate<"screens"> = {
      message_content: serializeMessagePayload(),
      keyboard: keyboard as Json,
      updated_at: new Date().toISOString(),
    };

    if (isOffline) {
      queueUpdateOperation(updatePayload);
      return;
    }

    try {
      await updateScreen({
        screenId: currentScreenId,
        update: updatePayload
      });
      setLastSavedSnapshot({
        messageContent: serializeMessagePayload(),
        keyboard: cloneKeyboard(keyboard),
      });
      toast.success("Screen updated");
    } catch (error) {
      if (isNetworkError(error)) {
        queueUpdateOperation(updatePayload);
      }
    }
  }, [currentScreenId, isOffline, keyboard, messageContent, queueUpdateOperation, serializeMessagePayload, setLastSavedSnapshot, updateScreen, user]);

  useGlobalShortcuts({
    onUndo: undo,
    onRedo: redo,
    onSave: handleSaveScreen,
    canUndo,
    canRedo,
  });

  useEffect(() => {
    if (!lastSavedSnapshot) {
      setLastSavedSnapshot({
        messageContent,
        keyboard: JSON.parse(JSON.stringify(keyboard)),
      });
    }
  }, [lastSavedSnapshot, messageContent, keyboard]);

  useEffect(() => {
    if (currentScreenId && user && !isPreviewMode) {
      const timer = setTimeout(() => {
        void handleUpdateScreen();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [messageContent, keyboard, currentScreenId, user, isPreviewMode, handleUpdateScreen]);

  useEffect(() => {
    if (!isOffline) {
      void replayPendingQueue();
    }
  }, [isOffline, replayPendingQueue]);

  const openRenameDialog = useCallback(() => {
    if (currentScreenId) {
      const screen = screens.find(s => s.id === currentScreenId);
      if (screen) {
        setRenameValue(screen.name);
        setRenameDialogOpen(true);
      }
    }
  }, [currentScreenId, screens]);

  const handleRenameScreen = useCallback(async () => {
    if (!currentScreenId || !renameValue.trim()) return;
    const updatePayload: TablesUpdate<"screens"> = { name: renameValue };

    if (isOffline) {
      queueUpdateOperation(updatePayload);
      setRenameDialogOpen(false);
      return;
    }

    try {
      await updateScreen({
        screenId: currentScreenId,
        update: updatePayload
      });
      setRenameDialogOpen(false);
    } catch (error) {
      if (isNetworkError(error)) {
        queueUpdateOperation(updatePayload);
        setRenameDialogOpen(false);
      }
    }
  }, [currentScreenId, isOffline, queueUpdateOperation, renameValue, updateScreen]);

  const handleCopyJSON = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editableJSON);
      toast.success("JSON copied to clipboard");
      completeOnboardingStep("share");
    } catch (error) {
      console.error("Copy JSON failed", error);
      toast.error("复制失败，请检查浏览器权限");
    }
  }, [completeOnboardingStep, editableJSON]);

  const handleExportJSON = useCallback(() => {
    const blob = new Blob([editableJSON], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "telegram-keyboard.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [editableJSON]);

  const resolveEntryScreen = useCallback(() => {
    if (!isEntrySet(entryScreenId, screens)) {
      toast.error("请先设置入口模版");
      return null;
    }
    const target = screens.find((s) => s.id === entryScreenId);
    if (!target) {
      toast.error("入口模版不存在，请重新选择");
      return null;
    }
    return target;
  }, [entryScreenId, screens]);

  const exportFlowAsJSON = useCallback(() => {
    const entry = resolveEntryScreen();
    if (!entry) return;
    const flow = {
      version: "1.0",
      entry_screen_id: entry.id,
      screens: screens.map(s => ({
        id: s.id,
        name: s.name,
        message_content: s.message_content,
        keyboard: s.keyboard
      }))
    };
    const blob = new Blob([JSON.stringify(flow, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "telegram-flow.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [resolveEntryScreen, screens]);

  const handleImportJSON = useCallback(async () => {
    try {
      setIsImporting(true);
      const data = JSON.parse(importJSON);
      if (data.text) setMessageContent(data.text);
      toast.success("Imported successfully");
      setImportDialogOpen(false);
    } catch (e) {
      toast.error("Invalid JSON");
    } finally {
      setIsImporting(false);
    }
  }, [importJSON, setMessageContent]);

  const handleImportFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImportJSON(event.target?.result as string);
    };
    reader.readAsText(file);
  }, []);

  const handleApplyEditedJSON = useCallback(() => {
    try {
      const parsed = JSON.parse(editableJSON) as unknown;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid JSON structure");
      }
      const data = parsed as ImportPayload;

      const nextMessage =
        typeof data.text === "string"
          ? data.text
          : typeof data.message_content === "string"
            ? data.message_content
            : null;

      if (nextMessage) {
        validateMessageContent(nextMessage);
        setMessageContent(nextMessage);
      }

      if (typeof data.parse_mode === "string") {
        const mode = data.parse_mode === "MarkdownV2" ? "MarkdownV2" : "HTML";
        setParseMode(mode);
      }

      const inlineKeyboard = Array.isArray(data.reply_markup?.inline_keyboard)
        ? (data.reply_markup?.inline_keyboard as ImportInlineKeyboard)
        : undefined;
      const internalKeyboard = data.keyboard;
      const nextKeyboard = inlineKeyboard ?? internalKeyboard;

      if (nextKeyboard) {
        if (inlineKeyboard) {
          const mapped: KeyboardRow[] = inlineKeyboard.map((row, rowIdx) => ({
            id: `row-${rowIdx}-${Date.now()}`,
            buttons: row.map((btn, btnIdx) => ({
              id: btn.id ?? `btn-${rowIdx}-${btnIdx}-${Date.now()}`,
              text: btn.text ?? "",
              url: btn.url,
              callback_data: btn.callback_data,
              linked_screen_id: btn.linked_screen_id,
            })),
          }));
          try {
            validateKeyboard(mapped);
          } catch (error) {
            const message = error instanceof Error ? error.message : "键盘格式不合法";
            setJsonSyncError(`导入失败：${message}`);
            return;
          }
          setKeyboard(mapped);
        } else {
          try {
            validateKeyboard(nextKeyboard);
          } catch (error) {
            const message = error instanceof Error ? error.message : "键盘格式不合法";
            setJsonSyncError(`导入失败：${message}`);
            return;
          }
          setKeyboard(() => JSON.parse(JSON.stringify(nextKeyboard)) as KeyboardRow[]);
        }
      }

      if (typeof data.photo === "string") {
        setMessageType("photo");
        setMediaUrl(data.photo);
      } else if (typeof data.video === "string") {
        setMessageType("video");
        setMediaUrl(data.video);
      } else {
        setMessageType("text");
        setMediaUrl("");
      }

      setJsonSyncError(null);
      toast.success("Applied JSON changes");
    } catch (e) {
      setJsonSyncError("Invalid JSON");
    }
  }, [editableJSON, setKeyboard, setMediaUrl, setMessageContent, setMessageType, setParseMode]);

  const handleCreateLink = useCallback((sourceId: string, targetId: string) => {
    setScreens((prev) => {
      const next = prev.map((s) => {
        if (s.id !== sourceId) return s;
        const rows = (s.keyboard as KeyboardRow[]).map((row) => ({
          ...row,
          buttons: row.buttons.map((btn) => ({ ...btn })),
        }));
        let updated = false;
        for (const row of rows) {
          const btn = row.buttons.find((b) => !b.linked_screen_id && !b.url);
          if (btn) {
            btn.linked_screen_id = targetId;
            updated = true;
            break;
          }
        }
        if (!updated && rows[0]?.buttons[0]) {
          rows[0].buttons[0].linked_screen_id = targetId;
        }
        if (currentScreenId === sourceId) {
          setKeyboard(rows);
          pushToHistory(messageContent, rows);
        }
        return { ...s, keyboard: rows };
      });
      return next;
    });
  }, [currentScreenId, pushToHistory, messageContent, setKeyboard, setScreens]);

  const generateShareToken = useCallback(() => {
    try {
      // @ts-expect-error browser crypto
      if (typeof crypto !== "undefined" && crypto.randomUUID) {
        // @ts-expect-error randomUUID polyfill
        return crypto.randomUUID();
      }
    } catch (e) {
      void e;
    }
    return Math.random().toString(36).substring(2, 15);
  }, []);

  const hasBrokenLinks = useCallback(
    (allScreens: Screen[]) => {
      const ids = new Set(allScreens.map((s) => s.id));
      for (const screen of allScreens) {
        for (const row of screen.keyboard ?? []) {
          for (const btn of row.buttons ?? []) {
            if (btn.linked_screen_id && !ids.has(btn.linked_screen_id)) {
              return true;
            }
          }
        }
      }
      return false;
    },
    [],
  );

  const buildShareUrl = useCallback((token: string) => `${window.location.origin}/share/${token}`, []);

  const updateShareState = useCallback((updated: Screen) => {
    setScreens((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, [setScreens]);

  const withShareStatus = useCallback(
    async (message: string, op: () => Promise<Screen | null>) => {
      const requestId = `share_${Date.now()}`;
      const pendingStatus = { state: "pending" as const, requestId, message };
      setShareLoading(true);
      setShareSyncStatus(pendingStatus);
      logSyncEvent("share", pendingStatus);
      try {
        const result = await op();
        const successStatus = { state: "success" as const, requestId, at: Date.now(), message: "已同步" };
        setShareSyncStatus(successStatus);
        logSyncEvent("share", successStatus);
        return result;
      } catch (error) {
        const errorStatus = {
          state: "error" as const,
          requestId,
          message: error instanceof Error ? error.message : "分享失败",
        };
        setShareSyncStatus(errorStatus);
        logSyncEvent("share", errorStatus);
        throw error;
      } finally {
        setShareLoading(false);
      }
    },
    [logSyncEvent, setShareLoading, setShareSyncStatus],
  );

  const handleCopyOrShare = useCallback(async () => {
    if (!user) {
      toast.error("请先登录");
      return;
    }
    const entry = resolveEntryScreen();
    if (!entry) return;

    if (hasBrokenLinks(screens)) {
      toast.error("存在指向已删除模版的按钮，请修复后再分享");
      return;
    }

    try {
      const result = await withShareStatus("生成分享链接", async () => {
        if (entry.is_public && entry.share_token) {
          return entry;
        }
        const token = generateShareToken();
        const updated = await dataAccess.publishShareToken({ screenId: entry.id, token }) as unknown as Screen;
        updateShareState(updated);
        return updated;
      });
      const tokenToUse = result?.share_token ?? entry.share_token;
      if (!tokenToUse) {
        toast.error("未能生成分享链接");
        return;
      }
      await navigator.clipboard.writeText(buildShareUrl(tokenToUse));
      toast.success(result && result !== entry ? "公开链接已创建并复制" : "链接已复制");
      completeOnboardingStep("share");
    } catch (error) {
      console.error("Error generating share link:", error);
      toast.error("生成分享链接失败");
    }
  }, [buildShareUrl, completeOnboardingStep, dataAccess, generateShareToken, hasBrokenLinks, resolveEntryScreen, screens, updateShareState, user, withShareStatus]);

  const handleRotateShareLink = useCallback(async () => {
    if (!user) {
      toast.error("请先登录");
      return;
    }
    const entry = resolveEntryScreen();
    if (!entry) return;
    const token = generateShareToken();
    try {
      const updated = await withShareStatus("刷新分享链接", async () => {
        const next = await dataAccess.rotateShareToken(entry.id, token) as unknown as Screen;
        updateShareState(next);
        return next;
      });
      const tokenToUse = updated?.share_token ?? token;
      await navigator.clipboard.writeText(buildShareUrl(tokenToUse));
      toast.success("链接已刷新，旧链接已失效");
      completeOnboardingStep("share");
    } catch (error) {
      console.error("Error rotating share link:", error);
      toast.error("刷新分享链接失败");
    }
  }, [buildShareUrl, completeOnboardingStep, dataAccess, generateShareToken, resolveEntryScreen, updateShareState, user, withShareStatus]);

  const handleUnshareScreen = useCallback(async () => {
    if (!user) {
      toast.error("请先登录");
      return;
    }
    const entry = resolveEntryScreen();
    if (!entry) return;
    try {
      await withShareStatus("取消公开", async () => {
        const updated = await dataAccess.revokeShareToken(entry.id) as unknown as Screen;
        updateShareState(updated);
        return updated;
      });
      toast.success("已取消公开");
    } catch (error) {
      console.error("Error revoking share link:", error);
      toast.error("取消公开失败");
    }
  }, [dataAccess, resolveEntryScreen, updateShareState, user, withShareStatus]);

  const handleFormatClick = useCallback((format: 'bold' | 'italic' | 'code' | 'link') => {
    if (format === "link") {
      const url = prompt("输入链接 (https://...)");
      if (url) {
        messageBubbleRef.current?.applyFormat("link", url);
      }
    } else {
      messageBubbleRef.current?.applyFormat(format);
    }
    messageBubbleRef.current?.focus();
  }, []);

  const hasUnsavedChanges = useMemo(
    () =>
      !!lastSavedSnapshot && (
        lastSavedSnapshot.messageContent !== serializeMessagePayload() ||
        JSON.stringify(lastSavedSnapshot.keyboard) !== JSON.stringify(keyboard)
      ),
    [keyboard, lastSavedSnapshot, serializeMessagePayload]
  );

  const pendingItems = useMemo(() => {
    void pendingQueueSize;
    return readPendingOps(user?.id);
  }, [user?.id, pendingQueueSize]);

  const leftPanelProps = useMemo(() => ({
    user,
    screens,
    currentScreenId,
    entryScreenId,
    pinnedIds,
    isLoading,
    isClearingScreens,
    shareLoading,
    hasUnsavedChanges,
    isOffline,
    onLogout: handleLogout,
    onLoadScreen: (id: string) => {
      handleNavigateToScreen(id);
      const screen = screens.find(s => s.id === id);
      if (screen) {
        applyScreenState(screen);
      }
    },
    onNewScreen: createNewScreen,
    onSaveScreen: handleSaveScreen,
    onUpdateScreen: handleUpdateScreen,
    onDeleteScreen: deleteScreen,
    onDeleteAllScreens: async () => {
      try {
        setIsClearingScreens(true);
        await deleteAllScreens();
      } finally {
        setIsClearingScreens(false);
      }
    },
    onTogglePin: handleTogglePin,
    onSetEntry: (id: string | null) => handleSetEntry(id),
    onJumpToEntry: () => {
      const entry = resolveEntryScreen();
      if (entry) {
        handleNavigateToScreen(entry.id);
        applyScreenState(entry);
      }
    },
    onCopyOrShare: handleCopyOrShare,
    onRotateShareLink: handleRotateShareLink,
    onUnshareScreen: handleUnshareScreen,
    onOpenImport: () => setImportDialogOpen(true),
    onCopyJSON: handleCopyJSON,
    onExportJSON: handleExportJSON,
    onExportFlow: exportFlowAsJSON,
    onOpenFlowDiagram: () => setFlowDiagramOpen(true),
  }), [
    applyScreenState,
    createNewScreen,
    currentScreenId,
    deleteAllScreens,
    deleteScreen,
    entryScreenId,
    exportFlowAsJSON,
    handleCopyJSON,
    handleCopyOrShare,
    handleExportJSON,
    handleLogout,
    handleRotateShareLink,
    handleUnshareScreen,
    handleNavigateToScreen,
    handleSaveScreen,
    handleSetEntry,
    handleUpdateScreen,
    handleTogglePin,
    hasUnsavedChanges,
    isClearingScreens,
    isLoading,
    isOffline,
    pinnedIds,
    resolveEntryScreen,
    screens,
    setFlowDiagramOpen,
    setImportDialogOpen,
    shareLoading,
    user,
  ]);

  const onboardingVisible = useMemo(
    () => !onboardingDismissed && Object.values(onboardingProgress).some((value) => !value),
    [onboardingDismissed, onboardingProgress],
  );

  const rightPanelProps = useMemo(() => ({
    newScreenName,
    onNewScreenNameChange: setNewScreenName,
    onFormatClick: handleFormatClick,
    parseMode,
    onParseModeChange: setParseMode,
    messageType,
    mediaUrl,
    onMessageTypeChange: setMessageType,
    onMediaUrlChange: setMediaUrl,
    onAddButton: handleAddButton,
    onAddRow: handleAddRow,
    allowCircular,
    onAllowCircularChange: setAllowCircular,
    isOffline,
    currentScreenId,
    onOpenRenameDialog: openRenameDialog,
  }), [
    allowCircular,
    currentScreenId,
    handleAddButton,
    handleAddRow,
    handleFormatClick,
    isOffline,
    mediaUrl,
    messageType,
    newScreenName,
    openRenameDialog,
    parseMode,
    setAllowCircular,
    setMediaUrl,
    setMessageType,
    setNewScreenName,
    setParseMode,
  ]);

  const centerCanvasProps = useMemo(() => ({
    messageContent,
    setMessageContent,
    keyboard,
    parseMode,
    onParseModeChange: setParseMode,
    messageType,
    mediaUrl,
    onMessageTypeChange: setMessageType,
    onMediaUrlChange: setMediaUrl,
    onButtonTextChange: handleButtonTextChange,
    onButtonUpdate: handleButtonUpdate,
    onDeleteButton: handleDeleteButton,
    onButtonClick: (button: KeyboardButton) => handleButtonClick(button),
    onKeyboardReorder: handleReorder,
    isPreviewMode,
    onToggleMode: togglePreviewMode,
    onOpenTemplateLibrary: () => setTemplateLibraryOpen(true),
    onOpenFlowDiagram: () => setFlowDiagramOpen(true),
    canUndo,
    canRedo,
    onUndo: undo,
    onRedo: redo,
    messageBubbleRef,
    screens,
    navigationHistory,
    currentScreenId,
    onNavigateBack: handleNavigateBack,
    currentScreenName: screens.find(s => s.id === currentScreenId)?.name,
    entryScreenId,
    hasUnsavedChanges,
    isOffline,
    shareSyncStatus,
    layoutSyncStatus,
    pendingQueueSize,
  }), [
    canRedo,
    canUndo,
    currentScreenId,
    handleButtonClick,
    handleButtonTextChange,
    handleButtonUpdate,
    handleDeleteButton,
    handleNavigateBack,
    handleReorder,
    hasUnsavedChanges,
    isOffline,
    isPreviewMode,
    keyboard,
    layoutSyncStatus,
    mediaUrl,
    messageContent,
    messageType,
    navigationHistory,
    parseMode,
    pendingQueueSize,
    redo,
    entryScreenId,
    screens,
    setFlowDiagramOpen,
    setMediaUrl,
    setMessageContent,
    setMessageType,
    setTemplateLibraryOpen,
    setParseMode,
    shareSyncStatus,
    togglePreviewMode,
    undo,
  ]);

  const bottomPanelProps = useMemo(() => ({
    editableJSON,
    onEditableJSONChange: setEditableJSON,
    onApplyJSON: handleApplyEditedJSON,
    jsonSyncError,
    isImporting,
    loadIssue: null as string | null,
    circularReferences: [] as Array<{ path: string[]; screenNames: string[] }>,
    allowCircular,
    pendingOpsNotice,
    pendingQueueSize,
    onRetryPendingOps: replayPendingQueue,
    onClearPendingOps: clearPendingQueue,
    pendingItems,
    onExportPending: () => {
      const items = readPendingOps(user?.id);
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "pending-queue.json";
      link.click();
      URL.revokeObjectURL(url);
    },
    retryingQueue,
    isOffline,
    codegenFramework,
    onCodegenFrameworkChange: setCodegenFramework,
    codegenOutput,
    onCopyCodegen: handleCopyCodegen,
  }), [
    allowCircular,
    clearPendingQueue,
    codegenFramework,
    codegenOutput,
    editableJSON,
    handleApplyEditedJSON,
    handleCopyCodegen,
    isImporting,
    isOffline,
    jsonSyncError,
    pendingItems,
    pendingOpsNotice,
    pendingQueueSize,
    replayPendingQueue,
    retryingQueue,
    setCodegenFramework,
    setEditableJSON,
    user?.id,
  ]);

  const dialogState = useMemo(() => ({
    buttonEditor: {
      open: buttonEditDialogOpen,
      data: editingButtonData,
      screens,
      onClose: () => {
        setButtonEditDialogOpen(false);
        setEditingButtonData(null);
      },
      onSave: (updatedButton: KeyboardButton) => {
        if (!editingButtonData) return;
        handleButtonUpdate(editingButtonData.rowId, editingButtonData.buttonId, updatedButton);
        setButtonEditDialogOpen(false);
        setEditingButtonData(null);
      },
      onOpenScreen: (screenId: string) => {
        handleNavigateToScreen(screenId);
        const screen = screens.find(s => s.id === screenId);
        if (screen) {
          applyScreenState(screen);
        }
        toast.success(`✅ 已跳转到: ${screens.find(s => s.id === screenId)?.name}`);
      },
      onCreateAndOpen: () => {
        createNewScreen();
        toast.info("🆕 已创建新模版，请先保存以便可被链接");
      },
    },
    importDialog: {
      open: importDialogOpen,
      setOpen: setImportDialogOpen,
      importJSON,
      setImportJSON,
      isImporting,
      onImport: handleImportJSON,
      fileInputRef,
      onFileSelect: handleImportFileSelect,
    },
    renameDialog: {
      open: renameDialogOpen,
      setOpen: setRenameDialogOpen,
      value: renameValue,
      setValue: setRenameValue,
      onSave: handleRenameScreen,
    },
    flowDiagram: {
      open: flowDiagramOpen,
      setOpen: setFlowDiagramOpen,
      screens,
      currentScreenId,
      userId: user?.id,
      entryScreenId,
      pinnedIds,
      onLayoutSync: setLayoutSyncStatus,
      onCreateLink: handleCreateLink,
      onScreenClick: (screenId: string) => {
        handleNavigateToScreen(screenId);
        const screen = screens.find(s => s.id === screenId);
        if (screen) {
          applyScreenState(screen);
        }
        toast.success(`✅ 已跳转到: ${screens.find(s => s.id === screenId)?.name}`);
      },
      onSetEntry: handleSetEntry,
      onDeleteScreen: deleteScreen,
    },
    circularDialog: {
      open: circularDialogOpen,
      setOpen: setCircularDialogOpen,
      circularPaths: detectedCircularPaths,
      screens,
      currentScreenId,
      onNavigateToScreen: (screenId: string) => {
        handleNavigateToScreen(screenId);
        const screen = screens.find(s => s.id === screenId);
        if (screen) {
          applyScreenState(screen);
        }
        toast.success(`✅ 已跳转到: ${screens.find(s => s.id === screenId)?.name}`);
      },
      onOpenFlowDiagram: () => {
        setCircularDialogOpen(false);
        setFlowDiagramOpen(true);
      },
    },
    templateLibrary: {
      open: templateLibraryOpen,
      setOpen: setTemplateLibraryOpen,
      onApply: handleApplyTemplate,
    },
    onboarding: {
      visible: onboardingVisible,
      progress: onboardingProgress,
      onDismiss: dismissOnboarding,
      onOpenTemplate: () => setTemplateLibraryOpen(true),
      onTogglePreview: togglePreviewMode,
      onShare: handleCopyJSON,
    },
  }), [
    applyScreenState,
    buttonEditDialogOpen,
    circularDialogOpen,
    createNewScreen,
    currentScreenId,
    deleteScreen,
    detectedCircularPaths,
    editingButtonData,
    entryScreenId,
    flowDiagramOpen,
    handleButtonUpdate,
    handleCopyJSON,
    handleCreateLink,
    handleApplyTemplate,
    handleImportJSON,
    handleImportFileSelect,
    handleNavigateToScreen,
    handleRenameScreen,
    handleSetEntry,
    importDialogOpen,
    importJSON,
    isImporting,
    renameDialogOpen,
    renameValue,
    pinnedIds,
    screens,
    setLayoutSyncStatus,
    templateLibraryOpen,
    onboardingProgress,
    onboardingVisible,
    dismissOnboarding,
    togglePreviewMode,
    setTemplateLibraryOpen,
    user,
  ]);

  return {
    leftPanelProps,
    rightPanelProps,
    centerCanvasProps,
    bottomPanelProps,
    dialogState,
  };
};

export type BuilderStore = ReturnType<typeof useBuilderStore>;
