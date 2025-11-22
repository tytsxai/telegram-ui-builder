import React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

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
    retryingQueue,
    isOffline,
    codegenFramework,
    onCodegenFrameworkChange,
    codegenOutput,
    onCopyCodegen,
}) => {
    return (
        <div className="p-4 space-y-4">
            {/* Logs Section */}
            <div className="space-y-2">
                {pendingOpsNotice && (
                    <Alert className="border-amber-500/50 bg-amber-500/10 py-2">
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                        <AlertDescription className="text-xs text-foreground">
                            有未同步的保存请求（{pendingQueueSize ?? "?"}），请联网后重试。
                            <div className="mt-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={retryingQueue || isOffline}
                                    onClick={onRetryPendingOps}
                                >
                                    {retryingQueue ? "重试中..." : isOffline ? "离线中" : "立即重试同步"}
                                </Button>
                            </div>
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
                            onChange={(e) => onCodegenFrameworkChange(e.target.value as any)}
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
        </div>
    );
};
