import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { User } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fromUnsafe } from "@/integrations/supabase/unsafe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus, Save, Trash2, FileText, Bold, Italic, Code, Link, Share2, LogOut, Download, Copy, Upload, Edit2, Eye, Edit, Undo2, Redo2, AlertCircle, Network, Star, StarOff } from "lucide-react";
import MessageBubble, { MessageBubbleHandle } from "./MessageBubble";
import InlineKeyboard from "./InlineKeyboard";
import ButtonEditDialog from "./ButtonEditDialog";
import TemplateFlowDiagram from "./TemplateFlowDiagram";
import CircularReferenceDialog from "./CircularReferenceDialog";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { KeyboardRow, KeyboardButton } from "./TelegramChat";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { 
  findScreenReferences, 
  detectCircularReferences, 
  findAllCircularReferences 
} from "@/lib/referenceChecker";
import { validateKeyboard, validateMessageContent } from "@/lib/validation";
import { debounce } from "@/lib/debounce";

const DEFAULT_MESSAGE = "Welcome to the Telegram UI Builder!\n\nEdit this message directly.\n\nFormatting:\n**bold text** for bold\n`code blocks` for code";
const DEFAULT_KEYBOARD_TEMPLATE: KeyboardRow[] = [
  {
    id: "row-1",
    buttons: [
      { id: "btn-1", text: "Button 1", callback_data: "btn_1_action" },
      { id: "btn-2", text: "Button 2", callback_data: "btn_2_action" },
    ],
  },
];

const cloneKeyboard = (rows: KeyboardRow[]): KeyboardRow[] =>
  rows.map((row) => ({
    ...row,
    buttons: row.buttons.map((button) => ({ ...button })),
  }));

const createDefaultKeyboard = (): KeyboardRow[] => cloneKeyboard(DEFAULT_KEYBOARD_TEMPLATE);

const ensureKeyboard = (value: unknown): KeyboardRow[] => {
  if (Array.isArray(value)) {
    return cloneKeyboard(value as KeyboardRow[]);
  }
  return createDefaultKeyboard();
};

const isTelegramExportPayload = (value: unknown): value is TelegramExportPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string") {
    return false;
  }
  if (!record.reply_markup) {
    return true;
  }
  const replyMarkup = record.reply_markup as Record<string, unknown>;
  if (!replyMarkup.inline_keyboard) {
    return true;
  }
  return isTelegramKeyboard(replyMarkup.inline_keyboard);
};

const buildKeyboardFromTelegram = (inlineKeyboard: TelegramImportButton[][]): KeyboardRow[] => {
  const timestamp = Date.now();
  return inlineKeyboard.map((row, rowIndex) => ({
    id: `row-${timestamp}-${rowIndex}`,
    buttons: row.map((btn, btnIndex) => {
      const button: KeyboardButton = {
        id: `btn-${timestamp}-${rowIndex}-${btnIndex}`,
        text: btn.text,
      };

      if (btn.url) {
        button.url = btn.url;
      } else if (btn.callback_data?.startsWith('goto_screen_')) {
        button.linked_screen_id = btn.callback_data.replace('goto_screen_', '');
      } else if (btn.callback_data) {
        button.callback_data = btn.callback_data;
      }

      return button;
    }),
  }));
};

const isFlowScreenPayload = (value: unknown): value is FlowScreenPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.message_content === "string" &&
    Array.isArray(record.keyboard)
  );
};

const isFlowExportPayload = (value: unknown): value is FlowExportPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "string" || !Array.isArray(record.screens)) {
    return false;
  }
  return record.screens.every(isFlowScreenPayload);
};

const isTelegramImportButton = (value: unknown): value is TelegramImportButton => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.text === "string";
};

const isTelegramKeyboard = (value: unknown): value is TelegramImportButton[][] =>
  Array.isArray(value) && value.every((row) => Array.isArray(row) && row.every(isTelegramImportButton));

interface Screen {
  id: string;
  name: string;
  message_content: string;
  keyboard: KeyboardRow[];
  share_token?: string | null;
  is_public: boolean;
}

interface EditorState {
  messageContent: string;
  keyboard: KeyboardRow[];
}

type ScreenRow = Omit<Screen, "keyboard"> & { keyboard: unknown };

type FlowScreenPayload = {
  id: string;
  name: string;
  message_content: string;
  keyboard: KeyboardRow[];
};

interface FlowExportPayload {
  version: string;
  entry_screen_id?: string;
  screens: FlowScreenPayload[];
}

interface TelegramExportButton {
  text: string;
  url?: string;
  callback_data?: string;
}

interface TelegramExportPayload {
  text: string;
  parse_mode: "HTML";
  reply_markup?: {
    inline_keyboard: TelegramExportButton[][];
  };
}

interface TelegramImportButton {
  text: string;
  url?: string;
  callback_data?: string;
}

const TelegramChatWithDB = () => {
  const navigate = useNavigate();
  const messageBubbleRef = useRef<MessageBubbleHandle>(null);
  const [user, setUser] = useState<User | null>(null);
  
  // 使用撤销/重做管理编辑器状态
  const {
    state: editorState,
    setState: setEditorState,
    undo,
    redo,
    reset: resetHistory,
    canUndo,
    canRedo,
  } = useUndoRedo<EditorState>({
    messageContent: DEFAULT_MESSAGE,
    keyboard: createDefaultKeyboard(),
  });

  const messageContent = editorState.messageContent;
  const keyboard = editorState.keyboard;

  // 包装 setState 方法以支持函数式更新
  const setMessageContent = useCallback((value: string | ((prev: string) => string)) => {
    setEditorState(prev => ({
      ...prev,
      messageContent: typeof value === 'function' ? value(prev.messageContent) : value,
    }));
  }, [setEditorState]);

  const setKeyboard = useCallback((value: KeyboardRow[] | ((prev: KeyboardRow[]) => KeyboardRow[])) => {
    setEditorState(prev => ({
      ...prev,
      keyboard: typeof value === 'function' ? value(prev.keyboard) : value,
    }));
  }, [setEditorState]);

  const [screens, setScreens] = useState<Screen[]>([]);
  const [currentScreenId, setCurrentScreenId] = useState<string | undefined>(undefined);
  const [newScreenName, setNewScreenName] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJSON, setImportJSON] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [editableJSON, setEditableJSON] = useState("");
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);
  const [buttonEditDialogOpen, setButtonEditDialogOpen] = useState(false);
  const [editingButtonData, setEditingButtonData] = useState<{
    rowId: string;
    buttonId: string;
    button: KeyboardButton;
  } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedContent, setLastSavedContent] = useState({ message: "", keyboard: [] as KeyboardRow[] });
  const [isLoading, setIsLoading] = useState(false);
  const [flowDiagramOpen, setFlowDiagramOpen] = useState(false);
  const [circularDialogOpen, setCircularDialogOpen] = useState(false);
  const [detectedCircularPaths, setDetectedCircularPaths] = useState<Array<{ path: string[]; screenNames: string[] }>>([]);
  // 置顶模版（本地持久化，按用户隔离）
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  // 加载错误提示去重
  const loadErrorShownRef = useRef(false);
  const [loadIssue, setLoadIssue] = useState<string | null>(null);
  // 是否允许循环引用（持久化到本地）
  const [allowCircular, setAllowCircular] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('allow_circular_references');
      return saved ? JSON.parse(saved) === true : true; // 默认允许
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('allow_circular_references', JSON.stringify(allowCircular));
    } catch (e) {
      // 忽略 Safari/隐私模式无法写入等异常
      void e;
    }
  }, [allowCircular]);

  // 保存状态条：最后保存时间、离线状态、错误信息
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(typeof navigator !== 'undefined' ? !navigator.onLine : false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 置顶：读取与持久化
  const PINNED_KEY = user ? `pinned_screens_${user.id}` : 'pinned_screens_anon';
  const CACHE_KEY = user ? `cached_screens_${user.id}` : 'cached_screens_anon';
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_KEY);
      if (!raw) { setPinnedIds([]); return; }
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
        setPinnedIds(parsed as string[]);
      } else {
        setPinnedIds([]);
      }
    } catch (e) {
      void e;
      setPinnedIds([]);
    }
  }, [PINNED_KEY]);

  const persistPinned = useCallback((ids: string[]) => {
    try { localStorage.setItem(PINNED_KEY, JSON.stringify(ids)); } catch (e) { void e; }
  }, [PINNED_KEY]);

  const isPinned = useCallback((id?: string) => !!id && pinnedIds.includes(id), [pinnedIds]);

  const reorderByPinned = useCallback((list: Screen[]) => {
    const set = new Set(pinnedIds);
    type WithMeta = Screen & { created_at?: string };
    const getCreatedAt = (s: WithMeta) => typeof s.created_at === 'string' ? Date.parse(s.created_at) : 0;
    return [...list].sort((a: WithMeta, b: WithMeta) => {
      const ap = set.has(a.id) ? 1 : 0;
      const bp = set.has(b.id) ? 1 : 0;
      if (ap !== bp) return bp - ap; // pinned first
      const bd = getCreatedAt(b) - getCreatedAt(a);
      if (bd !== 0) return bd; // newer first
      return (b.name || '').localeCompare(a.name || '', 'zh');
    });
  }, [pinnedIds]);


  // Memo 化昂贵的计算
  const circularReferences = useMemo(() => {
    if (screens.length === 0) return [];
    return findAllCircularReferences(screens);
  }, [screens]);

  const screenMap = useMemo(() => {
    return new Map(screens.map(s => [s.id, s]));
  }, [screens]);

  // 优化的引用查找函数
  const findScreenReferencesOptimized = useCallback((targetScreenId: string) => {
    const references: Array<{
      screenId: string;
      screenName: string;
      buttonText: string;
      rowIndex: number;
      buttonIndex: number;
    }> = [];

    screens.forEach((screen) => {
      if (screen.id === targetScreenId) return;

      const keyboard = screen.keyboard ?? [];
      keyboard.forEach((row, rowIndex) => {
        row.buttons?.forEach((button, buttonIndex) => {
          if (button.linked_screen_id === targetScreenId) {
            references.push({
              screenId: screen.id,
              screenName: screen.name,
              buttonText: button.text,
              rowIndex,
              buttonIndex,
            });
          }
        });
      });
    });

    return references;
  }, [screens]);

  // 自动保存功能
  const { saveToLocalStorage, restoreFromLocalStorage, clearLocalStorage } = useAutoSave({
    interval: 30000, // 30秒
    enabled: !isPreviewMode && hasUnsavedChanges,
    onSave: async () => {
      if (currentScreenId && hasUnsavedChanges) {
        console.log('[AutoSave] 触发自动保存');
        // 静默保存，不显示toast
      }
    },
    data: { messageContent, keyboard, currentScreenId },
    storageKey: 'telegram_ui_autosave',
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/auth");
      } else {
        setUser(session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) {
        navigate("/auth");
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  // 检测未保存更改
  useEffect(() => {
    const currentState = JSON.stringify({ message: messageContent, keyboard });
    const savedState = JSON.stringify(lastSavedContent);
    setHasUnsavedChanges(currentState !== savedState);
  }, [messageContent, keyboard, lastSavedContent]);

  // 全局快捷键支持 - 使用 useRef 避免闭包陷阱
  const handlersRef = useRef<{
    updateScreen: () => Promise<void>;
    saveScreen: () => Promise<void>;
    createNewScreen: () => void;
    handleModeToggle: () => void;
  }>();
  
  // 始终保持最新的函数引用
  useEffect(() => {
    handlersRef.current = {
      updateScreen,
      saveScreen,
      createNewScreen,
      handleModeToggle,
    };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z / Cmd+Z - 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo && !isPreviewMode) {
          undo();
          toast.info('↶ 已撤销');
        }
      }
      
      // Ctrl+Shift+Z / Ctrl+Y / Cmd+Shift+Z - 重做
      if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') || 
          (e.ctrlKey && e.key === 'y')) {
        e.preventDefault();
        if (canRedo && !isPreviewMode) {
          redo();
          toast.info('↷ 已重做');
        }
      }
      
      // Ctrl+S / Cmd+S - 保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (currentScreenId) {
          handlersRef.current.updateScreen();
        } else {
          handlersRef.current.saveScreen();
        }
      }
      
      // Ctrl+N / Cmd+N - 新建
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        handlersRef.current.createNewScreen();
      }
      
      // Ctrl+P / Cmd+P - 切换预览模式
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        handlersRef.current.handleModeToggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo, currentScreenId, isPreviewMode]);

  // 页面加载时尝试恢复自动保存的数据 - 修复：使用独立标志位跟踪加载状态
  const [screensLoaded, setScreensLoaded] = useState(false);
  
  useEffect(() => {
    if (!user) {
      setScreens([]);
      setScreensLoaded(false);
    }
  }, [user, reorderByPinned]);

  const loadScreens = useCallback(async () => {
    if (!user) return [];
    setIsLoading(true);
    try {
      const request = async () => {
        const { data, error } = await fromUnsafe(supabase)("screens")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      };

      const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
      let data: unknown[] = [];
      let lastErr: unknown = null;
      for (let i = 0; i < 3; i++) {
        try {
          data = await request();
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          await delay(400 * (i + 1));
        }
      }
      if (lastErr) throw lastErr;

      const typedData: ScreenRow[] = (data ?? []) as ScreenRow[];
      const loadedScreens = typedData.map((screen) => ({
        ...screen,
        keyboard: ensureKeyboard(screen.keyboard),
      }));
      const ordered = reorderByPinned(loadedScreens as Screen[]);
      setScreens(ordered);
      // 缓存最新成功数据
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(ordered)); } catch (e) { void e; }
      setLoadIssue(null);
      return loadedScreens; // 修复：返回最新数据供调用者使用
    } catch (error) {
      console.error('[LoadScreens] Error:', error);
      // 尝试从缓存恢复
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached: unknown = JSON.parse(raw);
          if (Array.isArray(cached)) {
            setScreens(reorderByPinned(cached as Screen[]));
            setLoadIssue('离线或服务异常：已加载本地缓存的数据');
            loadErrorShownRef.current = true;
            return cached as Screen[];
          }
        }
      } catch (e) { void e; }
      const reason = error instanceof Error ? error.message : String(error ?? '未知错误');
      setLoadIssue(`加载模版失败：${reason}`);
      loadErrorShownRef.current = true;
      return []; // 错误时返回空数组
    } finally {
      setIsLoading(false);
    }
  }, [user, reorderByPinned, CACHE_KEY]);

  useEffect(() => {
    if (user && !screensLoaded) {
      loadScreens().finally(() => setScreensLoaded(true));
    }
  }, [user, screensLoaded, loadScreens]);

  useEffect(() => {
    // 确保用户已登录、screens 已首次加载完成、且没有当前打开的模板
    if (user && screensLoaded && !currentScreenId && !hasUnsavedChanges) {
      const restored = restoreFromLocalStorage();
      
      // 验证恢复数据的有效性
      if (restored && restored.messageContent && restored.keyboard) {
        try {
          validateMessageContent(restored.messageContent);
          validateKeyboard(restored.keyboard);
          
          const shouldRestore = confirm(
            '检测到未保存的草稿（自动保存），是否恢复？\n\n' +
            '点击"确定"恢复草稿\n点击"取消"使用默认模版'
          );
          
          if (shouldRestore) {
            setEditorState({
              messageContent: restored.messageContent,
              keyboard: restored.keyboard,
            });
            
            // 如果恢复的 screenId 仍然存在，则设置它
            if (restored.currentScreenId && screens.find(s => s.id === restored.currentScreenId)) {
              setCurrentScreenId(restored.currentScreenId);
            }
            
            toast.success('✅ 已恢复自动保存的草稿');
          } else {
            clearLocalStorage();
          }
        } catch (error) {
          console.error('[AutoSave] 恢复数据验证失败:', error);
          clearLocalStorage();
          toast.error('自动保存的数据已损坏，已清除');
        }
      }
    }
  }, [user, screensLoaded, currentScreenId, hasUnsavedChanges, screens, restoreFromLocalStorage, clearLocalStorage, setEditorState]);

 

  // 模式切换处理 - 修复：添加 updateEditableJSON 依赖
  const updateEditableJSONRef = useRef<() => void>();
  
  const handleModeToggle = useCallback(() => {
    if (hasUnsavedChanges) {
      const confirmed = confirm(
        isPreviewMode 
          ? "⚠️ 切换到编辑模式后，请记得保存修改。\n\n是否继续？" 
          : "⚠️ 当前有未保存的更改，切换到预览模式前建议先保存。\n\n是否继续？"
      );
      if (!confirmed) {
        return;
      }
    }
    
    const newMode = !isPreviewMode;
    setIsPreviewMode(newMode);
    if (newMode) {
      updateEditableJSONRef.current?.();
      setNavigationHistory([]); // 重置导航历史
      toast.success("✅ 已切换到预览模式，可以点击按钮测试跳转");
    } else {
      toast.info("✏️ 已切换到编辑模式，双击按钮可编辑文本");
    }
  }, [hasUnsavedChanges, isPreviewMode]);

  const saveScreen = async () => {
    if (!user) return;
    
    setIsLoading(true);

    // 验证数据
    try {
      validateMessageContent(messageContent);
      validateKeyboard(keyboard);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      toast.error(`数据验证失败：${message}`);
      setIsLoading(false);
      return;
    }

    // 检查按钮配置
    const unconfiguredButtons = keyboard.flatMap(row => 
      row.buttons.filter(btn => !btn.url && !btn.linked_screen_id && !btn.callback_data)
    );
    
    if (unconfiguredButtons.length > 0) {
      const proceed = confirm(
        `⚠️ 发现 ${unconfiguredButtons.length} 个按钮未配置操作（跳转或回调）。\n\n` +
        `未配置的按钮：${unconfiguredButtons.map(b => b.text).join('、')}\n\n` +
        `建议：\n` +
        `1. 点击按钮右上角⚙️配置跳转目标\n` +
        `2. 或在"链接模版"标签选择跳转页面\n\n` +
        `仍要保存吗？`
      );
      
      if (!proceed) {
        toast.info("请先配置按钮操作");
        return;
      }
    }

    const name = newScreenName.trim() || `模版 ${screens.length + 1}`;

    try {
      const { data, error} = await fromUnsafe(supabase)("screens")
        .insert([{
        user_id: user.id,
        name,
        message_content: messageContent,
        keyboard,
        is_public: false,
      }]).select().single();

      if (error) throw error;
      const savedScreenData = data as ScreenRow | null;
      const savedScreen = savedScreenData
        ? { ...savedScreenData, keyboard: ensureKeyboard(savedScreenData.keyboard) }
        : null;
      
      toast.success("✅ 模版保存成功！");
      setLastSavedAt(Date.now());
      setLastError(null);
      setNewScreenName("");
      setLastSavedContent({ message: messageContent, keyboard });
      setHasUnsavedChanges(false);
      resetHistory({ messageContent, keyboard }); // 重置撤销历史
      clearLocalStorage(); // 清除自动保存
      
      if (savedScreen) setCurrentScreenId(savedScreen.id);
      
      // 重新加载所有模板
      const updatedScreens = await loadScreens();
      
      // 保存后检查循环引用（使用更新后的 screens）
      // 修复：loadScreens 应该返回最新的 screens
      if (updatedScreens && updatedScreens.length > 0) {
        const circles = findAllCircularReferences(updatedScreens);
        if (circles.length > 0) {
          toast.warning(
            `⚠️ 检测到循环引用！\n路径: ${circles[0].screenNames.join(' → ')}\n建议检查模版间的跳转关系`,
            { duration: 6000 }
          );
        }
      }
      
      // 如果有未配置的按钮，提示用户
      if (unconfiguredButtons.length > 0) {
        setTimeout(() => {
          toast.warning(`提示：请为 ${unconfiguredButtons.length} 个按钮配置跳转目标，使交互流程更完整`);
        }, 1500);
      }
    } catch (error) {
      console.error('[SaveScreen] Error:', error);
      const message = error instanceof Error ? error.message : '未知错误';
      setLastError(message);
      toast.error("保存模版失败");
    } finally {
      setIsLoading(false);
    }
  };

  const updateScreen = async () => {
    if (!currentScreenId || !user) return;
    
    setIsLoading(true);

    // 验证数据
    try {
      validateMessageContent(messageContent);
      validateKeyboard(keyboard);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      toast.error(`数据验证失败：${message}`);
      setIsLoading(false);
      return;
    }

    // 检查按钮配置
    const unconfiguredButtons = keyboard.flatMap(row => 
      row.buttons.filter(btn => !btn.url && !btn.linked_screen_id && !btn.callback_data)
    );
    
    if (unconfiguredButtons.length > 0) {
      toast.warning(
        `⚠️ 提醒：有 ${unconfiguredButtons.length} 个按钮未配置操作\n` +
        `建议配置跳转目标使交互更完整`,
        { duration: 4000 }
      );
    }

    // 检查循环引用（按设置决定是否阻止保存）
    const currentScreen = screens.find(s => s.id === currentScreenId);
    const allCircles = findAllCircularReferences([
      ...screens,
      { id: currentScreenId, name: currentScreen?.name || "", keyboard },
    ]);
    if (allCircles.length > 0) {
      setDetectedCircularPaths(allCircles);
      if (!allowCircular) {
        setCircularDialogOpen(true);
        toast.info("检测到循环引用：已阻止保存。请处理后重试。");
        setIsLoading(false);
        return;
      } else {
        // 允许循环：仅提示，不阻断
        toast.warning(
          `⚠️ 检测到 ${allCircles.length} 个循环引用（已允许）。建议确认交互不会陷入死循环。`,
          { duration: 5000 }
        );
      }
    }

    try {
      const { error } = await fromUnsafe(supabase)("screens")
        .update({
          message_content: messageContent,
          keyboard,
        })
        .eq("id", currentScreenId)
        .eq("user_id", user.id);

      if (error) throw error;
      toast.success("✅ 模版更新成功！");
      setLastSavedAt(Date.now());
      setLastError(null);
      setLastSavedContent({ message: messageContent, keyboard });
      setHasUnsavedChanges(false);
      resetHistory({ messageContent, keyboard }); // 重置撤销历史
      clearLocalStorage(); // 清除自动保存
      await loadScreens();
    } catch (error) {
      console.error('[UpdateScreen] Error:', error);
      const message = error instanceof Error ? error.message : '未知错误';
      setLastError(message);
      toast.error("更新模版失败");
    } finally {
      setIsLoading(false);
    }
  };

  const loadScreen = (id: string, addToHistory = false) => {
    const s = screens.find((x) => x.id === id);
    if (!s) {
      toast.error("模版不存在");
      console.error('Screen not found:', id, 'Available screens:', screens.map(s => ({ id: s.id, name: s.name })));
      return;
    }
    
    // 检查未保存的更改
    if (hasUnsavedChanges && currentScreenId && !isPreviewMode) {
      const confirmed = confirm("⚠️ 当前有未保存的更改，切换模版会丢失这些更改。\n\n是否继续？");
      if (!confirmed) {
        return;
      }
    }
    
    // 在预览模式下且需要添加历史时，记录当前页面
    // 重要：只有当前有打开的 screen 且不是重复跳转时才添加到历史
    if (addToHistory && isPreviewMode && currentScreenId && currentScreenId !== id) {
      console.log('Adding to navigation history:', {
        currentScreenId,
        targetScreenId: id,
        currentHistoryLength: navigationHistory.length,
      });
      setNavigationHistory(prev => {
        // 限制历史记录最大长度为50，防止内存溢出
        const MAX_HISTORY = 50;
        const newHistory = [...prev, currentScreenId];
        if (newHistory.length > MAX_HISTORY) {
          console.warn('Navigation history limit reached, removing oldest entry');
          return newHistory.slice(-MAX_HISTORY);
        }
        console.log('New navigation history:', newHistory);
        return newHistory;
      });
    }
    
    setEditorState({
      messageContent: s.message_content,
      keyboard: cloneKeyboard(s.keyboard),
    });
    setCurrentScreenId(id);
    setLastSavedContent({ message: s.message_content, keyboard: cloneKeyboard(s.keyboard) });
    setHasUnsavedChanges(false);
    resetHistory({ messageContent: s.message_content, keyboard: cloneKeyboard(s.keyboard) });
    
    // 更新可编辑 JSON
    if (isPreviewMode) {
      setTimeout(() => updateEditableJSON(), 100);
    }
    
    console.log('Screen loaded successfully:', {
      id,
      name: s.name,
      navigationHistoryLength: navigationHistory.length,
      isPreviewMode,
    });
  };
  
  const navigateBack = () => {
    if (navigationHistory.length === 0) {
      toast.info("📍 已经是起始页面");
      return;
    }
    
    // 修复：添加递归深度限制，防止无限递归
    const maxDepth = 10;
    let depth = 0;
    
    const findValidScreen = (): Screen | null => {
      if (depth >= maxDepth || navigationHistory.length === 0) {
        return null;
      }
      
      const prevScreenId = navigationHistory[navigationHistory.length - 1];
      const s = screens.find((x) => x.id === prevScreenId);
      
      if (!s) {
        // 清除无效历史
        setNavigationHistory(prev => prev.slice(0, -1));
        depth++;
        return findValidScreen(); // 递归查找
      }
      
      return s;
    };
    
    const validScreen = findValidScreen();
    
    if (!validScreen) {
      toast.error("❌ 所有历史页面都已被删除");
      setNavigationHistory([]);
      return;
    }
    
    // 移除历史记录
    setNavigationHistory(prev => prev.slice(0, -1));
    
    // 修复：使用 setEditorState 保持状态一致性
    setEditorState({
      messageContent: validScreen.message_content,
      keyboard: cloneKeyboard(validScreen.keyboard),
    });
    setCurrentScreenId(validScreen.id);
    
    // 修复：更新所有相关状态，保持数据一致性
    setLastSavedContent({ 
      message: validScreen.message_content, 
      keyboard: cloneKeyboard(validScreen.keyboard), 
    });
    setHasUnsavedChanges(false);
    resetHistory({ 
      messageContent: validScreen.message_content, 
      keyboard: cloneKeyboard(validScreen.keyboard), 
    });
    
    // 更新可编辑 JSON
    if (isPreviewMode) {
      setTimeout(() => updateEditableJSONRef.current?.(), 100);
    }
    
    toast.success(`⬅️ 返回到: ${validScreen.name}`);
  };

  const deleteScreen = async (id: string) => {
    if (!user) return;
    
    setIsLoading(true);

    // 引用完整性检查 - 使用优化的版本
    const references = findScreenReferencesOptimized(id);
    
    if (references.length > 0) {
      const referenceList = references
        .map(ref => `• ${ref.screenName} 的按钮 "${ref.buttonText}"`)
        .join('\n');
      
      const proceed = confirm(
        `⚠️ 引用完整性警告！\n\n` +
        `当前模版被以下 ${references.length} 个按钮引用：\n\n${referenceList}\n\n` +
        `删除后，这些按钮的跳转将失效。\n\n` +
        `选项：\n` +
        `• 确定 - 删除模版（按钮跳转将断开）\n` +
        `• 取消 - 先修改引用按钮，再删除模版\n\n` +
        `确定要删除吗？`
      );
      
      if (!proceed) {
        toast.info("已取消删除，请先修改引用按钮");
        setIsLoading(false);
        return;
      }
      
      // 用户确认删除，清除所有引用
      toast.info(`正在清除 ${references.length} 个引用...`);
    }

    try {
      const { error } = await fromUnsafe(supabase)("screens")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) throw error;
      
      console.log('Screen deleted successfully:', id);
      toast.success("模版删除成功！");
      
      // 如果删除的是当前模版，重置编辑器
      if (currentScreenId === id) {
        console.log('Deleted screen was current screen, resetting editor');
        setCurrentScreenId(undefined);
        createNewScreen();
      }
      
      // 清理导航历史中的已删除模版
      setNavigationHistory(prev => {
        const cleaned = prev.filter(screenId => screenId !== id);
        if (cleaned.length !== prev.length) {
          console.log('Cleaned deleted screen from navigation history:', {
            deletedId: id,
            oldLength: prev.length,
            newLength: cleaned.length,
          });
        }
        return cleaned;
      });
      
      await loadScreens();
    } catch (error) {
      console.error('[DeleteScreen] Error:', error);
      toast.error("删除模版失败");
    } finally {
      setIsLoading(false);
    }
  };

  const createNewScreen = () => {
    // 检查未保存的更改
    if (hasUnsavedChanges) {
      const confirmed = confirm("⚠️ 当前有未保存的更改，新建模版会丢失这些更改。\n\n是否继续？");
      if (!confirmed) {
        return;
      }
    }
    
    setEditorState({
      messageContent: DEFAULT_MESSAGE,
      keyboard: createDefaultKeyboard(),
    });
    setCurrentScreenId(undefined);
    setNewScreenName("");
    setLastSavedContent({ message: DEFAULT_MESSAGE, keyboard: createDefaultKeyboard() });
    setHasUnsavedChanges(false);
    resetHistory({ messageContent: DEFAULT_MESSAGE, keyboard: createDefaultKeyboard() });
    setNavigationHistory([]);
    clearLocalStorage();
  };

  // 修复：保持 handlersRef 始终引用最新的函数
  useEffect(() => {
    handlersRef.current = {
      updateScreen,
      saveScreen,
      createNewScreen,
      handleModeToggle,
    };
  });

  const shareScreen = async () => {
    if (!currentScreenId || !user) {
      toast.error("请先保存模版");
      return;
    }

    const currentScreen = screens.find(s => s.id === currentScreenId);
    if (currentScreen?.share_token) {
      const shareUrl = `${window.location.origin}/share/${currentScreen.share_token}`;
      await navigator.clipboard.writeText(shareUrl);
      toast.success("分享链接已复制到剪贴板！");
      return;
    }

    try {
      const shareToken = crypto.randomUUID();
      const { error } = await fromUnsafe(supabase)("screens")
        .update({
          is_public: true,
          share_token: shareToken,
        })
        .eq("id", currentScreenId)
        .eq("user_id", user.id);

      if (error) throw error;

      const shareUrl = `${window.location.origin}/share/${shareToken}`;
      await navigator.clipboard.writeText(shareUrl);
      toast.success("分享链接已复制到剪贴板！");
      await loadScreens();
    } catch (error) {
      toast.error("创建分享链接失败");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const convertToTelegramFormat = (): TelegramExportPayload => {
    // Convert markdown-style formatting to Telegram HTML
    const text = messageContent
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')  // Bold
      .replace(/`(.*?)`/g, '<code>$1</code>')  // Code
      .replace(/_(.*?)_/g, '<i>$1</i>');       // Italic

    // Convert keyboard to Telegram format
    const reply_markup = keyboard.length > 0 ? {
      inline_keyboard: keyboard.map(row => 
        row.buttons.map(btn => {
          const btnData: TelegramExportButton = { text: btn.text };
          if (btn.url) {
            btnData.url = btn.url;
          } else if (btn.linked_screen_id) {
            // For linked screens, use a special callback_data format
            btnData.callback_data = `goto_screen_${btn.linked_screen_id}`;
          } else {
            btnData.callback_data = btn.callback_data || btn.text.toLowerCase().replace(/\s+/g, '_');
          }
          return btnData;
        })
      )
    } : undefined;

    return {
      text,
      parse_mode: "HTML",
      ...(reply_markup && { reply_markup })
    };
  };

  const exportFlowAsJSON = () => {
    if (screens.length === 0) {
      toast.error("没有可导出的模版");
      return;
    }
    
    // 导出整个交互流程，包含完整的模版数据
    const flowData = {
      version: "1.0",
      entry_screen_id: currentScreenId || screens[0]?.id,
      screens: screens.map(screen => ({
        id: screen.id,
        name: screen.name,
        message_content: screen.message_content,
        keyboard: screen.keyboard,
      })),
    };

    const blob = new Blob([JSON.stringify(flowData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telegram-flow-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("交互流程已导出！");
  };

  const handleExportJSON = () => {
    const data = convertToTelegramFormat();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telegram-ui-${currentScreenId || 'design'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("JSON 文件已下载！");
  };

  const handleCopyJSON = async () => {
    const data = convertToTelegramFormat();
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success("JSON 已复制到剪贴板！");
  };

  const handleImportJSON = async () => {
    try {
      const parsed: unknown = JSON.parse(importJSON);
      
      // Check if it's a flow export
      if (isFlowExportPayload(parsed)) {
        if (!user) {
          toast.error("请先登录");
          return;
        }
        
        const importedScreens: Screen[] = [];
        const oldIdToNewId: Record<string, string> = {};
        
        for (const screen of parsed.screens) {
          const normalizedKeyboard = ensureKeyboard(screen.keyboard);
          const { data, error } = await fromUnsafe(supabase)("screens")
            .insert([{
              user_id: user.id,
              name: `${screen.name} (导入)`,
              message_content: screen.message_content,
              keyboard: normalizedKeyboard,
              is_public: false,
            }])
            .select()
            .single();
          
          if (error) throw error;
          if (data) {
            const savedRow = data as ScreenRow;
            const savedScreen: Screen = {
              ...savedRow,
              keyboard: ensureKeyboard(savedRow.keyboard),
            };
            oldIdToNewId[screen.id] = savedScreen.id;
            importedScreens.push(savedScreen);
          }
        }
        
        for (const screen of importedScreens) {
          let needsUpdate = false;
          const updatedKeyboard = screen.keyboard.map((row) => ({
            ...row,
            buttons: row.buttons.map((btn) => {
              if (btn.linked_screen_id && oldIdToNewId[btn.linked_screen_id]) {
                needsUpdate = true;
                return { ...btn, linked_screen_id: oldIdToNewId[btn.linked_screen_id] };
              }
              return btn;
            }),
          }));
          
          if (needsUpdate) {
            await fromUnsafe(supabase)("screens")
              .update({ keyboard: updatedKeyboard })
              .eq("id", screen.id);
          }
        }
        
        await loadScreens();
        
        if (parsed.entry_screen_id && oldIdToNewId[parsed.entry_screen_id]) {
          loadScreen(oldIdToNewId[parsed.entry_screen_id]);
        }
        
        setImportDialogOpen(false);
        setImportJSON("");
        toast.success(`成功导入 ${importedScreens.length} 个模版！`);
        return;
      }
      
      if (!isTelegramExportPayload(parsed)) {
        throw new Error("Invalid JSON structure");
      }

      const markdownText = parsed.text
        .replace(/<b>(.*?)<\/b>/g, '**$1**')
        .replace(/<code>(.*?)<\/code>/g, '`$1`')
        .replace(/<i>(.*?)<\/i>/g, '_$1_');
      
      setMessageContent(markdownText);

      const inlineKeyboard = parsed.reply_markup?.inline_keyboard;
      if (inlineKeyboard && isTelegramKeyboard(inlineKeyboard)) {
        setKeyboard(buildKeyboardFromTelegram(inlineKeyboard));
      }

      setImportDialogOpen(false);
      setImportJSON("");
      toast.success("JSON 导入成功！");
    } catch (error) {
      console.error(error);
      toast.error("JSON 格式无效或导入失败");
    }
  };

  const handleApplyEditedJSON = () => {
    try {
      const parsed: unknown = JSON.parse(editableJSON);
      if (!isTelegramExportPayload(parsed)) {
        throw new Error("Invalid JSON");
      }
      
      const markdownText = parsed.text
        .replace(/<b>(.*?)<\/b>/g, '**$1**')
        .replace(/<code>(.*?)<\/code>/g, '`$1`')
        .replace(/<i>(.*?)<\/i>/g, '_$1_');
      
      setMessageContent(markdownText);

      const inlineKeyboard = parsed.reply_markup?.inline_keyboard;
      if (inlineKeyboard && isTelegramKeyboard(inlineKeyboard)) {
        setKeyboard(buildKeyboardFromTelegram(inlineKeyboard));
      }

      toast.success("JSON 已应用！");
    } catch (error) {
      toast.error("JSON 格式无效");
    }
  };

  // Update editable JSON when content changes
  const updateEditableJSON = () => {
    setEditableJSON(JSON.stringify(convertToTelegramFormat(), null, 2));
  };
  
  // 保持 ref 始终指向最新函数
  useEffect(() => {
    updateEditableJSONRef.current = updateEditableJSON;
  });

  const handleRenameScreen = async () => {
    if (!currentScreenId || !user || !renameValue.trim()) return;

    try {
      const { error } = await fromUnsafe(supabase)("screens")
        .update({ name: renameValue.trim() })
        .eq("id", currentScreenId)
        .eq("user_id", user.id);

      if (error) throw error;
      toast.success("模版重命名成功！");
      setRenameDialogOpen(false);
      await loadScreens();
    } catch (error) {
      toast.error("重命名失败");
    }
  };

  const openRenameDialog = () => {
    const current = screens.find(s => s.id === currentScreenId);
    if (current) {
      setRenameValue(current.name);
      setRenameDialogOpen(true);
    }
  };

  const handleAddButton = () => {
    const btnId = `btn-${Date.now()}`;
    const newButton: KeyboardButton = {
      id: btnId,
      text: "新按钮",
      callback_data: `${btnId}_action`,
    };
    
    let targetRowId = '';
    
    // 使用函数式更新确保状态同步
    setKeyboard((prev) => {
      const newKeyboard = [...prev];
      const lastRow = newKeyboard[newKeyboard.length - 1];
      
      if (lastRow && lastRow.buttons.length < 4) {
        lastRow.buttons.push(newButton);
        targetRowId = lastRow.id;
      } else {
        const newRowId = `row-${Date.now() + 1}`; // 确保与按钮ID不同
        targetRowId = newRowId;
        newKeyboard.push({
          id: newRowId,
          buttons: [newButton],
        });
      }
      
      // 延迟打开配置对话框，使用 targetRowId
      setTimeout(() => {
        setEditingButtonData({
          rowId: targetRowId,
          buttonId: btnId,
          button: newButton,
        });
        setButtonEditDialogOpen(true);
        toast.info("💡 请配置按钮跳转目标");
      }, 100);
      
      return newKeyboard;
    });
  };

  const handleAddRow = () => {
    const timestamp = Date.now();
    const btnId = `btn-${timestamp}`;
    const rowId = `row-${timestamp + 1}`; // 确保与按钮ID不同
    const newButton: KeyboardButton = {
      id: btnId,
      text: "新按钮",
      callback_data: `${btnId}_action`,
    };
    
    setKeyboard((prev) => {
      const newKeyboard = [
        ...prev,
        {
          id: rowId,
          buttons: [newButton],
        },
      ];
      
      // 延迟打开配置对话框
      setTimeout(() => {
        setEditingButtonData({
          rowId,
          buttonId: btnId,
          button: newButton,
        });
        setButtonEditDialogOpen(true);
        toast.info("💡 请配置按钮跳转目标");
      }, 100);
      
      return newKeyboard;
    });
  };

  const handleButtonTextChange = (rowId: string, buttonId: string, newText: string) => {
    setKeyboard((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              buttons: row.buttons.map((btn) =>
                btn.id === buttonId ? { ...btn, text: newText } : btn
              ),
            }
          : row
      )
    );
  };

  const handleButtonUpdate = (rowId: string, buttonId: string, updatedButton: KeyboardButton) => {
    console.log('Button updated:', {
      id: updatedButton.id,
      text: updatedButton.text,
      callback_data: updatedButton.callback_data,
      url: updatedButton.url,
      linked_screen_id: updatedButton.linked_screen_id,
    });
    
    setKeyboard((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              buttons: row.buttons.map((btn) =>
                btn.id === buttonId ? { ...updatedButton } : btn
              ),
            }
          : row
      )
    );
    
    // 同步更新 editingButtonData 以保持数据一致性
    if (editingButtonData && editingButtonData.buttonId === buttonId) {
      setEditingButtonData({
        ...editingButtonData,
        button: updatedButton,
      });
    }
    
    // 提示用户保存
    if (updatedButton.linked_screen_id) {
      const targetScreen = screens.find(s => s.id === updatedButton.linked_screen_id);
      toast.success(`✅ 按钮已设置跳转到: ${targetScreen?.name || '未知模版'}`);
    } else if (updatedButton.url) {
      toast.success(`✅ 按钮已设置 URL 链接`);
    } else {
      toast.success("✅ 按钮配置已更新");
    }
  };

  const handleButtonClick = (button: KeyboardButton) => {
    if (!isPreviewMode) {
      console.log('Button click ignored: not in preview mode');
      return;
    }
    
    console.log('Button clicked in preview:', {
      id: button.id,
      text: button.text,
      callback_data: button.callback_data,
      url: button.url,
      linked_screen_id: button.linked_screen_id,
      currentScreenId,
      navigationHistoryLength: navigationHistory.length,
      screensAvailable: screens.length,
    });
    
    // 优先处理 linked_screen_id 跳转
    if (button.linked_screen_id) {
      const targetScreen = screens.find(s => s.id === button.linked_screen_id);
      if (!targetScreen) {
        toast.error("❌ 目标模版不存在或已被删除");
        console.error('Target screen not found:', {
          linkedScreenId: button.linked_screen_id,
          availableScreens: screens.map(s => ({ id: s.id, name: s.name })),
          totalScreens: screens.length,
        });
        return;
      }
      
      // 确保不重复跳转到当前页面
      if (button.linked_screen_id === currentScreenId) {
        toast.warning("⚠️ 已在当前模版");
        console.log('Navigation prevented: already on target screen');
        return;
      }
      
      console.log('Navigating to linked screen:', {
        from: currentScreenId,
        fromName: screens.find(s => s.id === currentScreenId)?.name,
        to: button.linked_screen_id,
        toName: targetScreen.name,
        historyLength: navigationHistory.length,
      });
      
      try {
        loadScreen(button.linked_screen_id, true);
        toast.success(`✅ 已跳转到: ${targetScreen.name}`);
      } catch (error) {
        console.error('Navigation error:', error);
        toast.error('❌ 跳转失败，请重试');
      }
      return;
    }
    
    // 处理 URL 链接
    if (button.url) {
      console.log('Opening URL:', button.url);
      try {
        window.open(button.url, '_blank', 'noopener,noreferrer');
        toast.info('🔗 已打开链接');
      } catch (error) {
        toast.error('❌ 链接打开失败');
        console.error('Failed to open URL:', error);
      }
      return;
    }
    
    // 处理普通回调数据（包括 goto_screen_ 格式的回调）
    if (button.callback_data) {
      // 检查是否是 goto_screen_ 格式的回调
      if (button.callback_data.startsWith('goto_screen_')) {
        const targetId = button.callback_data.replace('goto_screen_', '');
        const targetScreen = screens.find(s => s.id === targetId);
        if (targetScreen) {
          if (targetId === currentScreenId) {
            toast.warning("⚠️ 已在当前模版");
            console.log('Navigation prevented: already on target screen');
            return;
          }
          
          console.log('Navigating to screen (via callback_data):', {
            from: currentScreenId,
            to: targetId,
            targetName: targetScreen.name,
          });
          
          try {
            loadScreen(targetId, true);
            toast.success(`✅ 已跳转到: ${targetScreen.name}`);
          } catch (error) {
            console.error('Navigation error:', error);
            toast.error('❌ 跳转失败，请重试');
          }
        } else {
          toast.error("❌ 目标模版不存在");
          console.error('Target screen not found:', targetId);
        }
      } else {
        toast.info(`📋 回调数据: ${button.callback_data}`);
        console.log('Callback data triggered:', button.callback_data);
      }
      return;
    }
    
    // 按钮没有配置任何操作
    console.warn('Button clicked but no action configured:', button);
    toast.warning('⚠️ 此按钮未配置操作');
  };

  const handleDeleteButton = (rowId: string, buttonId: string) => {
    setKeyboard((prev) => {
      const newKeyboard = prev.map((row) => {
        if (row.id === rowId) {
          return {
            ...row,
            buttons: row.buttons.filter((btn) => btn.id !== buttonId),
          };
        }
        return row;
      });
      
      return newKeyboard.filter((row) => row.buttons.length > 0);
    });
  };

  const handleFormatClick = (format: 'bold' | 'italic' | 'code' | 'link') => {
    if (format === 'link') {
      const url = prompt('Enter URL:');
      if (url) {
        messageBubbleRef.current?.applyFormat('link', url);
      }
    } else {
      messageBubbleRef.current?.applyFormat(format);
    }
    messageBubbleRef.current?.focus();
  };

  if (!user) {
    return null;
  }

  return (
    <>
      {/* 快速配置对话框 - 用于新建按钮 */}
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
            loadScreen(screenId);
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleImportJSON}>导入</Button>
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

      <div className="min-h-screen bg-telegram-bg flex items-center justify-center p-4">
        <div className="w-full max-w-md">
        {/* Builder Controls */}
        <div className="mb-4 bg-card text-card-foreground p-3 rounded-lg shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">Telegram UI 构建器</h1>
              {hasUnsavedChanges && (
                <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full animate-pulse">
                  未保存
                </span>
              )}
            </div>
            <Button onClick={handleLogout} variant="ghost" size="sm">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
          {loadIssue && (
            <Alert className="mb-2 border-amber-500/50 bg-amber-500/10">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-foreground">
                {loadIssue}
              </AlertDescription>
            </Alert>
          )}
          
          {/* 面包屑导航 - 显示当前位置 */}
          {isPreviewMode && (
            <div className="mb-2 p-2 bg-muted/50 rounded text-xs">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground">导航路径:</span>
                {navigationHistory.length === 0 ? (
                  <span className="font-medium">首页</span>
                ) : (
                  <>
                    {navigationHistory.map((historyId, index) => {
                      const screen = screens.find(s => s.id === historyId);
                      return screen ? (
                        <span key={historyId} className="flex items-center gap-1">
                          <span className="text-muted-foreground">/</span>
                          <span className="text-muted-foreground">{screen.name}</span>
                        </span>
                      ) : null;
                    })}
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground">/</span>
                      <span className="font-medium text-primary">
                        {screens.find(s => s.id === currentScreenId)?.name || "当前页"}
                      </span>
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
          
          {/* 当前编辑模版提示 */}
          {!isPreviewMode && currentScreenId && (
            <div className="mb-2 p-2 bg-primary/10 rounded text-xs flex items-center justify-between">
              <span>
                正在编辑: <span className="font-medium">{screens.find(s => s.id === currentScreenId)?.name}</span>
              </span>
              {hasUnsavedChanges && (
                <span className="text-orange-600 font-medium">● 有未保存更改</span>
              )}
            </div>
          )}
          
          {/* 撤销/重做工具栏 - 仅编辑模式显示 */}
          {!isPreviewMode && (
            <div className="mb-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  undo();
                  toast.info('↶ 已撤销');
                }}
                disabled={!canUndo}
                className="flex-1"
                title="撤销 (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4 mr-1" />
                撤销
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  redo();
                  toast.info('↷ 已重做');
                }}
                disabled={!canRedo}
                className="flex-1"
                title="重做 (Ctrl+Shift+Z)"
              >
                <Redo2 className="w-4 h-4 mr-1" />
                重做
              </Button>
            </div>
          )}
          
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Input
              placeholder="模版名称"
              value={newScreenName}
              onChange={(e) => setNewScreenName(e.target.value)}
              className="sm:max-w-xs"
            />
            <Button 
              onClick={currentScreenId ? updateScreen : saveScreen} 
              className="sm:w-auto" 
              title="保存 (Ctrl+S)"
              disabled={isLoading}
            >
              <Save className="w-4 h-4 mr-2" /> 
              {isLoading ? "保存中..." : (currentScreenId ? "更新" : "保存")}
            </Button>
            <Button onClick={createNewScreen} variant="outline" className="sm:w-auto" title="新建 (Ctrl+N)">
              <FileText className="w-4 h-4 mr-2" /> 新建
            </Button>
            {/* 允许循环引用开关 */}
            <div className="flex items-center gap-2 ml-auto">
              <Label htmlFor="allow-circular" className="text-xs text-muted-foreground">允许循环引用</Label>
              <Switch
                id="allow-circular"
                checked={allowCircular}
                onCheckedChange={(v) => setAllowCircular(!!v)}
              />
            </div>
          </div>

          {/* 保存状态条 */}
          <div className="mt-2 p-2 bg-muted/50 rounded text-xs flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isOffline && (
                <span className="text-amber-600">⚠️ 离线：操作将暂存，恢复联网后再试</span>
              )}
              {isLoading ? (
                <span className="text-muted-foreground">💾 保存中...</span>
              ) : lastError ? (
                <span className="text-destructive">❌ 保存失败：{lastError}</span>
              ) : lastSavedAt ? (
                <span className="text-muted-foreground">
                  ✅ 已保存于 {new Date(lastSavedAt).toLocaleTimeString()}
                </span>
              ) : (
                <span className="text-muted-foreground">尚未保存</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {lastError && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isLoading}
                    onClick={() => {
                      if (currentScreenId) {
                        updateScreen();
                      } else {
                        saveScreen();
                      }
                    }}
                  >
                    重试
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setLastError(null)}>忽略</Button>
                </>
              )}
            </div>
          </div>
          
          {screens.length > 0 && (
            <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
              <Select value={currentScreenId} onValueChange={loadScreen}>
                <SelectTrigger className="sm:w-64">
                  <SelectValue placeholder="加载模版" />
                </SelectTrigger>
                <SelectContent>
                  {screens.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {isPinned(s.id) ? '★ ' : ''}{s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button
                  variant={isPinned(currentScreenId) ? "default" : "outline"}
                  onClick={() => {
                    if (!currentScreenId) return;
                    setPinnedIds(prev => {
                      const next = prev.includes(currentScreenId)
                        ? prev.filter(id => id !== currentScreenId)
                        : [...prev, currentScreenId];
                      persistPinned(next);
                      // 仅本地重排
                      setScreens(curr => reorderByPinned(curr));
                      return next;
                    });
                  }}
                  disabled={!currentScreenId}
                  className="flex-1 sm:flex-none"
                  title={isPinned(currentScreenId) ? "取消置顶" : "置顶"}
                >
                  {isPinned(currentScreenId) ? <Star className="w-4 h-4 mr-2" /> : <StarOff className="w-4 h-4 mr-2" />}
                  {isPinned(currentScreenId) ? '已置顶' : '置顶'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => currentScreenId && deleteScreen(currentScreenId)}
                  disabled={!currentScreenId}
                  className="flex-1 sm:flex-none"
                >
                  <Trash2 className="w-4 h-4 mr-2" /> 删除
                </Button>
                <Button
                  variant="outline"
                  onClick={shareScreen}
                  disabled={!currentScreenId}
                  className="flex-1 sm:flex-none"
                >
                  <Share2 className="w-4 h-4 mr-2" /> 分享
                </Button>
              </div>
            </div>
          )}

          {/* Mode Toggle */}
          <div className="mt-2 flex gap-2">
            <Button
              variant={isPreviewMode ? "default" : "outline"}
              onClick={handleModeToggle}
              className="flex-1"
            >
              {isPreviewMode ? <Eye className="w-4 h-4 mr-2" /> : <Edit className="w-4 h-4 mr-2" />}
              {isPreviewMode ? "🔍 预览模式" : "✏️ 编辑模式"}
            </Button>
          </div>
          
          {/* 循环引用提示 - 允许时弱提示，禁止时警告 */}
          {!isPreviewMode && screens.length > 0 && (() => {
            if (circularReferences.length > 0) {
              return (
                <Alert className={`mt-2 ${allowCircular ? 'border-amber-500/50 bg-amber-500/10' : 'border-destructive/50 bg-destructive/10'}`}>
                  <AlertCircle className={`h-4 w-4 ${allowCircular ? 'text-amber-600' : 'text-destructive'}`} />
                  <AlertDescription className="text-xs text-foreground">
                    <strong>
                      {allowCircular
                        ? `⚠️ 检测到 ${circularReferences.length} 个循环引用（已允许）`
                        : `⚠️ 检测到 ${circularReferences.length} 个循环引用（已禁止）`}
                    </strong>
                    {circularReferences.slice(0, 2).map((circle, idx) => (
                      <div key={idx} className="mt-1 text-muted-foreground">
                        • {circle.screenNames.join(' → ')}
                      </div>
                    ))}
                    {circularReferences.length > 2 && (
                      <div className="mt-1 text-muted-foreground">
                        还有 {circularReferences.length - 2} 个循环...
                      </div>
                    )}
                    {!allowCircular && (
                      <div className="mt-1 text-muted-foreground">当前已禁止循环引用，请调整后再保存。</div>
                    )}
                  </AlertDescription>
                </Alert>
              );
            }
            return null;
          })()}
          
          {/* Navigation History - 仅在预览模式显示 */}
          {isPreviewMode && navigationHistory.length > 0 && (
            <div className="mt-2">
              <Button
                variant="outline"
                onClick={navigateBack}
                className="w-full"
              >
                <Edit2 className="w-4 h-4 mr-2 rotate-180" />
                返回上一级 ({navigationHistory.length} 步历史)
              </Button>
            </div>
          )}

          {/* Export/Import Section */}
          <div className="mt-2 flex gap-2">
            <Button
              variant="outline"
              onClick={() => setImportDialogOpen(true)}
              className="flex-1"
            >
              <Upload className="w-4 h-4 mr-2" /> 导入
            </Button>
            <Button
              variant="outline"
              onClick={handleCopyJSON}
              className="flex-1"
            >
              <Copy className="w-4 h-4 mr-2" /> 复制
            </Button>
            <Button
              variant="outline"
              onClick={handleExportJSON}
              className="flex-1"
            >
              <Download className="w-4 h-4 mr-2" /> 单个
            </Button>
            <Button
              variant="outline"
              onClick={exportFlowAsJSON}
              className="flex-1"
              disabled={screens.length === 0}
            >
              <Download className="w-4 h-4 mr-2" /> 流程
            </Button>
          </div>
          
          {/* Template Relationship Diagram */}
          {screens.length > 0 && (
            <div className="mt-2">
              <Button
                variant="outline"
                onClick={() => setFlowDiagramOpen(true)}
                className="w-full"
              >
                <Network className="w-4 h-4 mr-2" /> 查看关系图
              </Button>
            </div>
          )}

          {currentScreenId && (
            <Button
              variant="ghost"
              onClick={openRenameDialog}
              className="w-full mt-2"
              size="sm"
            >
              <Edit2 className="w-4 h-4 mr-2" /> 重命名当前模版
            </Button>
          )}
        </div>

        {/* Format Preview Card */}
        <div className="mb-4 bg-muted/50 p-3 rounded-lg">
          <details className="cursor-pointer" open>
            <summary className="text-sm font-semibold mb-2">Telegram API 预览（可编辑）</summary>
            <Textarea
              value={editableJSON || JSON.stringify(convertToTelegramFormat(), null, 2)}
              onChange={(e) => setEditableJSON(e.target.value)}
              className="font-mono text-xs min-h-[200px] mb-2"
              placeholder="编辑 JSON..."
            />
            <Button
              onClick={handleApplyEditedJSON}
              size="sm"
              className="w-full"
            >
              应用 JSON 修改
            </Button>
          </details>
        </div>

        {/* Telegram Header */}
        <div className="bg-telegram-header shadow-lg rounded-t-2xl overflow-hidden">
          <div className="px-4 py-3 flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold">
              TB
            </div>
            <div className="flex-1">
              <h2 className="text-white font-semibold text-base">Telegram 机器人</h2>
              <p className="text-white/70 text-xs">在线</p>
            </div>
          </div>
        </div>

        {/* Chat Container */}
        <div className="bg-telegram-bg shadow-lg font-telegram">
          <div className="p-4 min-h-[300px]">
            <div className="inline-block max-w-[85%]">
              <MessageBubble
                ref={messageBubbleRef}
                content={messageContent}
                onContentChange={setMessageContent}
              />
              <InlineKeyboard
                keyboard={keyboard}
                onButtonTextChange={handleButtonTextChange}
                onButtonUpdate={handleButtonUpdate}
                onDeleteButton={handleDeleteButton}
                onButtonClick={handleButtonClick}
                isPreviewMode={isPreviewMode}
                screens={screens}
              />
            </div>
          </div>

          {/* Formatting Toolbar */}
          <div className="px-4 pb-2 flex gap-2 border-t border-border/50 pt-3">
            <Button
              onClick={() => handleFormatClick('bold')}
              variant="outline"
              size="sm"
              className="flex-1"
              title="粗体 (Ctrl+B)"
            >
              <Bold className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => handleFormatClick('italic')}
              variant="outline"
              size="sm"
              className="flex-1"
              title="斜体 (Ctrl+I)"
            >
              <Italic className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => handleFormatClick('code')}
              variant="outline"
              size="sm"
              className="flex-1"
              title="代码块"
            >
              <Code className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => handleFormatClick('link')}
              variant="outline"
              size="sm"
              className="flex-1"
              title="链接"
            >
              <Link className="w-4 h-4" />
            </Button>
          </div>

          {/* Action Buttons */}
          <div className="px-4 pb-4 flex gap-2">
            <Button
              onClick={handleAddButton}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="w-4 h-4 mr-2" />
              添加按钮
            </Button>
            <Button
              onClick={handleAddRow}
              variant="outline"
              className="flex-1 border-primary text-primary hover:bg-primary/10"
            >
              <Plus className="w-4 h-4 mr-2" />
              添加行
            </Button>
          </div>
        </div>

        <div className="h-2 bg-telegram-bg rounded-b-2xl shadow-lg"></div>
        </div>
      </div>
      
      {/* Template Flow Diagram */}
      <TemplateFlowDiagram
        screens={screens}
        currentScreenId={currentScreenId}
        open={flowDiagramOpen}
        onOpenChange={setFlowDiagramOpen}
        onScreenClick={(screenId) => {
          loadScreen(screenId);
          toast.success(`✅ 已跳转到: ${screens.find(s => s.id === screenId)?.name}`);
        }}
      />

      {/* Circular Reference Dialog */}
      <CircularReferenceDialog
        open={circularDialogOpen}
        onOpenChange={setCircularDialogOpen}
        circularPaths={detectedCircularPaths}
        screens={screens}
        currentScreenId={currentScreenId}
        onNavigateToScreen={(screenId) => {
          loadScreen(screenId);
          toast.success(`✅ 已跳转到: ${screens.find(s => s.id === screenId)?.name}`);
        }}
        onOpenFlowDiagram={() => {
          setCircularDialogOpen(false);
          setFlowDiagramOpen(true);
        }}
      />
    </>
  );
};

export default TelegramChatWithDB;
