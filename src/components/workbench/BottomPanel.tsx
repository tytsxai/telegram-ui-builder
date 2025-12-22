import React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollBar } from "@/components/ui/scroll-area";
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

type PendingItem = NonNullable<BottomPanelProps["pendingItems"]>[number];

const VIRTUALIZE_THRESHOLD = 40;
const ESTIMATED_ROW_HEIGHT = 88;
const OVERSCAN_COUNT = 3;
const ROW_GAP_PX = 8;

const getPendingItemKey = (item: PendingItem) => `${item.kind}-${item.id}`;

const PendingItemRow = React.memo(
    ({ item, formatTimestamp }: { item: PendingItem; formatTimestamp: (value?: number) => string }) => {
        const lastFailure = item.failures?.[item.failures.length - 1];
        const lastMessage = lastFailure?.message ?? item.lastError ?? "待重试";
        const attempts = item.attempts ?? 0;
        return (
            <div
                className="rounded-md border border-amber-100 bg-amber-50/60 p-2 space-y-1"
                data-testid={`pending-item-${item.id}`}
            >
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
                        {item.failures.slice(-3).map((failure) => (
                            <Badge
                                key={`${item.id}-${failure.at}-${failure.message}`}
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
    },
);
PendingItemRow.displayName = "PendingItemRow";

const MeasuredPendingRow = ({
    item,
    formatTimestamp,
    onHeightChange,
    isLast,
}: {
    item: PendingItem;
    formatTimestamp: (value?: number) => string;
    onHeightChange: (key: string, height: number) => void;
    isLast: boolean;
}) => {
    const rowRef = React.useRef<HTMLDivElement | null>(null);
    const key = getPendingItemKey(item);

    React.useLayoutEffect(() => {
        const node = rowRef.current;
        if (!node) return;
        const measure = () => {
            onHeightChange(key, node.offsetHeight);
        };
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [isLast, item, key, onHeightChange]);

    return (
        <div ref={rowRef} className={isLast ? "" : "pb-2"}>
            <PendingItemRow item={item} formatTimestamp={formatTimestamp} />
        </div>
    );
};

const PendingItemsList = React.memo(({
    items,
    formatTimestamp,
}: {
    items: PendingItem[];
    formatTimestamp: (value?: number) => string;
}) => {
    const useVirtualization = items.length >= VIRTUALIZE_THRESHOLD;
    const viewportRef = React.useRef<HTMLDivElement | null>(null);
    const [scrollTop, setScrollTop] = React.useState(0);
    const [viewportHeight, setViewportHeight] = React.useState(128);
    const scrollTopRef = React.useRef(0);
    const rafRef = React.useRef<number | null>(null);
    const measuredHeightsRef = React.useRef(new Map<string, number>());
    const [measureVersion, setMeasureVersion] = React.useState(0);

    const handleHeightChange = React.useCallback((key: string, height: number) => {
        const rounded = Math.max(1, Math.ceil(height));
        const existing = measuredHeightsRef.current.get(key);
        if (existing === rounded) return;
        measuredHeightsRef.current.set(key, rounded);
        setMeasureVersion((prev) => prev + 1);
    }, []);

    React.useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const updateHeight = () => {
            setViewportHeight(viewport.clientHeight || 128);
        };
        updateHeight();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(updateHeight);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);

    React.useEffect(() => () => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
        }
    }, []);

    const onScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const nextScrollTop = event.currentTarget.scrollTop;
        if (scrollTopRef.current === nextScrollTop) return;
        scrollTopRef.current = nextScrollTop;
        if (rafRef.current !== null) return;
        setScrollTop(nextScrollTop);
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            if (scrollTopRef.current !== nextScrollTop) {
                setScrollTop(scrollTopRef.current);
            }
        });
    }, []);

    const { slice, paddingTop, paddingBottom } = React.useMemo(() => {
        const measurements = items.map((item) => {
            const key = getPendingItemKey(item);
            const measured = measuredHeightsRef.current.get(key);
            const height = measured ?? ESTIMATED_ROW_HEIGHT + ROW_GAP_PX;
            return { item, key, height };
        });
        let offset = 0;
        const offsets = measurements.map((entry) => {
            const start = offset;
            offset += entry.height;
            return { ...entry, start };
        });
        const totalHeight = offsets.length ? offsets[offsets.length - 1].start + offsets[offsets.length - 1].height : 0;

        const findIndex = (targetOffset: number) => {
            if (!offsets.length) return 0;
            let low = 0;
            let high = offsets.length - 1;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const { start, height } = offsets[mid];
                if (targetOffset < start) {
                    high = mid - 1;
                } else if (targetOffset >= start + height) {
                    low = mid + 1;
                } else {
                    return mid;
                }
            }
            return Math.min(low, offsets.length - 1);
        };

        if (!useVirtualization) {
            return { slice: offsets, paddingTop: 0, paddingBottom: 0 };
        }

        const rawStart = Math.max(0, findIndex(scrollTop) - OVERSCAN_COUNT);
        const rawEnd = Math.min(items.length, findIndex(scrollTop + viewportHeight) + OVERSCAN_COUNT + 1);
        const slice = offsets.slice(rawStart, rawEnd);
        const paddingTop = offsets[rawStart]?.start ?? 0;
        const last = offsets[rawEnd - 1];
        const paddingBottom = last ? Math.max(0, totalHeight - (last.start + last.height)) : 0;

        return {
            slice,
            paddingTop,
            paddingBottom,
        };
    }, [items, measureVersion, scrollTop, useVirtualization, viewportHeight]);

    const lastItemKey = items.length ? getPendingItemKey(items[items.length - 1]) : null;

    return (
        <ScrollAreaPrimitive.Root className="h-32 mt-2 rounded border border-amber-200/60">
            <ScrollAreaPrimitive.Viewport
                ref={viewportRef}
                className="h-full w-full rounded-[inherit]"
                onScroll={onScroll}
                data-testid="pending-items-viewport"
            >
                <div className="p-2 text-xs text-muted-foreground">
                    <div style={{ paddingTop, paddingBottom }}>
                        {slice.map((entry) => (
                            <MeasuredPendingRow
                                key={entry.key}
                                item={entry.item}
                                formatTimestamp={formatTimestamp}
                                onHeightChange={handleHeightChange}
                                isLast={lastItemKey === entry.key}
                            />
                        ))}
                    </div>
                </div>
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    );
});
PendingItemsList.displayName = "PendingItemsList";

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
    const formatTimestamp = React.useCallback((value?: number) => {
        if (!value) return "未记录";
        try {
            return new Date(value).toLocaleTimeString();
        } catch {
            return "未记录";
        }
    }, []);

    return (
        <div className="p-4 space-y-4">
            {/* Logs Section */}
            <div className="space-y-2">
                {pendingOpsNotice && (
                    <Alert className="border-amber-500/50 bg-amber-500/10 py-2" role="status" aria-live="polite" aria-atomic="true">
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
                                <PendingItemsList items={pendingItems} formatTimestamp={formatTimestamp} />
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
                    <Alert className={`py-2 ${allowCircular ? 'border-amber-500/50 bg-amber-500/10' : 'border-destructive/50 bg-destructive/10'}`} role="status" aria-live="polite" aria-atomic="true">
                        <AlertCircle className={`h-4 w-4 ${allowCircular ? 'text-amber-600' : 'text-destructive'}`} />
                        <AlertDescription className="text-xs text-foreground">
                            <strong>
                                {allowCircular
                                    ? `⚠️ 检测到 ${circularReferences.length} 个循环引用（已允许）`
                                    : `⚠️ 检测到 ${circularReferences.length} 个循环引用（已禁止）`}
                            </strong>
                            <div className="mt-1 max-h-20 overflow-y-auto">
                                {circularReferences.map((circle, idx) => (
                                    <div key={`${circle.path.join(".")}::${circle.screenNames.join("|")}`} className="text-muted-foreground">
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
