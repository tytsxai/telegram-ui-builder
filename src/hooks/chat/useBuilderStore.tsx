import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { shallow } from "zustand/shallow";
import { supabase } from "@/integrations/supabase/client";
import { useChatState } from "@/hooks/chat/useChatState";
import { useSupabaseSync } from "@/hooks/chat/useSupabaseSync";
import { useKeyboardActions } from "@/hooks/chat/useKeyboardActions";
import { isEntrySet, useScreenNavigation } from "@/hooks/chat/useScreenNavigation";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useCodegen } from "@/hooks/chat/useCodegen";
import { useAuthUser } from "@/hooks/chat/useAuthUser";
import { screenContainsSensitiveData, validateKeyboard, validateMessageContent } from "@/lib/validation";
import type { TemplateDefinition } from "@/types/templates";
import { useOfflineQueueSync } from "@/hooks/chat/useOfflineQueueSync";
import { readPendingOps } from "@/lib/pendingQueue";
import type { Json, TablesUpdate } from "@/integrations/supabase/types";
import type { SaveScreenInput } from "@/lib/dataAccess";
import type { KeyboardButton, KeyboardRow, Screen } from "@/types/telegram";
import { MessageBubbleHandle } from "@/components/MessageBubble";
import { makeRequestId } from "@/types/sync";
import { recordAuditEvent } from "@/lib/auditTrail";
import { cloneKeyboard, createDefaultKeyboard } from "@/lib/keyboard/factory";
import { buildAppUrl } from "@/lib/appUrl";

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

const isNetworkError = (error: unknown) => {
  if (!error) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (error instanceof TypeError) return true;
  const message = (error as Error)?.message ?? "";
  return message.includes("Failed to fetch") || message.includes("NetworkError");
};

const isSensitiveShareError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: string }).message ?? "";
  const code = (error as { code?: string }).code ?? "";
  return code === "23514" || message.includes("screens_public_no_sensitive");
};

const useShallowMemo = <T,>(value: T, isEqual: (a: T, b: T) => boolean = shallow as unknown as (a: T, b: T) => boolean) => {
  const ref = useRef(value);
  if (!isEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
};

export const useBuilderStore = () => {
  const navigate = useNavigate();
  const messageBubbleRef = useRef<MessageBubbleHandle>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  // Track whether current editor state differs from last saved snapshot
  const hasUnsavedChanges = useMemo(
    () =>
      !!lastSavedSnapshot && (
        lastSavedSnapshot.messageContent !== serializeMessagePayload() ||
        JSON.stringify(lastSavedSnapshot.keyboard) !== JSON.stringify(keyboard)
      ),
    [keyboard, lastSavedSnapshot, serializeMessagePayload],
  );

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
    handleSetEntry
  } = useScreenNavigation(screens, setScreens, loadScreens);

  const screenById = useMemo(() => new Map(screens.map((screen) => [screen.id, screen])), [screens]);
  const currentScreen = useMemo(
    () => (currentScreenId ? screenById.get(currentScreenId) ?? null : null),
    [currentScreenId, screenById],
  );
  const entryScreen = useMemo(
    () => (entryScreenId ? screenById.get(entryScreenId) ?? null : null),
    [entryScreenId, screenById],
  );
  const currentScreenName = useMemo(() => currentScreen?.name ?? null, [currentScreen]);

  const {
    codegenFramework,
    setCodegenFramework,
    codegenOutput,
    handleCopyCodegen
  } = useCodegen(convertToTelegramFormat, messageType);

  const {
    pendingOpsNotice,
    pendingQueueVersion,
    retryingQueue,
    refreshPendingQueueSize,
    queueSaveOperation,
    queueUpdateOperation,
    replayPendingQueue,
    clearPendingQueue,
  } = useOfflineQueueSync({
    user,
    keyboard,
    parseMode,
    messageType,
    mediaUrl,
    currentScreenId,
    serializeMessagePayload,
    dataAccess,
    queueReplayCallbacks,
    setScreens,
    setCurrentScreenId,
    setLastSavedSnapshot,
    setPendingQueueSize,
  });

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
      if (screen.parse_mode !== undefined && screen.parse_mode !== null) setParseMode(screen.parse_mode);
      if (screen.message_type !== undefined && screen.message_type !== null) setMessageType(screen.message_type);
      if (screen.media_url !== undefined) setMediaUrl(screen.media_url ?? "");
      setKeyboard(screen.keyboard as KeyboardRow[]);
      setLastSavedSnapshot({
        messageContent: screen.message_content,
        keyboard: cloneKeyboard(screen.keyboard as KeyboardRow[]),
      });
      setCurrentScreenId(screen.id);
    },
    [loadMessagePayload, setParseMode, setMessageType, setMediaUrl, setKeyboard, setLastSavedSnapshot, setCurrentScreenId]
  );

  const buildEditorScreenUpdatePayload = useCallback(
    (): TablesUpdate<"screens"> => ({
      message_content: serializeMessagePayload(),
      keyboard: keyboard as unknown as Json,
      parse_mode: parseMode,
      message_type: messageType,
      media_url: messageType === "text" ? null : mediaUrl || null,
      updated_at: new Date().toISOString(),
    }),
    [keyboard, mediaUrl, messageType, parseMode, serializeMessagePayload],
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

  const openScreenInEditor = useCallback(
    (screenId: string) => {
      const screen = screenById.get(screenId);
      if (!screen) {
        toast.error("目标模版不存在");
        return false;
      }
      handleNavigateToScreen(screenId);
      applyScreenState(screen);
      return true;
    },
    [applyScreenState, handleNavigateToScreen, screenById],
  );

  const handlePreviewNavigateBack = useCallback(() => {
    const previousScreenId = navigationHistory[navigationHistory.length - 2];
    handleNavigateBack();
    if (!previousScreenId) return;
    const previousScreen = screenById.get(previousScreenId);
    if (previousScreen) {
      applyScreenState(previousScreen);
    }
  }, [applyScreenState, handleNavigateBack, navigationHistory, screenById]);

  const handleButtonClick = useCallback(
    (button: KeyboardButton) => {
      if (!isPreviewMode) return;
      if (button.linked_screen_id) {
        openScreenInEditor(button.linked_screen_id);
      } else if (button.url) {
        window.open(button.url, "_blank", "noopener,noreferrer");
      } else {
        toast.info(`Callback: ${button.callback_data}`);
      }
    },
    [isPreviewMode, openScreenInEditor]
  );

  // Offline queue helpers moved to useOfflineQueueSync

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
        // @ts-expect-error discriminated union narrowing issue
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
      keyboard: keyboard as unknown as Json,
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
          ...(savedScreen as unknown as Screen),
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

    const updatePayload = buildEditorScreenUpdatePayload();

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
  }, [buildEditorScreenUpdatePayload, currentScreenId, isOffline, keyboard, messageContent, queueUpdateOperation, serializeMessagePayload, setLastSavedSnapshot, updateScreen, user]);

  const handleSaveShortcut = useCallback(() => {
    if (currentScreenId) {
      void handleUpdateScreen();
      return;
    }
    void handleSaveScreen();
  }, [currentScreenId, handleSaveScreen, handleUpdateScreen]);

  useGlobalShortcuts({
    onUndo: undo,
    onRedo: redo,
    onSave: handleSaveShortcut,
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
    if (!currentScreenId || !user || isPreviewMode || isOffline || !hasUnsavedChanges) {
      return;
    }
    const timer = setTimeout(() => {
      void handleUpdateScreen();
    }, 2000);
    return () => clearTimeout(timer);
  }, [messageContent, keyboard, currentScreenId, user, isPreviewMode, isOffline, hasUnsavedChanges, handleUpdateScreen]);

  useEffect(() => {
    if (!isOffline) {
      void replayPendingQueue();
    }
  }, [isOffline, replayPendingQueue]);

  const openRenameDialog = useCallback(() => {
    if (currentScreenId) {
      if (currentScreen) {
        setRenameValue(currentScreen.name);
        setRenameDialogOpen(true);
      }
    }
  }, [currentScreen, currentScreenId]);

  const handleRenameScreen = useCallback(async () => {
    if (!currentScreenId || !renameValue.trim()) return;
    const updatePayload: TablesUpdate<"screens"> = { name: renameValue };

    if (isOffline) {
      queueUpdateOperation(updatePayload);
      setScreens((prev) =>
        prev.map((s) =>
          s.id === currentScreenId
            ? ({ ...s, name: renameValue } as Screen)
            : s,
        ),
      );
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
  }, [currentScreenId, isOffline, queueUpdateOperation, renameValue, updateScreen, setScreens]);

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
    if (!entryScreen) {
      toast.error("入口模版不存在，请重新选择");
      return null;
    }
    return entryScreen;
  }, [entryScreen, entryScreenId, screens]);

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
      const MAX_IMPORT_BYTES = 512 * 1024; // 防止极大文件拖垮页面
      setIsImporting(true);
      const importSize = new TextEncoder().encode(importJSON).length;
      if (importSize > MAX_IMPORT_BYTES) {
        throw new Error("导入文件过大（>512KB），请精简后重试");
      }
      const data = JSON.parse(importJSON) as ImportPayload;
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
        setParseMode(data.parse_mode === "MarkdownV2" ? "MarkdownV2" : "HTML");
      }
      const inlineKeyboard = Array.isArray(data.reply_markup?.inline_keyboard)
        ? (data.reply_markup?.inline_keyboard as ImportInlineKeyboard)
        : undefined;
      const internalKeyboard = data.keyboard;
      const nextKeyboard = inlineKeyboard ?? internalKeyboard;

      if (nextKeyboard) {
        const mapped = inlineKeyboard
          ? inlineKeyboard.map((row, rowIdx) => ({
            id: `import-row-${rowIdx}-${Date.now()}`,
            buttons: row.map((btn, btnIdx) => ({
              id: btn.id ?? `import-btn-${rowIdx}-${btnIdx}-${Date.now()}`,
              text: btn.text ?? "",
              url: btn.url,
              callback_data: btn.callback_data,
              linked_screen_id: btn.linked_screen_id,
            })),
          }))
          : (nextKeyboard as KeyboardRow[]);

        validateKeyboard(mapped);
        setKeyboard(cloneKeyboard(mapped));
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
      recordAuditEvent({
        action: "import_json",
        status: "success",
        userId: user?.id,
        targetId: currentScreenId ?? null,
        message: "Import dialog applied JSON",
      });
      toast.success("Imported successfully");
      setImportDialogOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid JSON";
      recordAuditEvent({
        action: "import_json",
        status: "error",
        userId: user?.id,
        targetId: currentScreenId ?? null,
        message: `Import failed: ${message}`,
      });
      toast.error(message);
    } finally {
      setIsImporting(false);
    }
  }, [currentScreenId, importJSON, setImportDialogOpen, setIsImporting, setKeyboard, setMediaUrl, setMessageContent, setMessageType, setParseMode, user?.id]);

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
      recordAuditEvent({
        action: "import_json",
        status: "success",
        userId: user?.id,
        targetId: currentScreenId ?? null,
        message: "Inline JSON applied",
      });
      toast.success("Applied JSON changes");
    } catch (e) {
      recordAuditEvent({
        action: "import_json",
        status: "error",
        userId: user?.id,
        targetId: currentScreenId ?? null,
        message: "Invalid inline JSON",
      });
      setJsonSyncError("Invalid JSON");
    }
  }, [currentScreenId, editableJSON, setKeyboard, setMediaUrl, setMessageContent, setMessageType, setParseMode, user?.id]);

  const handleCreateLink = useCallback((sourceId: string, targetId: string) => {
    let updatedKeyboard: KeyboardRow[] | null = null;
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
        updatedKeyboard = rows;
        return { ...s, keyboard: rows };
      });
      return next;
    });
    if (!updatedKeyboard || currentScreenId === sourceId) {
      return;
    }

    const updatePayload: TablesUpdate<"screens"> = {
      keyboard: updatedKeyboard as unknown as Json,
      updated_at: new Date().toISOString(),
    };

    if (isOffline) {
      queueUpdateOperation(updatePayload, sourceId);
      return;
    }

    void updateScreen({
      screenId: sourceId,
      update: updatePayload,
    }).catch((error) => {
      if (isNetworkError(error)) {
        queueUpdateOperation(updatePayload, sourceId);
        return;
      }
      console.error("Error saving flow link:", error);
      toast.error("关系图连线保存失败");
    });
  }, [currentScreenId, isOffline, messageContent, pushToHistory, queueUpdateOperation, setKeyboard, setScreens, updateScreen]);

  const generateShareToken = useCallback(() => {
    if (typeof crypto !== "undefined") {
      try {
        if (crypto.randomUUID) {
          return crypto.randomUUID();
        }
        if (crypto.getRandomValues) {
          const buf = new Uint8Array(16);
          crypto.getRandomValues(buf);
          return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
        }
      } catch (e) {
        console.error("生成分享 token 失败", e);
      }
    }
    throw new Error("当前环境不支持安全随机数，请使用现代浏览器（Chrome 89+、Firefox 95+、Safari 15+、Edge 89+）以生成分享链接");
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

  const buildShareUrl = useCallback((token: string) => buildAppUrl(`share/${token}`), []);

  const updateShareState = useCallback((updated: Screen) => {
    setScreens((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, [setScreens]);

  const withShareStatus = useCallback(
    async (
      message: string,
      op: () => Promise<Screen | null>,
      meta?: { action?: "share_publish" | "share_rotate" | "share_revoke"; targetId?: string },
    ) => {
      const requestId = makeRequestId();
      const pendingStatus = { state: "pending" as const, requestId, message };
      setShareLoading(true);
      setShareSyncStatus(pendingStatus);
      logSyncEvent("share", pendingStatus, { action: meta?.action ?? "share", targetId: meta?.targetId });
      try {
        const result = await op();
        const successStatus = { state: "success" as const, requestId, at: Date.now(), message: "已同步" };
        setShareSyncStatus(successStatus);
        logSyncEvent("share", successStatus, { action: meta?.action ?? "share", targetId: meta?.targetId });
        if (meta?.action) {
          recordAuditEvent({
            action: meta.action,
            status: "success",
            targetId: meta.targetId,
            userId: user?.id,
            requestId,
            message,
          });
        }
        return result;
      } catch (error) {
        const errorStatus = {
          state: "error" as const,
          requestId,
          message: error instanceof Error ? error.message : "分享失败",
        };
        setShareSyncStatus(errorStatus);
        logSyncEvent("share", errorStatus, { action: meta?.action ?? "share", targetId: meta?.targetId });
        if (meta?.action) {
          recordAuditEvent({
            action: meta.action,
            status: "error",
            targetId: meta.targetId,
            userId: user?.id,
            requestId,
            message: errorStatus.message,
          });
        }
        throw error;
      } finally {
        setShareLoading(false);
      }
    },
    [logSyncEvent, setShareLoading, setShareSyncStatus, user?.id],
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
    if (screenContainsSensitiveData(entry.message_content, entry.keyboard)) {
      toast.error("分享内容包含敏感信息，无法公开");
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
      }, { action: "share_publish", targetId: entry.id });
      const tokenToUse = result?.share_token ?? entry.share_token;
      if (!tokenToUse) {
        toast.error("未能生成分享链接");
        return;
      }
      const shareUrl = buildShareUrl(tokenToUse);
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(result && result !== entry ? "公开链接已创建并复制" : "链接已复制");
      } catch (copyError) {
        console.error("Clipboard write failed", copyError);
        toast.error("分享链接已生成，复制失败，请手动复制", { description: shareUrl });
      }
      completeOnboardingStep("share");
    } catch (error) {
      console.error("Error generating share link:", error);
      if (isSensitiveShareError(error)) {
        toast.error("分享内容包含敏感信息，无法公开");
        return;
      }
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
    if (screenContainsSensitiveData(entry.message_content, entry.keyboard)) {
      toast.error("分享内容包含敏感信息，无法公开");
      return;
    }
    const token = generateShareToken();
    try {
      const updated = await withShareStatus("刷新分享链接", async () => {
        const next = await dataAccess.rotateShareToken(entry.id, token) as unknown as Screen;
        updateShareState(next);
        return next;
      }, { action: "share_rotate", targetId: entry.id });
      const tokenToUse = updated?.share_token ?? token;
      const shareUrl = buildShareUrl(tokenToUse);
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("链接已刷新，旧链接已失效");
      } catch (copyError) {
        console.error("Clipboard write failed", copyError);
        toast.error("链接已刷新，复制失败，请手动复制", { description: shareUrl });
      }
      completeOnboardingStep("share");
    } catch (error) {
      console.error("Error rotating share link:", error);
      if (isSensitiveShareError(error)) {
        toast.error("分享内容包含敏感信息，无法公开");
        return;
      }
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
      }, { action: "share_revoke", targetId: entry.id });
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

  const [pendingItemsRaw, setPendingItemsRaw] = useState(() => readPendingOps(user?.id));
  const pendingQueueSizeRef = useRef(pendingQueueSize);
  const pendingQueueUserRef = useRef(user?.id);
  const pendingQueueVersionRef = useRef(pendingQueueVersion);

  useEffect(() => {
    const previousSize = pendingQueueSizeRef.current;
    const previousUserId = pendingQueueUserRef.current;
    const previousVersion = pendingQueueVersionRef.current;

    if (previousSize !== pendingQueueSize || previousUserId !== user?.id || previousVersion !== pendingQueueVersion) {
      setPendingItemsRaw(readPendingOps(user?.id));
    }

    pendingQueueSizeRef.current = pendingQueueSize;
    pendingQueueUserRef.current = user?.id;
    pendingQueueVersionRef.current = pendingQueueVersion;
  }, [pendingQueueSize, pendingQueueVersion, user?.id]);
  const pendingItems = useShallowMemo(pendingItemsRaw);
  const pendingItemsCount = pendingItems.length;

  const builderStatus = useMemo(() => ({
    isOnline: !isOffline,
    pendingCount: pendingItemsCount,
    unsaved: hasUnsavedChanges,
    lastSavedAt: lastSavedSnapshot?.messageContent ? "刚刚" : null,
  }), [hasUnsavedChanges, isOffline, lastSavedSnapshot?.messageContent, pendingItemsCount]);

  const handleLoadScreen = useCallback(
    (id: string) => {
      openScreenInEditor(id);
    },
    [openScreenInEditor],
  );

  const handleDeleteAllScreens = useCallback(async () => {
    try {
      setIsClearingScreens(true);
      await deleteAllScreens();
    } finally {
      setIsClearingScreens(false);
    }
  }, [deleteAllScreens]);

  const handleSetEntrySelection = useCallback(
    (id: string | null) => handleSetEntry(id),
    [handleSetEntry],
  );

  const handleJumpToEntryPanel = useCallback(() => {
    const entry = resolveEntryScreen();
    if (entry) {
      handleNavigateToScreen(entry.id);
      applyScreenState(entry);
    }
  }, [applyScreenState, handleNavigateToScreen, resolveEntryScreen]);

  const handleOpenImport = useCallback(() => setImportDialogOpen(true), [setImportDialogOpen]);
  const handleOpenFlowDiagram = useCallback(() => setFlowDiagramOpen(true), [setFlowDiagramOpen]);

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
    onLoadScreen: handleLoadScreen,
    onNewScreen: createNewScreen,
    onSaveScreen: handleSaveScreen,
    onUpdateScreen: handleUpdateScreen,
    onDeleteScreen: deleteScreen,
    onDeleteAllScreens: handleDeleteAllScreens,
    onTogglePin: handleTogglePin,
    onSetEntry: handleSetEntrySelection,
    onJumpToEntry: handleJumpToEntryPanel,
    onCopyOrShare: handleCopyOrShare,
    onRotateShareLink: handleRotateShareLink,
    onUnshareScreen: handleUnshareScreen,
    onOpenImport: handleOpenImport,
    onCopyJSON: handleCopyJSON,
    onExportJSON: handleExportJSON,
    onExportFlow: exportFlowAsJSON,
    onOpenFlowDiagram: handleOpenFlowDiagram,
  }), [
    createNewScreen,
    currentScreenId,
    deleteScreen,
    entryScreenId,
    exportFlowAsJSON,
    handleCopyJSON,
    handleCopyOrShare,
    handleExportJSON,
    handleLogout,
    handleLoadScreen,
    handleDeleteAllScreens,
    handleRotateShareLink,
    handleSetEntrySelection,
    handleJumpToEntryPanel,
    handleUnshareScreen,
    handleSaveScreen,
    handleUpdateScreen,
    handleTogglePin,
    handleOpenImport,
    handleOpenFlowDiagram,
    hasUnsavedChanges,
    isClearingScreens,
    isLoading,
    isOffline,
    pinnedIds,
    screens,
    shareLoading,
    user,
  ]);

  const workbenchStatusProps = useMemo(
    () => ({
      pendingCount: builderStatus.pendingCount,
      unsaved: builderStatus.unsaved,
      lastSavedAt: builderStatus.lastSavedAt,
      isOnline: builderStatus.isOnline,
    }),
    [builderStatus]
  );

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
    onNavigateBack: handlePreviewNavigateBack,
    currentScreenName,
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
    handlePreviewNavigateBack,
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
    currentScreenName,
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

  const buttonEditorDialog = useMemo(() => ({
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
      const screen = screenById.get(screenId);
      if (!openScreenInEditor(screenId)) return;
      toast.success(`✅ 已跳转到: ${screen?.name ?? "Unknown"}`);
    },
    onCreateAndOpen: () => {
      createNewScreen();
      toast.info("🆕 已创建新模版，请先保存以便可被链接");
    },
  }), [
    buttonEditDialogOpen,
    createNewScreen,
    editingButtonData,
    handleButtonUpdate,
    openScreenInEditor,
    screens,
    screenById,
    setButtonEditDialogOpen,
    setEditingButtonData,
  ]);

  const importDialogState = useMemo(() => ({
    open: importDialogOpen,
    setOpen: setImportDialogOpen,
    importJSON,
    setImportJSON,
    isImporting,
    onImport: handleImportJSON,
    fileInputRef,
    onFileSelect: handleImportFileSelect,
  }), [fileInputRef, handleImportFileSelect, handleImportJSON, importDialogOpen, importJSON, isImporting, setImportDialogOpen, setImportJSON]);

  const renameDialogState = useMemo(() => ({
    open: renameDialogOpen,
    setOpen: setRenameDialogOpen,
    value: renameValue,
    setValue: setRenameValue,
    onSave: handleRenameScreen,
  }), [handleRenameScreen, renameDialogOpen, renameValue, setRenameDialogOpen, setRenameValue]);

  const flowDiagramDialog = useMemo(() => ({
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
      const screen = screenById.get(screenId);
      if (!openScreenInEditor(screenId)) return;
      toast.success(`✅ 已跳转到: ${screen?.name ?? "Unknown"}`);
    },
    onSetEntry: handleSetEntry,
    onDeleteScreen: deleteScreen,
  }), [
    currentScreenId,
    deleteScreen,
    entryScreenId,
    flowDiagramOpen,
    handleCreateLink,
    handleSetEntry,
    openScreenInEditor,
    pinnedIds,
    screenById,
    screens,
    setLayoutSyncStatus,
    setFlowDiagramOpen,
    user?.id,
  ]);

  const circularPathsMemo = useMemo(
    () => detectedCircularPaths.map((path) => ({
      path,
      screenNames: path.map((id) => screenById.get(id)?.name || "Unknown"),
    })),
    [detectedCircularPaths, screenById],
  );

  const circularDialogState = useMemo(() => ({
    open: circularDialogOpen,
    setOpen: setCircularDialogOpen,
    circularPaths: circularPathsMemo,
    screens,
    currentScreenId,
    onNavigateToScreen: (screenId: string) => {
      const screen = screenById.get(screenId);
      if (!openScreenInEditor(screenId)) return;
      toast.success(`✅ 已跳转到: ${screen?.name ?? "Unknown"}`);
    },
    onOpenFlowDiagram: () => {
      setCircularDialogOpen(false);
      setFlowDiagramOpen(true);
    },
  }), [
    circularDialogOpen,
    circularPathsMemo,
    currentScreenId,
    openScreenInEditor,
    screenById,
    screens,
    setCircularDialogOpen,
    setFlowDiagramOpen,
  ]);

  const templateLibraryState = useMemo(() => ({
    open: templateLibraryOpen,
    setOpen: setTemplateLibraryOpen,
    onApply: handleApplyTemplate,
  }), [handleApplyTemplate, setTemplateLibraryOpen, templateLibraryOpen]);

  const onboardingState = useMemo(() => ({
    visible: onboardingVisible,
    progress: onboardingProgress,
    onDismiss: dismissOnboarding,
    onOpenTemplate: () => setTemplateLibraryOpen(true),
    onTogglePreview: togglePreviewMode,
    onShare: handleCopyJSON,
  }), [dismissOnboarding, handleCopyJSON, onboardingProgress, onboardingVisible, setTemplateLibraryOpen, togglePreviewMode]);

  const dialogState = useMemo(() => ({
    buttonEditor: buttonEditorDialog,
    importDialog: importDialogState,
    renameDialog: renameDialogState,
    flowDiagram: flowDiagramDialog,
    circularDialog: circularDialogState,
    templateLibrary: templateLibraryState,
    onboarding: onboardingState,
  }), [
    buttonEditorDialog,
    circularDialogState,
    flowDiagramDialog,
    importDialogState,
    onboardingState,
    renameDialogState,
    templateLibraryState,
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
