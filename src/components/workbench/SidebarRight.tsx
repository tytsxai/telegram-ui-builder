import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Bold, Italic, Code, Link, Plus, Edit2 } from "lucide-react";

interface SidebarRightProps {
    newScreenName: string;
    onNewScreenNameChange: (name: string) => void;

    // Message Formatting
    onFormatClick: (format: 'bold' | 'italic' | 'code' | 'link') => void;
    parseMode: "HTML" | "MarkdownV2";
    onParseModeChange: (mode: "HTML" | "MarkdownV2") => void;
    messageType: "text" | "photo" | "video";
    mediaUrl: string;
    onMessageTypeChange: (type: "text" | "photo" | "video") => void;
    onMediaUrlChange: (url: string) => void;

    // Keyboard Controls
    onAddButton: () => void;
    onAddRow: () => void;

    // Settings
    allowCircular: boolean;
    onAllowCircularChange: (val: boolean) => void;
    isOffline: boolean;

    // Rename
    currentScreenId?: string;
    onOpenRenameDialog: () => void;
}

export const SidebarRight: React.FC<SidebarRightProps> = ({
    newScreenName,
    onNewScreenNameChange,
    onFormatClick,
    onAddButton,
    onAddRow,
    allowCircular,
    onAllowCircularChange,
    isOffline,
    currentScreenId,
    onOpenRenameDialog,
    parseMode,
    onParseModeChange,
    messageType,
    mediaUrl,
    onMessageTypeChange,
    onMediaUrlChange,
}) => {
    return (
        <div className="flex flex-col h-full p-4 space-y-6">
            {/* Screen Properties */}
            <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">属性设置</h3>

                <div className="space-y-2">
                    <Label>模版名称</Label>
                    <div className="flex gap-2">
                        <Input
                            placeholder="输入名称..."
                            value={newScreenName}
                            onChange={(e) => onNewScreenNameChange(e.target.value)}
                            className="flex-1"
                        />
                    </div>
                    {currentScreenId && (
                        <Button
                            variant="ghost"
                            onClick={onOpenRenameDialog}
                            className="w-full justify-start h-8 px-2 text-xs"
                        >
                            <Edit2 className="w-3 h-3 mr-2" /> 重命名当前模版
                        </Button>
                    )}
                </div>
            </div>

            <Separator />

            {/* Message Editor Controls */}
            <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">消息内容</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="space-y-1">
                        <Label>Parse Mode</Label>
                        <select
                            value={parseMode}
                            onChange={(e) => onParseModeChange(e.target.value as any)}
                            className="w-full h-8 rounded border bg-background text-foreground text-xs px-2"
                        >
                            <option value="HTML">HTML</option>
                            <option value="MarkdownV2">MarkdownV2</option>
                        </select>
                    </div>
                    <div className="space-y-1">
                        <Label>消息类型</Label>
                        <select
                            value={messageType}
                            onChange={(e) => onMessageTypeChange(e.target.value as any)}
                            className="w-full h-8 rounded border bg-background text-foreground text-xs px-2"
                        >
                            <option value="text">文本</option>
                            <option value="photo">图片</option>
                            <option value="video">视频</option>
                        </select>
                    </div>
                </div>
                {messageType !== "text" && (
                    <div className="space-y-2">
                        <Label>媒体 URL</Label>
                        <Input
                            placeholder="https://..."
                            value={mediaUrl}
                            onChange={(e) => onMediaUrlChange(e.target.value)}
                            className="h-8 text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground">预览仅使用客户端，不会上传文件。</p>
                    </div>
                )}
                <div className="grid grid-cols-4 gap-2">
                    <Button onClick={() => onFormatClick('bold')} variant="outline" size="icon" title="粗体">
                        <Bold className="w-4 h-4" />
                    </Button>
                    <Button onClick={() => onFormatClick('italic')} variant="outline" size="icon" title="斜体">
                        <Italic className="w-4 h-4" />
                    </Button>
                    <Button onClick={() => onFormatClick('code')} variant="outline" size="icon" title="代码">
                        <Code className="w-4 h-4" />
                    </Button>
                    <Button onClick={() => onFormatClick('link')} variant="outline" size="icon" title="链接">
                        <Link className="w-4 h-4" />
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                    在中间画布直接编辑文本，使用上方工具栏格式化。
                </p>
            </div>

            <Separator />

            {/* Keyboard Controls */}
            <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">按钮键盘</h3>
                <div className="space-y-2">
                    <Button onClick={onAddButton} className="w-full" variant="secondary">
                        <Plus className="w-4 h-4 mr-2" /> 添加按钮
                    </Button>
                    <Button onClick={onAddRow} className="w-full" variant="outline">
                        <Plus className="w-4 h-4 mr-2" /> 添加新行
                    </Button>
                </div>
            </div>

            <Separator />

            {/* Advanced Settings */}
            <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">高级设置</h3>
                <div className="flex items-center justify-between">
                    <Label htmlFor="allow-circular" className="text-xs">允许循环引用</Label>
                    <Switch
                        id="allow-circular"
                        checked={allowCircular}
                        onCheckedChange={onAllowCircularChange}
                    />
                </div>
                <div className="text-xs text-muted-foreground">
                    {isOffline ? "⚠️ 离线模式" : "✅ 在线模式"}
                </div>
            </div>
        </div>
    );
};
