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
import { readPendingOps, processPendingOps } from "@/lib/pendingQueue";

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

const TelegramChatWithDB = () => {
  const navigate = useNavigate();
  const messageBubbleRef = useRef<MessageBubbleHandle>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  }, [loadMessagePayload, setParseMode, setMessageType, setMediaUrl]);

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
      const savedScreen = await saveScreen({
        user_id: user.id,
        name: newScreenName,
        message_content: serializeMessagePayload(),
        keyboard: keyboard as any,
      });
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
      }
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleUpdateScreen = async () => {
    if (!currentScreenId || !user) return;

    try {
      await updateScreen({
        screenId: currentScreenId,
        update: {
          message_content: serializeMessagePayload(),
          keyboard: keyboard as any,
          updated_at: new Date().toISOString(),
        }
      });
      setLastSavedSnapshot({
        messageContent: serializeMessagePayload(),
        keyboard: cloneKeyboard(keyboard),
      });
      toast.success("Screen updated");
    } catch (error) {
      // Error handled in hook
    }
  };

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
  }, [messageContent, keyboard, currentScreenId, user, isPreviewMode]);

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
    await updateScreen({
      screenId: currentScreenId,
      update: { name: renameValue }
    });
    setRenameDialogOpen(false);
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
      const data = JSON.parse(editableJSON);
      if (typeof data !== "object" || data === null) {
        throw new Error("Invalid JSON structure");
      }

      const nextMessage =
        typeof data.text === "string"
          ? data.text
          : typeof (data as { message_content?: string }).message_content === "string"
            ? (data as { message_content: string }).message_content
            : null;

      if (nextMessage) {
        validateMessageContent(nextMessage);
        setMessageContent(nextMessage);
      }

      if (typeof (data as any).parse_mode === "string") {
        const mode = (data as any).parse_mode === "MarkdownV2" ? "MarkdownV2" : "HTML";
        setParseMode(mode);
      }

      const inlineKeyboard = (data as any).reply_markup?.inline_keyboard;
      const internalKeyboard = (data as any).keyboard;
      const nextKeyboard = inlineKeyboard ?? internalKeyboard;

      if (nextKeyboard) {
        if (inlineKeyboard) {
          const mapped: KeyboardRow[] = inlineKeyboard.map((row: any[], rowIdx: number) => ({
            id: `row-${rowIdx}-${Date.now()}`,
            buttons: row.map((btn, btnIdx) => ({
              id: btn.id ?? `btn-${rowIdx}-${btnIdx}-${Date.now()}`,
              text: btn.text ?? "",
              url: btn.url,
              callback_data: btn.callback_data,
              linked_screen_id: btn.linked_screen_id,
            })),
          }));
          validateKeyboard(mapped);
          setKeyboard(mapped);
        } else {
          validateKeyboard(nextKeyboard);
          setKeyboard(() => JSON.parse(JSON.stringify(nextKeyboard)) as KeyboardRow[]);
        }
      }

      if (typeof (data as any).photo === "string") {
        setMessageType("photo");
        setMediaUrl((data as any).photo);
      } else if (typeof (data as any).video === "string") {
        setMessageType("video");
        setMediaUrl((data as any).video);
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
  }, [currentScreenId, pushToHistory, messageContent, setKeyboard]);

  const generateCode = useCallback((framework: typeof codegenFramework) => {
    const escapeStr = (val: string) => val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const payload = convertToTelegramFormat();
    const kb = (payload as any).reply_markup?.inline_keyboard ?? [];
    const buildButtons = () =>
      kb
        .map(
          (row: any[]) =>
            "[" +
            row
              .map((btn: any) => {
                const action = btn.url ? `url="${escapeStr(btn.url)}"` : `callback_data="${escapeStr(btn.callback_data)}"`;
                return `{ text: "${escapeStr(btn.text)}", ${action} }`;
              })
              .join(", ") +
            "]"
        )
        .join(",\n    ");

    const captionRaw = "text" in payload ? (payload as any).text : (payload as any).caption || "";
    const mediaRaw = "photo" in payload ? (payload as any).photo : "video" in payload ? (payload as any).video : null;
    const caption = escapeStr(captionRaw);
    const media = mediaRaw ? escapeStr(mediaRaw) : null;
    const parseMode = (payload as any).parse_mode || "HTML";

    if (framework === "python-telegram-bot") {
      return `from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup\nfrom telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, ContextTypes\n\nasync def start(update: Update, context: ContextTypes.DEFAULT_TYPE):\n    keyboard = [\n    ${buildButtons()}\n    ]\n    markup = InlineKeyboardMarkup(keyboard)\n    ${media ? `await update.message.reply_${messageType === "photo" ? "photo" : "video"}("${media}", caption="${caption}", parse_mode="${parseMode}", reply_markup=markup)` : `await update.message.reply_text("${caption}", parse_mode="${parseMode}", reply_markup=markup)`}\n\nasync def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):\n    query = update.callback_query\n    await query.answer()\n    await query.edit_message_text(text="Received: " + (query.data or ""))\n\napp = ApplicationBuilder().token(\"<BOT_TOKEN>\").build()\napp.add_handler(CommandHandler(\"start\", start))\napp.add_handler(CallbackQueryHandler(on_callback))\napp.run_polling()\n`;
    }
    if (framework === "aiogram") {
      return `from aiogram import Bot, Dispatcher, F\nfrom aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, Message, CallbackQuery\nfrom aiogram.filters import Command\nfrom aiogram.enums import ParseMode\nfrom aiogram import Router\n\nrouter = Router()\n\n@router.message(Command(\"start\"))\nasync def cmd_start(message: Message):\n    kb = InlineKeyboardMarkup(inline_keyboard=[\n    ${buildButtons()}\n    ])\n    ${media ? `await message.answer_${messageType === "photo" ? "photo" : "video"}("${media}", caption="${caption}", parse_mode=ParseMode.${parseMode === "HTML" ? "HTML" : "MARKDOWN_V2"}, reply_markup=kb)` : `await message.answer("${caption}", parse_mode=ParseMode.${parseMode === "HTML" ? "HTML" : "MARKDOWN_V2"}, reply_markup=kb)`}\n\n@router.callback_query()\nasync def on_callback(query: CallbackQuery):\n    await query.answer(\"Received: \" + (query.data or \"\"))\n\nbot = Bot(token=\"<BOT_TOKEN>\", parse_mode=ParseMode.${parseMode === "HTML" ? "HTML" : "MARKDOWN_V2"})\ndp = Dispatcher()\ndp.include_router(router)\ndp.run_polling(bot)\n`;
    }

    return `const { Telegraf, Markup } = require(\"telegraf\");\nconst bot = new Telegraf(process.env.BOT_TOKEN);\n\nbot.start((ctx) => {\n  const keyboard = ${kb.length ? "Markup.inlineKeyboard([\n    " + kb.map((row: any[]) => "[" + row.map((btn: any) => `Markup.button.${btn.url ? "url" : "callback"}(\"${btn.text}\", ${btn.url ? `"${btn.url}"` : `"${btn.callback_data}"`})`).join(", ") + "]`).join(",\n    ") + "\n  ])" : "Markup.inlineKeyboard([])"};\n  ${media ? `ctx.replyWith${messageType === "photo" ? "Photo" : "Video"}(\"${media}\", { caption: \"${caption}\", parse_mode: \"${parseMode}\", reply_markup: keyboard.reply_markup });` : `ctx.reply(\"${caption}\", { parse_mode: \"${parseMode}\", reply_markup: keyboard.reply_markup });`}\n});\n\nbot.on(\"callback_query\", (ctx) => ctx.answerCbQuery(\"Received: \" + (ctx.callbackQuery?.data || \"\")));\n\nbot.launch();\n`;
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
            onRetryPendingOps={() => { /* Implement retry */ }}
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
