import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SupabaseDataAccess, SaveScreenInput, UpdateScreenInput } from '@/lib/dataAccess';
import { Screen } from '@/types/telegram';
import { SyncStatus, makeRequestId } from '@/types/sync';
import { publishSyncEvent } from '@/lib/syncTelemetry';
import { toast } from 'sonner';
import { User } from '@supabase/supabase-js';
import type { PendingItem } from '@/lib/pendingQueue';
import { withRetry } from '@/lib/supabaseRetry';
import { hasSupabaseEnv } from '@/lib/runtimeConfig';

export const useSupabaseSync = (user: User | null) => {
    const [screens, setScreens] = useState<Screen[]>([]);
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [shareLoading, setShareLoading] = useState(false);
    const [shareSyncStatus, setShareSyncStatus] = useState<SyncStatus>({ state: "idle" });
    const [layoutSyncStatus, setLayoutSyncStatus] = useState<SyncStatus>({ state: "idle" });
    const [pendingQueueSize, setPendingQueueSize] = useState(0);
    const loadAbortRef = useRef<AbortController | null>(null);
    const updateVersionRef = useRef<Map<string, number>>(new Map());
    type UpdateQueueEntry = { version: number; snapshot: Screen | null; status: "pending" | "failed" };
    const updateQueueRef = useRef<Map<string, UpdateQueueEntry[]>>(new Map());
    const supabaseEnabled = useMemo(() => hasSupabaseEnv(), []);

    useEffect(() => {
        updateVersionRef.current.clear();
        updateQueueRef.current.clear();
    }, [user?.id]);

    const dataAccess = useMemo(() => new SupabaseDataAccess(supabase, { userId: user?.id }), [user]);
    const createRequestId = useCallback(() => makeRequestId(), []);

    const logSyncEvent = useCallback(
        (
            scope: "share" | "layout" | "queue",
            status: SyncStatus & { requestId?: string; message?: string },
            meta?: { action?: string; targetId?: string },
        ) => {
            /* c8 ignore next 12 */
            const shouldConsoleLog = import.meta.env.DEV && import.meta.env.MODE !== "test";
            /* c8 ignore next 3 */
            if (shouldConsoleLog) {
                console.info("[Sync]", {
                    scope,
                    state: status.state,
                    requestId: status.requestId,
                    message: status.message,
                    at: status.at || Date.now(),
                    pendingQueueSize,
                    action: meta?.action,
                    targetId: meta?.targetId,
                    userId: user?.id,
                });
            }
            publishSyncEvent({ scope, status, meta: { ...meta, userId: user?.id } });
        },
        [pendingQueueSize, user?.id],
    );

    const loadScreens = useCallback(async () => {
        if (!user) return;
        if (!supabaseEnabled) {
            setShareSyncStatus({ state: "idle" });
            setIsLoading(false);
            return;
        }
        loadAbortRef.current?.abort();
        const controller = new AbortController();
        loadAbortRef.current = controller;
        setIsLoading(true);
        const requestId = createRequestId();
        try {
            const pendingStatus: SyncStatus = { state: "pending", requestId, message: "加载模版中" };
            setShareSyncStatus(pendingStatus);
            logSyncEvent("share", pendingStatus, { action: "load_screens" });
            const result = await withRetry(async () => {
                const screensQuery = supabase
                    .from('screens')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: true });
                const { data, error } = await (("abortSignal" in screensQuery)
                    ? // @ts-expect-error abortSignal is available in supabase-js v2
                    screensQuery.abortSignal(controller.signal)
                    : screensQuery);
                if (error) throw error;
                const pinsQuery = supabase
                    .from('user_pins')
                    .select('pinned_ids')
                    .eq('user_id', user.id)
                    .single();
                const { data: pinsData, error: pinsError } = await (("abortSignal" in pinsQuery)
                    ? // @ts-expect-error abortSignal is available in supabase-js v2
                    pinsQuery.abortSignal(controller.signal)
                    : pinsQuery);

                if (pinsError && pinsError.code !== 'PGRST116') {
                    // Pins are a non-critical enhancement; log and continue with empty pins.
                    console.error("Error loading pins:", pinsError);
                    return {
                        screens: data as unknown as Screen[],
                        pins: [],
                    };
                }
                return {
                    screens: data as unknown as Screen[],
                    pins: (pinsData?.pinned_ids as string[] | undefined) ?? [],
                };
            }, {
                attempts: 3,
                backoffMs: 350,
                jitterRatio: 0.3,
                requestId,
                onRetry: (evt) => logSyncEvent("share", {
                    state: "pending",
                    requestId,
                    at: Date.now(),
                    message: `load retry ${evt.attempt} (${evt.reason})`,
                }, { action: "load_screens" }),
            });
            if (controller.signal.aborted) return;
            setScreens(result.screens);
            setPinnedIds(result.pins);
            const successStatus: SyncStatus = { state: "success", requestId, at: Date.now(), message: "已加载" };
            setShareSyncStatus(successStatus);
            logSyncEvent("share", successStatus, { action: "load_screens" });

        } catch (error) {
            if (controller.signal.aborted) return;
            console.error('Error loading screens:', error);
            toast.error('Failed to load screens');
            const errorStatus: SyncStatus = {
                state: "error",
                requestId,
                message: error instanceof Error ? error.message : "加载失败",
            };
            setShareSyncStatus(errorStatus);
            logSyncEvent("share", errorStatus, { action: "load_screens" });
        } finally {
            if (!controller.signal.aborted) {
                setIsLoading(false);
            }
        }
    }, [user, createRequestId, logSyncEvent, supabaseEnabled]);

    const saveScreen = useCallback(async (payload: SaveScreenInput) => {
        if (!user) return null;
        if (!supabaseEnabled) {
            const errorStatus: SyncStatus = { state: "error", message: "云端未配置" };
            setShareSyncStatus(errorStatus);
            logSyncEvent("share", errorStatus, { action: "save_screen" });
            toast.error("云端未配置，无法保存");
            return null;
        }
        setShareLoading(true);
        const requestId = createRequestId();
        const pendingStatus: SyncStatus = { state: "pending", requestId, message: "保存中" };
        setShareSyncStatus(pendingStatus);
        logSyncEvent("share", pendingStatus, { action: "save_screen" });
        try {
            const data = await dataAccess.saveScreen(payload);
            setScreens(prev => [...prev, data as unknown as Screen]);
            toast.success("Screen saved");
            const successStatus: SyncStatus = { state: "success", requestId, at: Date.now(), message: "保存成功" };
            setShareSyncStatus(successStatus);
            logSyncEvent("share", successStatus, { action: "save_screen", targetId: (data as { id?: string }).id });
            return data;
        } catch (error) {
            console.error("Error saving screen:", error);
            toast.error("Failed to save screen");
            const errorStatus: SyncStatus = {
                state: "error",
                requestId,
                message: error instanceof Error ? error.message : "保存失败",
            };
            setShareSyncStatus(errorStatus);
            logSyncEvent("share", errorStatus, { action: "save_screen" });
            throw error;
        } finally {
            setShareLoading(false);
        }
    }, [user, dataAccess, createRequestId, logSyncEvent, supabaseEnabled]);

    const updateScreen = useCallback(async (params: UpdateScreenInput) => {
        if (!user) return null;
        if (!supabaseEnabled) {
            const errorStatus: SyncStatus = { state: "error", message: "云端未配置" };
            setShareSyncStatus(errorStatus);
            logSyncEvent("share", errorStatus, { action: "update_screen", targetId: params.screenId });
            toast.error("云端未配置，无法更新");
            return null;
        }
        const requestId = createRequestId();
        const existingVersion = updateVersionRef.current.get(params.screenId) ?? 0;
        const nextVersion = Math.max(Date.now(), existingVersion + 1);
        updateVersionRef.current.set(params.screenId, nextVersion);

        let snapshot: Screen | null = null;
        setScreens((prev) => {
            snapshot = prev.find((screen) => screen.id === params.screenId) ?? null;
            const queue = updateQueueRef.current.get(params.screenId) ?? [];
            queue.push({ version: nextVersion, snapshot, status: "pending" as const });
            updateQueueRef.current.set(params.screenId, queue);
            return prev.map((screen) => {
                if (screen.id !== params.screenId) return screen;
                return {
                    ...screen,
                    ...(params.update as Partial<Screen>),
                    lastUpdateTimestamp: nextVersion,
                };
            });
        });
        try {
            const data = await dataAccess.updateScreen(params);
            const queue = updateQueueRef.current.get(params.screenId);
            if (!queue) {
                return data;
            }
            const index = queue.findIndex((entry) => entry.version === nextVersion);
            /* c8 ignore next 2 */
            if (index === -1) {
                return data;
            }
            const maxVersion = Math.max(...queue.map((entry) => entry.version));
            const remaining = queue.filter((entry) => entry.version !== nextVersion);
            const hasPending = remaining.some((entry) => entry.status === "pending");
            if (nextVersion === maxVersion || !hasPending) {
                updateQueueRef.current.delete(params.screenId);
                setScreens(prev => prev.map(s => s.id === params.screenId
                    ? { ...(data as unknown as Screen), lastUpdateTimestamp: nextVersion }
                    : s));
            } else {
                updateQueueRef.current.set(params.screenId, remaining);
            }
            logSyncEvent("share", { state: "success", requestId, at: Date.now(), message: "更新成功" }, { action: "update_screen", targetId: params.screenId });
            return data;
        } catch (error) {
            console.error("Error updating screen:", error);
            toast.error("Failed to update screen");
            const queue = updateQueueRef.current.get(params.screenId);
            if (queue) {
                const index = queue.findIndex((entry) => entry.version === nextVersion);
                if (index !== -1) {
                    const updatedQueue = queue.map((entry) =>
                        entry.version === nextVersion ? { ...entry, status: "failed" } : entry,
                    );
                    const maxVersion = Math.max(...updatedQueue.map((entry) => entry.version));
                    const hasPending = updatedQueue.some((entry) => entry.status === "pending");
                    if (!hasPending) {
                        const earliest = updatedQueue.reduce(
                            (min, entry) => (entry.version < min.version ? entry : min),
                            updatedQueue[0],
                        );
                        updateQueueRef.current.delete(params.screenId);
                        const previous = earliest?.snapshot ?? snapshot;
                        if (previous) {
                            setScreens((prev) => prev.map((screen) => {
                                if (screen.id !== params.screenId) return screen;
                                return previous;
                            }));
                        }
                    } else {
                        updateQueueRef.current.set(params.screenId, updatedQueue);
                        if (nextVersion === maxVersion) {
                            const previous = updatedQueue[index]?.snapshot ?? snapshot;
                            if (previous) {
                                setScreens((prev) => prev.map((screen) => {
                                    if (screen.id !== params.screenId) return screen;
                                    return previous;
                                }));
                            }
                        }
                    }
                }
            }
            logSyncEvent("share", {
                state: "error",
                requestId,
                message: error instanceof Error ? error.message : "更新失败",
            }, { action: "update_screen", targetId: params.screenId });
            throw error;
        }
    }, [user, dataAccess, createRequestId, logSyncEvent, supabaseEnabled]);

    const deleteScreen = useCallback(async (id: string) => {
        if (!user) return;
        if (!supabaseEnabled) {
            const errorStatus: SyncStatus = { state: "error", message: "云端未配置" };
            setShareSyncStatus(errorStatus);
            logSyncEvent("share", errorStatus, { action: "delete_screen", targetId: id });
            toast.error("云端未配置，无法删除");
            return;
        }
        const requestId = createRequestId();
        try {
            await dataAccess.deleteScreens({ ids: [id] });
            setScreens(prev => prev.filter(s => s.id !== id));
            toast.success("Screen deleted");
            logSyncEvent("share", { state: "success", requestId, at: Date.now(), message: "删除成功" }, { action: "delete_screen", targetId: id });
        } catch (error) {
            console.error("Error deleting screen:", error);
            toast.error("Failed to delete screen");
            logSyncEvent("share", {
                state: "error",
                requestId,
                message: error instanceof Error ? error.message : "删除失败",
            }, { action: "delete_screen", targetId: id });
        }
    }, [user, dataAccess, createRequestId, logSyncEvent, supabaseEnabled]);

    const deleteAllScreens = useCallback(async () => {
        if (!user) return;
        if (!supabaseEnabled) {
            const errorStatus: SyncStatus = { state: "error", message: "云端未配置" };
            setShareSyncStatus(errorStatus);
            logSyncEvent("share", errorStatus, { action: "delete_all_screens" });
            toast.error("云端未配置，无法删除");
            return;
        }
        const requestId = createRequestId();
        try {
            const ids = screens.map(s => s.id);
            if (ids.length > 0) {
                await dataAccess.deleteScreens({ ids });
                // Layout cleanup is optional; older dataAccess mocks may not expose deleteLayouts.
                if (typeof (dataAccess as unknown as { deleteLayouts?: unknown }).deleteLayouts === "function") {
                    await (dataAccess as unknown as { deleteLayouts: (args: { ids: string[] }) => Promise<unknown> }).deleteLayouts({ ids });
                }
            }
            await dataAccess.upsertPins({ user_id: user.id, pinned_ids: [] });
            setScreens([]);
            setPinnedIds([]);
            toast.success("All screens deleted");
            logSyncEvent("share", { state: "success", requestId, at: Date.now(), message: "批量删除成功" }, { action: "delete_all_screens" });
        } catch (error) {
            console.error("Error deleting all screens:", error);
            toast.error("Failed to delete all screens");
            logSyncEvent("share", {
                state: "error",
                requestId,
                message: error instanceof Error ? error.message : "批量删除失败",
            }, { action: "delete_all_screens" });
        }
    }, [user, screens, dataAccess, createRequestId, logSyncEvent, supabaseEnabled]);

    const handleTogglePin = useCallback(async (screenId: string) => {
        if (!user) return;
        if (!supabaseEnabled) {
            toast.error("云端未配置，无法更新置顶");
            return;
        }
        const previous = pinnedIds;
        const nextPinned = pinnedIds.includes(screenId)
            ? pinnedIds.filter(id => id !== screenId)
            : [...pinnedIds, screenId];
        setPinnedIds(nextPinned);

        try {
            await dataAccess.upsertPins({ user_id: user.id, pinned_ids: nextPinned });
        } catch (error) {
            console.error("Error updating pins:", error);
            toast.error("Failed to update pins");
            setPinnedIds(previous);
        }
    }, [dataAccess, pinnedIds, user, supabaseEnabled]);

    const onQueueItemReplay = useCallback(
        (item: PendingItem, error: unknown, meta: { attempt: number; delayMs?: number }) => {
            const recentFailure = item.failures?.[item.failures.length - 1];
            const requestId = recentFailure?.requestId ?? createRequestId();
            const message = recentFailure?.message ?? (error instanceof Error ? error.message : String(error));
            logSyncEvent("queue", {
                state: "error",
                requestId,
                at: item.lastAttemptAt ?? Date.now(),
                message: `${item.kind} ${item.id} replay failed (attempt ${meta.attempt})${meta.delayMs ? `, retrying in ${meta.delayMs}ms` : ""
                    }: ${message}`,
            }, { action: "queue_replay", targetId: item.id });
        },
        [createRequestId, logSyncEvent],
    );

    const onQueueItemSuccess = useCallback(
        (item: PendingItem) => {
            const requestId = item.failures?.[item.failures.length - 1]?.requestId ?? createRequestId();
            logSyncEvent("queue", {
                state: "success",
                requestId,
                at: Date.now(),
                message: `${item.kind} ${item.id} replayed successfully`,
            }, { action: "queue_replay", targetId: item.id });
        },
        [createRequestId, logSyncEvent],
    );

    const queueReplayCallbacks = useMemo(() => ({
        onItemFailure: onQueueItemReplay,
        onSuccess: onQueueItemSuccess,
    }), [onQueueItemReplay, onQueueItemSuccess]);

    useEffect(() => () => {
        loadAbortRef.current?.abort();
    }, []);

    return {
        screens,
        setScreens,
        pinnedIds,
        setPinnedIds,
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
        queueReplayCallbacks,
        logSyncEvent,
        dataAccess
    };
};
