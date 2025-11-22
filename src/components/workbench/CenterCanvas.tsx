import React from "react";
import { Button } from "@/components/ui/button";
import { Eye, Edit, Undo2, Redo2, Edit2 } from "lucide-react";
import MessageBubble, { MessageBubbleHandle } from "../MessageBubble";
import InlineKeyboard from "../InlineKeyboard";
import { Screen, KeyboardRow, KeyboardButton } from "@/types/telegram";
import { SyncStatus } from "@/types/sync";

interface CenterCanvasProps {
    messageContent: string;
    setMessageContent: (content: string | ((prev: string) => string)) => void;
    keyboard: KeyboardRow[];

    // Handlers
    onButtonTextChange: (rowId: string, buttonId: string, newText: string) => void;
    onButtonUpdate: (rowId: string, buttonId: string, updatedButton: KeyboardButton) => void;
    onDeleteButton: (rowId: string, buttonId: string) => void;
    onButtonClick: (button: KeyboardButton) => void;

    // State
    isPreviewMode: boolean;
    onToggleMode: () => void;

    // Undo/Redo
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;

    // Refs
    messageBubbleRef: React.RefObject<MessageBubbleHandle>;

    // Context
    screens: Screen[];
    navigationHistory: string[];
    onNavigateBack: () => void;
    currentScreenName?: string;
    // Status
    hasUnsavedChanges?: boolean;
    isOffline?: boolean;
    shareSyncStatus?: SyncStatus;
    layoutSyncStatus?: SyncStatus;
    pendingQueueSize?: number;
}

export const CenterCanvas = React.memo<CenterCanvasProps>(({
    messageContent,
    setMessageContent,
    keyboard,
    onButtonTextChange,
    onButtonUpdate,
    onDeleteButton,
    onButtonClick,
    isPreviewMode,
    onToggleMode,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    messageBubbleRef,
    screens,
    navigationHistory,
    onNavigateBack,
    currentScreenName,
    hasUnsavedChanges,
    isOffline,
    shareSyncStatus,
    layoutSyncStatus,
    pendingQueueSize,
}) => {
    React.useEffect(() => {
        const savedTheme = localStorage.getItem("theme");
        if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
            document.documentElement.classList.add("dark");
        } else {
            document.documentElement.classList.remove("dark");
        }
    }, []);

    const renderStatusBadge = (label: string, status?: SyncStatus) => {
        if (!status || status.state === "idle") return null;
        const color =
            status.state === "success" ? "bg-emerald-500/20 text-emerald-700 border-emerald-500/50" :
                status.state === "error" ? "bg-destructive/10 text-destructive border-destructive/50" :
                    "bg-amber-500/10 text-amber-700 border-amber-500/50";
        const text =
            status.state === "success" ? `${label}已同步` :
                status.state === "error" ? `${label}失败` :
                    `${label}中`;
        return (
            <span
                className={`px-2 py-0.5 text-[10px] rounded-full border inline-flex items-center gap-1 ${color}`}
                title={status.message || status.requestId}
            >
                {text}
            </span>
        );
    };

    return (
        <div className="flex flex-col items-center w-full max-w-md mx-auto h-full">
            {/* Canvas Toolbar */}
            <div className="w-full flex justify-between items-center mb-4 bg-card/80 backdrop-blur p-2 rounded-lg shadow-sm border border-border/50 sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <Button
                        variant={isPreviewMode ? "default" : "ghost"}
                        size="sm"
                        onClick={onToggleMode}
                        className="h-8"
                    >
                        {isPreviewMode ? <Eye className="w-3 h-3 mr-2" /> : <Edit className="w-3 h-3 mr-2" />}
                        {isPreviewMode ? "预览" : "编辑"}
                    </Button>

                    {/* Breadcrumbs / Title */}
                    <div className="flex items-center gap-2 ml-2">
                        <span className="text-xs text-muted-foreground font-medium">
                            {currentScreenName || "未命名模版"}
                        </span>
                        {hasUnsavedChanges && (
                            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" title="未保存" />
                        )}
                        {isOffline && (
                            <span className="w-2 h-2 rounded-full bg-slate-500" title="离线" />
                        )}
                        {renderStatusBadge("分享", shareSyncStatus)}
                        {renderStatusBadge("布局", layoutSyncStatus)}
                        {pendingQueueSize && pendingQueueSize > 0 && (
                            <span
                                className="px-2 py-0.5 text-[10px] rounded-full border bg-amber-500/10 text-amber-700 border-amber-500/50"
                                title="未同步的请求数"
                            >
                                待同步 {pendingQueueSize}
                            </span>
                        )}
                    </div>
                </div>

                {!isPreviewMode && (
                    <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo} className="h-8 w-8" title="撤销">
                            <Undo2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={onRedo} disabled={!canRedo} className="h-8 w-8" title="重做">
                            <Redo2 className="w-4 h-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                                const isDark = document.documentElement.classList.toggle("dark");
                                localStorage.setItem("theme", isDark ? "dark" : "light");
                            }}
                            className="h-8 w-8 ml-2"
                            title="切换日间/夜间模式"
                        >
                            <span className="dark:hidden">🌙</span>
                            <span className="hidden dark:inline">☀️</span>
                        </Button>
                    </div>
                )}
            </div>

            {/* Navigation Back Button (Preview Mode) */}
            {isPreviewMode && navigationHistory.length > 0 && (
                <Button
                    variant="outline"
                    onClick={onNavigateBack}
                    className="w-full mb-4"
                    size="sm"
                >
                    <Edit2 className="w-4 h-4 mr-2 rotate-180" />
                    返回 ({navigationHistory.length})
                </Button>
            )}

            {/* Phone Simulator */}
            <div className="w-full bg-telegram-bg shadow-xl rounded-3xl overflow-hidden border-8 border-slate-800 ring-1 ring-slate-900/10 relative transition-colors duration-300">
                {/* Status Bar Mockup */}
                <div className="bg-telegram-header h-8 w-full" />

                {/* Header */}
                <div className="bg-telegram-header px-4 py-3 flex items-center space-x-3 shadow-md relative z-10">
                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm">
                        TB
                    </div>
                    <div className="flex-1">
                        <h2 className="text-white font-semibold text-sm">Telegram Bot</h2>
                        <p className="text-white/70 text-xs">bot</p>
                    </div>
                </div>

                {/* Content Area */}
                <div className="min-h-[500px] p-4 font-telegram relative">
                    {/* Background Pattern could go here */}
                    <div className="inline-block max-w-[90%] w-full">
                        <MessageBubble
                            ref={messageBubbleRef}
                            content={messageContent}
                            onContentChange={setMessageContent}
                        />
                        <InlineKeyboard
                            keyboard={keyboard}
                            onButtonTextChange={onButtonTextChange}
                            onButtonUpdate={onButtonUpdate}
                            onDeleteButton={onDeleteButton}
                            onButtonClick={onButtonClick}
                            isPreviewMode={isPreviewMode}
                            screens={screens}
                        />
                    </div>
                </div>

                {/* Home Indicator Mockup */}
                <div className="h-6 bg-telegram-bg w-full flex justify-center items-center">
                    <div className="w-32 h-1 bg-black/20 rounded-full" />
                </div>
            </div>
        </div>
    );
});

export default CenterCanvas;
