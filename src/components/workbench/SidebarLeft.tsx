
import React from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogOut, FileText, Save, Trash2, Star, StarOff, Home, ArrowUpDown, Trash, Upload, Copy, Download, Network, Share2, RefreshCw, EyeOff } from "lucide-react";
import { Screen } from "@/types/telegram";
import type { User } from "@supabase/supabase-js";

interface SidebarLeftProps {
    user: User;
    screens: Screen[];
    currentScreenId: string | undefined;
    entryScreenId: string | null;
    pinnedIds: string[];
    isLoading: boolean;
    isClearingScreens: boolean;
    shareLoading: boolean;
    hasUnsavedChanges: boolean;
    isOffline: boolean;

    onLogout: () => void;
    onLoadScreen: (id: string) => void;
    onNewScreen: () => void;
    onSaveScreen: () => void;
    onUpdateScreen: () => void;
    onDeleteScreen: (id: string) => void;
    onDeleteAllScreens: () => void;
    onTogglePin: () => void;
    onSetEntry: () => void;
    onJumpToEntry: () => void;
    onCopyOrShare: () => void;
    onRotateShareLink: () => void;
    onUnshareScreen: () => void;

    // Import/Export
    onOpenImport: () => void;
    onCopyJSON: () => void;
    onExportJSON: () => void;
    onExportFlow: () => void;
    onOpenFlowDiagram: () => void;
}

export const SidebarLeft: React.FC<SidebarLeftProps> = ({
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
    onLogout,
    onLoadScreen,
    onNewScreen,
    onSaveScreen,
    onUpdateScreen,
    onDeleteScreen,
    onDeleteAllScreens,
    onTogglePin,
    onSetEntry,
    onJumpToEntry,
    onCopyOrShare,
    onRotateShareLink,
    onUnshareScreen,
    onOpenImport,
    onCopyJSON,
    onExportJSON,
    onExportFlow,
    onOpenFlowDiagram,
}) => {
    const isPinned = (id?: string) => !!id && pinnedIds.includes(id);

    return (
        <div className="flex flex-col h-full p-4 space-y-4">
            {/* Header / User */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <h1 className="text-lg font-bold">Telegram UI</h1>
                    {hasUnsavedChanges && (
                        <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full animate-pulse">
                            未保存
                        </span>
                    )}
                    {isOffline && (
                        <span className="text-xs bg-slate-500 text-white px-2 py-0.5 rounded-full">
                            离线
                        </span>
                    )}
                </div>
                <Button onClick={onLogout} variant="ghost" size="icon" title="退出登录">
                    <LogOut className="w-4 h-4" />
                </Button>
            </div>

            <Separator />

            {/* Main Actions */}
            <div className="space-y-2">
                <Button
                    onClick={currentScreenId ? onUpdateScreen : onSaveScreen}
                    className="w-full justify-start"
                    disabled={isLoading}
                >
                    <Save className="w-4 h-4 mr-2" />
                    {isLoading ? "保存中..." : (currentScreenId ? "保存修改" : "保存新模版")}
                </Button>
                <Button onClick={onNewScreen} variant="outline" className="w-full justify-start">
                    <FileText className="w-4 h-4 mr-2" /> 新建模版
                </Button>
            </div>

            <Separator />

            {/* Template List */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">模版列表</h3>
                <Select value={currentScreenId} onValueChange={onLoadScreen}>
                    <SelectTrigger>
                        <SelectValue placeholder="选择模版..." />
                    </SelectTrigger>
                    <SelectContent>
                        {screens.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                                {entryScreenId === s.id ? '🏠 ' : isPinned(s.id) ? '★ ' : ''}{s.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Template Actions */}
            {currentScreenId && (
                <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            variant={isPinned(currentScreenId) ? "default" : "outline"}
                            onClick={onTogglePin}
                            size="sm"
                            className="justify-start"
                        >
                            {isPinned(currentScreenId) ? <Star className="w-4 h-4 mr-2" /> : <StarOff className="w-4 h-4 mr-2" />}
                            {isPinned(currentScreenId) ? '已置顶' : '置顶'}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => onDeleteScreen(currentScreenId)}
                            size="sm"
                            className="justify-start text-destructive hover:text-destructive"
                        >
                            <Trash2 className="w-4 h-4 mr-2" /> 删除
                        </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            variant={entryScreenId === currentScreenId ? "default" : "outline"}
                            onClick={onSetEntry}
                            size="sm"
                            className="justify-start"
                        >
                            <Home className="w-4 h-4 mr-2" /> {entryScreenId === currentScreenId ? '入口' : '设为入口'}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={!entryScreenId || !screens.some(s => s.id === entryScreenId)}
                            onClick={onJumpToEntry}
                            size="sm"
                            className="justify-start"
                        >
                            <ArrowUpDown className="w-4 h-4 mr-2" /> 跳转入口
                        </Button>
                    </div>
                </div>
            )}

            <Separator />

            {/* Share Actions */}
            {currentScreenId && (
                <div className="space-y-2">
                    <h3 className="text-sm font-medium text-muted-foreground">分享设置</h3>
                    <Button
                        variant="outline"
                        onClick={onCopyOrShare}
                        disabled={shareLoading}
                        className="w-full justify-start"
                        size="sm"
                    >
                        <Share2 className="w-4 h-4 mr-2" />
                        {shareLoading ? "处理中..." : "生成/复制分享链接"}
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            variant="outline"
                            onClick={onRotateShareLink}
                            disabled={shareLoading}
                            size="sm"
                            className="justify-start"
                        >
                            <RefreshCw className="w-4 h-4 mr-2" /> 刷新链接
                        </Button>
                        <Button
                            variant="outline"
                            onClick={onUnshareScreen}
                            disabled={shareLoading}
                            size="sm"
                            className="justify-start text-destructive hover:text-destructive"
                        >
                            <EyeOff className="w-4 h-4 mr-2" /> 取消公开
                        </Button>
                    </div>
                </div>
            )}

            <Separator />

            {/* Import/Export */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">数据管理</h3>
                <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={onOpenImport} size="sm" className="justify-start">
                        <Upload className="w-4 h-4 mr-2" /> 导入
                    </Button>
                    <Button variant="outline" onClick={onCopyJSON} size="sm" className="justify-start">
                        <Copy className="w-4 h-4 mr-2" /> 复制 JSON
                    </Button>
                    <Button variant="outline" onClick={onExportJSON} size="sm" className="justify-start">
                        <Download className="w-4 h-4 mr-2" /> 导出单个
                    </Button>
                    <Button variant="outline" onClick={onExportFlow} size="sm" className="justify-start" disabled={screens.length === 0}>
                        <Download className="w-4 h-4 mr-2" /> 导出流程
                    </Button>
                </div>

                {screens.length > 0 && (
                    <Button variant="outline" onClick={onOpenFlowDiagram} className="w-full justify-start" size="sm">
                        <Network className="w-4 h-4 mr-2" /> 查看关系图
                    </Button>
                )}
            </div>

            <div className="flex-1" />

            {/* Danger Zone */}
            <div className="space-y-2">
                <Button
                    variant="destructive"
                    onClick={onDeleteAllScreens}
                    disabled={screens.length === 0 || isClearingScreens}
                    className="w-full"
                    size="sm"
                >
                    <Trash className="w-4 h-4 mr-2" />
                    {isClearingScreens ? "清空全部中..." : "清空全部模版"}
                </Button>
            </div>
        </div>
    );
};
