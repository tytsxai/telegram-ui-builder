import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import type { User } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MessageBubbleHandle } from "./MessageBubble";
import ButtonEditDialog from "./ButtonEditDialog";
// Lazy load heavy components
const TemplateFlowDiagram = lazy(() => import("./TemplateFlowDiagram"));
const CircularReferenceDialog = lazy(() => import("./CircularReferenceDialog"));
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { KeyboardRow, KeyboardButton, Screen } from "@/types/telegram";
import { WorkbenchLayout } from "./workbench/WorkbenchLayout";
import { SidebarLeft } from "./workbench/SidebarLeft";
import { SidebarRight } from "./workbench/SidebarRight";
import { CenterCanvas } from "./workbench/CenterCanvas";
import { BottomPanel } from "./workbench/BottomPanel";
import { useChatState } from "@/hooks/chat/useChatState";
import { useSupabaseSync } from "@/hooks/chat/useSupabaseSync";
import { useKeyboardActions } from "@/hooks/chat/useKeyboardActions";
import { useScreenNavigation } from "@/hooks/chat/useScreenNavigation";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { validateKeyboard, validateMessageContent } from "@/lib/validation";
import {
  findScreenReferences,
  detectCircularReferences,
  findAllCircularReferences
} from "@/lib/referenceChecker";
import {
  readPendingOps,
  processPendingOps,
  enqueueSaveOperation,
  enqueueUpdateOperation,
  clearPendingOps,
} from "@/lib/pendingQueue";
import type { Json, TablesUpdate } from "@/integrations/supabase/types";

// Helper functions (kept for compatibility)
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

const TelegramChatWithDB = () => {
  const navigate = useNavigate();
  const messageBubbleRef = useRef<MessageBubbleHandle>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queuedToastShownRef = useRef(false);
  const [user, setUser] = useState<User | null>(null);
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
  const [buttonEditDialogOpen, setButtonEditDialogOpen] = useState(false);
  const [editingButtonData, setEditingButtonData] = useState<{ rowId: string; buttonId: string; button: KeyboardButton } | null>(null);
  const [pendingOpsNotice, setPendingOpsNotice] = useState(false);
  const [retryingQueue, setRetryingQueue] = useState(false);
  const [jsonSyncError, setJsonSyncError] = useState<string | null>(null);
  const [isClearingScreens, setIsClearingScreens] = useState(false);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<{ messageContent: string; keyboard: KeyboardRow[] } | null>(null);
  const [codegenFramework, setCodegenFramework] = useState<"python-telegram-bot" | "aiogram" | "telegraf">("python-telegram-bot");

  // Custom Hooks
  const isOffline = useNetworkStatus();

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
  } = useChatState();

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
    dataAccess
  } = useSupabaseSync(user);

  const refreshPendingQueueSize = useCallback(() => {
    const size = readPendingOps(user?.id).length;
    setPendingQueueSize(size);
    setPendingOpsNotice(size > 0);
    if (size === 0) {
      queuedToastShownRef.current = false;
    }
  }, [setPendingQueueSize, user?.id]);

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

  useEffect(() => {
    refreshPendingQueueSize();
  }, [refreshPendingQueueSize]);

  // Auth Effect
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load Screens Effect
  useEffect(() => {
    if (user) {
      loadScreens();
    }
  }, [user, loadScreens]);

  // Handlers
  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const applyScreenState = useCallback((screen: Screen) => {
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
  }, [loadMessagePayload, setParseMode, setMessageType, setMediaUrl, setKeyboard, setLastSavedSnapshot, setCurrentScreenId]);

  const handleButtonClick = (button: KeyboardButton, rowId: string) => {
    if (isPreviewMode) {
      if (button.linked_screen_id) {
        handleNavigateToScreen(button.linked_screen_id);
      } else if (button.url) {
        window.open(button.url, "_blank");
      } else {
        toast.info(`Callback: ${button.callback_data}`);
      }
    } else {
      setEditingButtonData({ rowId, buttonId: button.id, button });
      setButtonEditDialogOpen(true);
    }
  };

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

  const handleSaveScreen = async () => {
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
  };

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
    // Initialize snapshot once to avoid showing "unsaved" on first render
    if (!lastSavedSnapshot) {
      setLastSavedSnapshot({
        messageContent,
        keyboard: JSON.parse(JSON.stringify(keyboard)),
      });
    }
  }, [lastSavedSnapshot, messageContent, keyboard]);

  // Auto-save effect (simplified)
  useEffect(() => {
    if (currentScreenId && user && !isPreviewMode) {
      const timer = setTimeout(() => {
        handleUpdateScreen();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [messageContent, keyboard, currentScreenId, user, isPreviewMode, handleUpdateScreen]);

  useEffect(() => {
    if (!isOffline) {
      void replayPendingQueue();
    }
  }, [isOffline, replayPendingQueue]);

  const openRenameDialog = () => {
    if (currentScreenId) {
      const screen = screens.find(s => s.id === currentScreenId);
      if (screen) {
        setRenameValue(screen.name);
        setRenameDialogOpen(true);
      }
    }
  };

  const handleRenameScreen = async () => {
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
  };

  const handleCopyJSON = () => {
    navigator.clipboard.writeText(editableJSON);
    toast.success("JSON copied to clipboard");
  };

  const handleExportJSON = () => {
    const blob = new Blob([editableJSON], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "telegram-keyboard.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportFlowAsJSON = () => {
    const flow = {
      version: "1.0",
      entry_screen_id: entryScreenId,
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
  };

  const handleImportJSON = async () => {
    try {
      setIsImporting(true);
      const data = JSON.parse(importJSON);
      // Basic import logic - just setting state for now
      // Real import might involve parsing Telegram format or Flow format
      // For now, assuming Telegram format for single screen
      if (data.text) setMessageContent(data.text);
      // Keyboard parsing logic would go here (using buildKeyboardFromTelegram helper if available)
      toast.success("Imported successfully");
      setImportDialogOpen(false);
    } catch (e) {
      toast.error("Invalid JSON");
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setImportJSON(e.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleApplyEditedJSON = () => {
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
  };

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

  const generateCode = useCallback((framework: typeof codegenFramework) => {
    const escapeStr = (val: string) => val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const payload = convertToTelegramFormat();
    type ExportPayload = ReturnType<typeof convertToTelegramFormat>;
    type ExportInlineKeyboard = NonNullable<ExportPayload["reply_markup"]>["inline_keyboard"];
    const kb: ExportInlineKeyboard = payload.reply_markup?.inline_keyboard ?? [];
    const buildPythonInlineKeyboard = () =>
      kb
        .map(
          (row) =>
            "    [" +
            row
              .map((btn) => {
                const action = btn.url ? `url="${escapeStr(btn.url)}"` : `callback_data="${escapeStr(btn.callback_data || "")}"`;
                return `InlineKeyboardButton(text="${escapeStr(btn.text)}", ${action})`;
              })
              .join(", ") +
            "]"
        )
        .join("\n");
    const buildTelegrafKeyboard = () => {
      if (!kb.length) return "Markup.inlineKeyboard([])";
      const rows = kb
        .map(
          (row) =>
            "[" +
            row
              .map((btn) => {
                const actionValue = btn.url ? `"${escapeStr(btn.url)}"` : `"${escapeStr(btn.callback_data || "")}"`;
                return `Markup.button.${btn.url ? "url" : "callback"}("${escapeStr(btn.text)}", ${actionValue})`;
              })
              .join(", ") +
            "]"
        )
        .join(",\n    ");
      return `Markup.inlineKeyboard([\n    ${rows}\n  ])`;
    };

    const captionRaw = "text" in payload ? payload.text : payload.caption || "";
    const mediaRaw = "photo" in payload ? payload.photo : "video" in payload ? payload.video : null;
    const caption = escapeStr(captionRaw);
    const media = mediaRaw ? escapeStr(mediaRaw) : null;
    const parseMode = payload.parse_mode;

    if (framework === "python-telegram-bot") {
      const pythonKeyboard = kb.length ? `[\n${buildPythonInlineKeyboard()}\n    ]` : "[]";

      return `from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup\nfrom telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, ContextTypes\n\nasync def start(update: Update, context: ContextTypes.DEFAULT_TYPE):\n    keyboard = ${pythonKeyboard}\n    markup = InlineKeyboardMarkup(keyboard)\n    ${media ? `await update.message.reply_${messageType === "photo" ? "photo" : "video"}("${media}", caption="${caption}", parse_mode="${parseMode}", reply_markup=markup)` : `await update.message.reply_text("${caption}", parse_mode="${parseMode}", reply_markup=markup)`}\n\nasync def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):\n    query = update.callback_query\n    await query.answer()\n    await query.edit_message_text(text="Received: " + (query.data or ""))\n\napp = ApplicationBuilder().token("<BOT_TOKEN>").build()\napp.add_handler(CommandHandler("start", start))\napp.add_handler(CallbackQueryHandler(on_callback))\napp.run_polling()\n`;
    }
    if (framework === "aiogram") {
      const aiogramKeyboard = kb.length ? `InlineKeyboardMarkup(inline_keyboard=[\n${buildPythonInlineKeyboard()}\n    ])` : "InlineKeyboardMarkup(inline_keyboard=[])";

      return `from aiogram import Bot, Dispatcher, F\nfrom aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, Message, CallbackQuery\nfrom aiogram.filters import Command\nfrom aiogram.enums import ParseMode\nfrom aiogram import Router\n\nrouter = Router()\n\n@router.message(Command("start"))\nasync def cmd_start(message: Message):\n    kb = ${aiogramKeyboard}\n    ${media ? `await message.answer_${messageType === "photo" ? "photo" : "video"}("${media}", caption="${caption}", parse_mode=ParseMode.${parseMode === "HTML" ? "HTML" : "MARKDOWN_V2"}, reply_markup=kb)` : `await message.answer("${caption}", parse_mode=ParseMode.${parseMode === "HTML" ? "HTML" : "MARKDOWN_V2"}, reply_markup=kb)`}\n\n@router.callback_query()\nasync def on_callback(query: CallbackQuery):\n    await query.answer("Received: " + (query.data or ""))\n\nbot = Bot(token="<BOT_TOKEN>", parse_mode=ParseMode.${parseMode === "HTML" ? "HTML" : "MARKDOWN_V2"})\ndp = Dispatcher()\ndp.include_router(router)\ndp.run_polling(bot)\n`;
    }

    const telegrafKeyboard = buildTelegrafKeyboard();

    return `const { Telegraf, Markup } = require("telegraf");\nconst bot = new Telegraf(process.env.BOT_TOKEN);\n\nbot.start((ctx) => {\n  const keyboard = ${telegrafKeyboard};\n  ${media ? `ctx.replyWith${messageType === "photo" ? "Photo" : "Video"}("${media}", { caption: "${caption}", parse_mode: "${parseMode}", reply_markup: keyboard.reply_markup });` : `ctx.reply("${caption}", { parse_mode: "${parseMode}", reply_markup: keyboard.reply_markup });`}\n});\n\nbot.on("callback_query", (ctx) => ctx.answerCbQuery("Received: " + (ctx.callbackQuery?.data || "")));\n\nbot.launch();\n`;
  }, [convertToTelegramFormat, messageType]);

  const codegenOutput = useMemo(() => generateCode(codegenFramework), [generateCode, codegenFramework]);

  const generateShareToken = () => {
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
  };

  const handleCopyOrShare = async (screenId: string) => {
    if (!user) return;
    const screen = screens.find(s => s.id === screenId);
    if (!screen) return;

    if (screen.is_public && screen.share_token) {
      const url = `${window.location.origin}/share/${screen.share_token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } else {
      // Enable sharing
      const token = generateShareToken();
      await updateScreen({
        screenId,
        update: { is_public: true, share_token: token }
      });
      const url = `${window.location.origin}/share/${token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Public link created and copied");
    }
  };

  const handleCopyCodegen = async () => {
    try {
      await navigator.clipboard.writeText(codegenOutput);
      toast.success("代码已复制");
    } catch (e) {
      toast.error("复制失败");
    }
  };

  const handleRotateShareLink = async (screenId: string) => {
    const token = generateShareToken();
    await updateScreen({
      screenId,
      update: { share_token: token }
    });
    toast.success("Link rotated");
  };

  const handleUnshareScreen = async (screenId: string) => {
    await updateScreen({
      screenId,
      update: { is_public: false, share_token: null }
    });
    toast.success("Screen unshared");
  };

  const handleFormatClick = (format: 'bold' | 'italic' | 'code' | 'link') => {
    if (format === "link") {
      const url = prompt("输入链接 (https://...)");
      if (url) {
        messageBubbleRef.current?.applyFormat("link", url);
      }
    } else {
      messageBubbleRef.current?.applyFormat(format);
    }
    messageBubbleRef.current?.focus();
  };

  const loadIssue = null; // Placeholder
  const circularReferences = []; // Placeholder

  const hasUnsavedChanges = !!lastSavedSnapshot && (
    lastSavedSnapshot.messageContent !== serializeMessagePayload() ||
    JSON.stringify(lastSavedSnapshot.keyboard) !== JSON.stringify(keyboard)
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <WorkbenchLayout
        leftPanel={
          <SidebarLeft
            user={user}
            screens={screens}
            currentScreenId={currentScreenId}
            entryScreenId={entryScreenId}
            pinnedIds={pinnedIds}
            isLoading={isLoading}
            isClearingScreens={isClearingScreens}
            shareLoading={shareLoading}
            hasUnsavedChanges={hasUnsavedChanges}
            isOffline={isOffline}
            onLogout={handleLogout}
            onLoadScreen={(id) => {
              handleNavigateToScreen(id);
              // Also load content into editor
              const screen = screens.find(s => s.id === id);
              if (screen) {
                applyScreenState(screen);
              }
            }}
            onNewScreen={createNewScreen}
            onSaveScreen={handleSaveScreen}
            onUpdateScreen={handleUpdateScreen}
            onDeleteScreen={deleteScreen}
            onDeleteAllScreens={deleteAllScreens}
            onTogglePin={handleTogglePin}
            onSetEntry={handleSetEntry}
            onJumpToEntry={handleJumpToEntry}
            onCopyOrShare={handleCopyOrShare}
            onRotateShareLink={handleRotateShareLink}
            onUnshareScreen={handleUnshareScreen}
            onOpenImport={() => setImportDialogOpen(true)}
            onCopyJSON={handleCopyJSON}
            onExportJSON={handleExportJSON}
            onExportFlow={exportFlowAsJSON}
            onOpenFlowDiagram={() => setFlowDiagramOpen(true)}
          />
        }
        rightPanel={
          <SidebarRight
            newScreenName={newScreenName}
            onNewScreenNameChange={setNewScreenName}
            onFormatClick={handleFormatClick}
            parseMode={parseMode}
            onParseModeChange={setParseMode}
            messageType={messageType}
            mediaUrl={mediaUrl}
            onMessageTypeChange={setMessageType}
            onMediaUrlChange={setMediaUrl}
            onAddButton={handleAddButton}
            onAddRow={handleAddRow}
            allowCircular={allowCircular}
            onAllowCircularChange={setAllowCircular}
            isOffline={isOffline}
            currentScreenId={currentScreenId}
            onOpenRenameDialog={openRenameDialog}
          />
        }
        centerCanvas={
          <CenterCanvas
            messageContent={messageContent}
            setMessageContent={setMessageContent}
            keyboard={keyboard}
            parseMode={parseMode}
            onParseModeChange={setParseMode}
            messageType={messageType}
            mediaUrl={mediaUrl}
            onMessageTypeChange={setMessageType}
            onMediaUrlChange={setMediaUrl}
            onButtonTextChange={handleButtonTextChange}
            onButtonUpdate={handleButtonUpdate}
            onDeleteButton={handleDeleteButton}
            onButtonClick={handleButtonClick}
            onKeyboardReorder={handleReorder}
            isPreviewMode={isPreviewMode}
            onToggleMode={() => setIsPreviewMode(!isPreviewMode)}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            messageBubbleRef={messageBubbleRef}
            screens={screens}
            navigationHistory={navigationHistory}
            onNavigateBack={handleNavigateBack}
            currentScreenName={screens.find(s => s.id === currentScreenId)?.name}
            hasUnsavedChanges={hasUnsavedChanges}
            isOffline={isOffline}
            shareSyncStatus={shareSyncStatus}
            layoutSyncStatus={layoutSyncStatus}
            pendingQueueSize={pendingQueueSize}
          />
        }
        bottomPanel={
          <BottomPanel
            editableJSON={editableJSON}
            onEditableJSONChange={setEditableJSON}
            onApplyJSON={handleApplyEditedJSON}
            jsonSyncError={jsonSyncError}
            isImporting={isImporting}
            loadIssue={loadIssue}
            circularReferences={circularReferences}
            allowCircular={allowCircular}
            pendingOpsNotice={pendingOpsNotice}
            pendingQueueSize={pendingQueueSize}
            retryingQueue={retryingQueue}
            isOffline={isOffline}
            onRetryPendingOps={replayPendingQueue}
            onClearPendingOps={clearPendingQueue}
            codegenFramework={codegenFramework}
            onCodegenFrameworkChange={setCodegenFramework}
            codegenOutput={codegenOutput}
            onCopyCodegen={handleCopyCodegen}
          />
        }
      />

      {/* Dialogs */}
      {editingButtonData && (
        <ButtonEditDialog
          open={buttonEditDialogOpen}
          onOpenChange={setButtonEditDialogOpen}
          button={editingButtonData.button}
          onSave={(updatedButton) => {
            handleButtonUpdate(
              editingButtonData.rowId,
              editingButtonData.buttonId,
              updatedButton
            );
            setButtonEditDialogOpen(false);
            setEditingButtonData(null);
          }}
          screens={screens}
          onOpenScreen={(screenId) => {
            handleNavigateToScreen(screenId);
            const screen = screens.find(s => s.id === screenId);
            if (screen) {
              applyScreenState(screen);
            }
            toast.success(`✅ 已跳转到: ${screens.find(s => s.id === screenId)?.name}`);
          }}
          onCreateAndOpenScreen={() => {
            createNewScreen();
            toast.info('🆕 已创建新模版，请先保存以便可被链接');
          }}
        />
      )}

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>导入 Telegram JSON</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="import-json">粘贴 JSON 数据</Label>
              <Textarea
                id="import-json"
                value={importJSON}
                onChange={(e) => setImportJSON(e.target.value)}
                placeholder='{"text":"Hello","parse_mode":"HTML","reply_markup":{"inline_keyboard":[[{"text":"Button","callback_data":"action"}]]}}'
                rows={10}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                disabled={isImporting}
                onChange={handleImportFileSelect}
              />
              <Button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                className="w-full sm:w-auto"
                disabled={isImporting}
              >
                {isImporting ? "处理中..." : "选择 JSON 文件"}
              </Button>
              <p className="text-xs text-muted-foreground sm:text-right">
                支持直接选择从本工具导出的 JSON 文件
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleImportJSON}
              disabled={isImporting || !importJSON.trim()}
            >
              {isImporting ? "导入中..." : "导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>重命名模版</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rename">新名称</Label>
              <Input
                id="rename"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleRenameScreen}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Suspense fallback={null}>
        <TemplateFlowDiagram
          screens={screens}
          currentScreenId={currentScreenId}
          open={flowDiagramOpen}
          onOpenChange={setFlowDiagramOpen}
          userId={user?.id || undefined}
          onLayoutSync={setLayoutSyncStatus}
          onCreateLink={handleCreateLink}
          onScreenClick={(screenId) => {
            handleNavigateToScreen(screenId);
            const screen = screens.find(s => s.id === screenId);
            if (screen) {
              applyScreenState(screen);
            }
            toast.success(`✅ 已跳转到: ${screens.find(s => s.id === screenId)?.name}`);
          }}
          onSetEntry={handleSetEntry}
          onDeleteScreen={deleteScreen}
        />

        <CircularReferenceDialog
          open={circularDialogOpen}
          onOpenChange={setCircularDialogOpen}
          circularPaths={detectedCircularPaths}
          screens={screens}
          currentScreenId={currentScreenId}
          onNavigateToScreen={(screenId) => {
            handleNavigateToScreen(screenId);
            const screen = screens.find(s => s.id === screenId);
            if (screen) {
              applyScreenState(screen);
            }
            toast.success(`✅ 已跳转到: ${screens.find(s => s.id === screenId)?.name}`);
          }}
          onOpenFlowDiagram={() => {
            setCircularDialogOpen(false);
            setFlowDiagramOpen(true);
          }}
        />
      </Suspense>
    </div>
  );
};

export default TelegramChatWithDB;
