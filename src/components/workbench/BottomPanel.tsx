import React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface BottomPanelProps {
    editableJSON: string;
    onEditableJSONChange: (value: string) => void;
    onApplyJSON: () => void;
    jsonSyncError: string | null;
    isImporting: boolean;

    // Logs / Alerts
    loadIssue: string | null;
    circularReferences: Array<{ path: string[]; screenNames: string[] }>;
    allowCircular: boolean;
    pendingOpsNotice?: boolean;
    pendingQueueSize?: number;
    onRetryPendingOps?: () => void;
    onClearPendingOps?: () => void;
    pendingItems?: Array<{
        id: string;
        kind: string;
        attempts?: number;
        lastError?: string;
        lastAttemptAt?: number;
        createdAt?: number;
        failures?: Array<{ at: number; message: string }>;
    }>;
    onExportPending?: () => void;
    retryingQueue?: boolean;
    isOffline?: boolean;
    codegenFramework: "python-telegram-bot" | "aiogram" | "telegraf";
    onCodegenFrameworkChange: (fw: "python-telegram-bot" | "aiogram" | "telegraf") => void;
    codegenOutput: string;
    onCopyCodegen: () => void;
}

export const BottomPanel: React.FC<BottomPanelProps> = ({
    editableJSON,
    onEditableJSONChange,
    onApplyJSON,
    jsonSyncError,
    isImporting,
    loadIssue,
    circularReferences,
    allowCircular,
    pendingOpsNotice,
    pendingQueueSize,
    onRetryPendingOps,
    onClearPendingOps,
    pendingItems = [],
    onExportPending,
    retryingQueue,
    isOffline,
    codegenFramework,
    onCodegenFrameworkChange,
    codegenOutput,
    onCopyCodegen,
}) => {
    const [confirmOpen, setConfirmOpen] = React.useState(false);
    const hasPendingErrors = pendingItems.some((item) => !!item.lastError);
    const formatTimestamp = (value?: number) => {
        if (!value) return "未记录";
        try {
            return new Date(value).toLocaleTimeString();
        } catch {
            return "未记录";
        }
    };

    return (
        <div className="p-4 space-y-4">
            {/* Logs Section */}
            <div className="space-y-2">
                {pendingOpsNotice && (
                    <Alert className="border-amber-500/50 bg-amber-500/10 py-2">
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                        <AlertDescription className="text-xs text-foreground space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span>有未同步的保存请求（{pendingQueueSize ?? "?"}）</span>
                                    {isOffline && <Badge variant="outline" className="h-5 px-2 text-[11px] border-amber-300 text-amber-800">离线</Badge>}
                                    {retryingQueue && <Badge variant="secondary" className="h-5 px-2 text-[11px]">重试中</Badge>}
                                    {hasPendingErrors && <Badge variant="destructive" className="h-5 px-2 text-[11px]">存在错误</Badge>}
                                </div>
                                <span className="text-[11px] text-muted-foreground">可手动重放或导出队列</span>
                            </div>
                            <div className="flex flex-wrap gap-2 items-center">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={retryingQueue || isOffline}
                                    onClick={onRetryPendingOps}
                                >
                                    {retryingQueue ? "重试中..." : isOffline ? "离线中" : "立即重试同步"}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    disabled={retryingQueue}
                                    onClick={() => setConfirmOpen(true)}
                                >
                                    清空队列
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    disabled={!pendingItems.length}
                                    onClick={onExportPending}
                                >
                                    导出队列
                                </Button>
                            </div>
                            {pendingItems.length > 0 && (
                                <ScrollArea className="h-32 mt-2 rounded border border-amber-200/60">
                                    <div className="p-2 space-y-2 text-xs text-muted-foreground">
                                        {pendingItems.map((item) => {
                                            const lastFailure = item.failures?.[item.failures.length - 1];
                                            const lastMessage = lastFailure?.message ?? item.lastError ?? "待重试";
                                            const attempts = item.attempts ?? 0;
                                            return (
                                                <div key={item.id} className="rounded-md border border-amber-100 bg-amber-50/60 p-2 space-y-1">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-foreground">{item.kind} · {item.id.slice(0, 6)}</span>
                                                            <Badge variant="outline" className="h-5 px-2 text-[11px] border-amber-200 text-amber-800 bg-white">
                                                                尝试 {attempts}
                                                            </Badge>
                                                        </div>
                                                        <span className="text-[11px] text-muted-foreground">
                                                            {formatTimestamp(lastFailure?.at ?? item.lastAttemptAt ?? item.createdAt)}
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] text-amber-700 break-words">
                                                        {lastMessage}
                                                    </div>
                                                    {item.failures && item.failures.length > 1 && (
                                                        <div className="flex flex-wrap gap-1 pt-1">
                                                            {item.failures.slice(-3).map((failure, idx) => (
                                                                <Badge
                                                                    key={`${item.id}-${idx}`}
                                                                    variant="outline"
                                                                    className="h-5 px-2 text-[11px] border-amber-200 text-amber-800 bg-white"
                                                                >
                                                                    {formatTimestamp(failure.at)} · {failure.message}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </ScrollArea>
                            )}
                        </AlertDescription>
                    </Alert>
                )}
                {loadIssue && (
                    <Alert className="border-amber-500/50 bg-amber-500/10 py-2">
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                        <AlertDescription className="text-xs text-foreground">
                            {loadIssue}
                        </AlertDescription>
                    </Alert>
                )}

                {circularReferences.length > 0 && (
                    <Alert className={`py-2 ${allowCircular ? 'border-amber-500/50 bg-amber-500/10' : 'border-destructive/50 bg-destructive/10'}`}>
                        <AlertCircle className={`h-4 w-4 ${allowCircular ? 'text-amber-600' : 'text-destructive'}`} />
                        <AlertDescription className="text-xs text-foreground">
                            <strong>
                                {allowCircular
                                    ? `⚠️ 检测到 ${circularReferences.length} 个循环引用（已允许）`
                                    : `⚠️ 检测到 ${circularReferences.length} 个循环引用（已禁止）`}
                            </strong>
                            <div className="mt-1 max-h-20 overflow-y-auto">
                                {circularReferences.map((circle, idx) => (
                                    <div key={idx} className="text-muted-foreground">
                                        • {circle.screenNames.join(' → ')}
                                    </div>
                                ))}
                            </div>
                        </AlertDescription>
                    </Alert>
                )}
            </div>

            {/* Codegen */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-muted-foreground">代码生成</h3>
                    <div className="flex items-center gap-2">
                        <select
                            value={codegenFramework}
                            onChange={(e) => onCodegenFrameworkChange(e.target.value as "python-telegram-bot" | "aiogram" | "telegraf")}
                            className="h-8 rounded border bg-background text-foreground text-xs px-2"
                        >
                            <option value="python-telegram-bot">python-telegram-bot</option>
                            <option value="aiogram">aiogram</option>
                            <option value="telegraf">Telegraf (JS)</option>
                        </select>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCopyCodegen} disabled={!codegenOutput.trim()}>
                            复制
                        </Button>
                    </div>
                </div>
                <Textarea
                    value={codegenOutput}
                    readOnly
                    className="font-mono text-xs min-h-[180px] resize-none bg-muted/30"
                    placeholder="生成的代码将显示在此"
                />
            </div>

            {/* JSON Editor */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-muted-foreground">API 预览 (JSON)</h3>
                    <Button
                        onClick={onApplyJSON}
                        size="sm"
                        variant="secondary"
                        disabled={!editableJSON.trim() || isImporting}
                        className="h-7 text-xs"
                    >
                        应用修改
                    </Button>
                </div>

                <div className="relative">
                    <Textarea
                        value={editableJSON}
                        onChange={(e) => onEditableJSONChange(e.target.value)}
                        className="font-mono text-xs min-h-[120px] resize-none bg-muted/30"
                        placeholder="JSON output..."
                    />
                    {jsonSyncError && (
                        <p className="absolute bottom-2 left-2 text-xs text-destructive bg-background/80 px-1 rounded">
                            {jsonSyncError}
                        </p>
                    )}
                </div>
            </div>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>清空离线队列</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">未同步的更改将被丢弃，确认继续？</p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                setConfirmOpen(false);
                                onClearPendingOps?.();
                            }}
                        >
                            清空
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
