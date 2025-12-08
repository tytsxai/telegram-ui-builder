import { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SupabaseDataAccess, SaveScreenInput, UpdateScreenInput } from '@/lib/dataAccess';
import { Screen } from '@/types/telegram';
import { SyncStatus, makeRequestId } from '@/types/sync';
import { publishSyncEvent } from '@/lib/syncTelemetry';
import { toast } from 'sonner';
import { User } from '@supabase/supabase-js';
import type { PendingItem } from '@/lib/pendingQueue';

export const useSupabaseSync = (user: User | null) => {
    const [screens, setScreens] = useState<Screen[]>([]);
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [shareLoading, setShareLoading] = useState(false);
    const [shareSyncStatus, setShareSyncStatus] = useState<SyncStatus>({ state: "idle" });
    const [layoutSyncStatus, setLayoutSyncStatus] = useState<SyncStatus>({ state: "idle" });
    const [pendingQueueSize, setPendingQueueSize] = useState(0);

    const dataAccess = useMemo(() => new SupabaseDataAccess(supabase, { userId: user?.id }), [user]);
    const createRequestId = useCallback(() => makeRequestId(), []);

    const logSyncEvent = useCallback(
        (
            scope: "share" | "layout" | "queue",
            status: SyncStatus & { requestId?: string; message?: string },
            meta?: { action?: string; targetId?: string },
        ) => {
            /* c8 ignore next 9 */
            if (import.meta.env.DEV) {
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
        setIsLoading(true);
        const requestId = createRequestId();
        try {
            const pendingStatus = { state: "pending", requestId, message: "加载模版中" };
            setShareSyncStatus(pendingStatus);
            logSyncEvent("share", pendingStatus, { action: "load_screens" });
            const { data, error } = await supabase
                .from('screens')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setScreens(data as unknown as Screen[]);

            // Load pins
            const { data: pinsData, error: pinsError } = await supabase
                .from('user_pins')
                .select('pinned_ids')
                .eq('user_id', user.id)
                .single();

            if (pinsError && pinsError.code !== 'PGRST116') { // Ignore not found
                console.error('Error loading pins:', pinsError);
            }
            if (pinsData) {
                setPinnedIds(pinsData.pinned_ids || []);
            }
            const successStatus = { state: "success", requestId, at: Date.now(), message: "已加载" };
            setShareSyncStatus(successStatus);
            logSyncEvent("share", successStatus, { action: "load_screens" });

        } catch (error) {
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
            setIsLoading(false);
        }
    }, [user, createRequestId, logSyncEvent]);

    const saveScreen = useCallback(async (payload: SaveScreenInput) => {
        if (!user) return null;
        setShareLoading(true);
        const requestId = createRequestId();
        const pendingStatus = { state: "pending", requestId, message: "保存中" };
        setShareSyncStatus(pendingStatus);
        logSyncEvent("share", pendingStatus, { action: "save_screen" });
        try {
            const data = await dataAccess.saveScreen(payload);
            setScreens(prev => [...prev, data as unknown as Screen]);
            toast.success("Screen saved");
            const successStatus = { state: "success", requestId, at: Date.now(), message: "保存成功" };
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
    }, [user, dataAccess, createRequestId, logSyncEvent]);

    const updateScreen = useCallback(async (params: UpdateScreenInput) => {
        if (!user) return null;
        const requestId = createRequestId();
        try {
            const data = await dataAccess.updateScreen(params);
            setScreens(prev => prev.map(s => s.id === params.screenId ? (data as unknown as Screen) : s));
            logSyncEvent("share", { state: "success", requestId, at: Date.now(), message: "更新成功" }, { action: "update_screen", targetId: params.screenId });
            return data;
        } catch (error) {
            console.error("Error updating screen:", error);
            toast.error("Failed to update screen");
            logSyncEvent("share", {
                state: "error",
                requestId,
                message: error instanceof Error ? error.message : "更新失败",
            }, { action: "update_screen", targetId: params.screenId });
            throw error;
        }
    }, [user, dataAccess, createRequestId, logSyncEvent]);

    const deleteScreen = useCallback(async (id: string) => {
        if (!user) return;
        const requestId = createRequestId();
        try {
            await dataAccess.deleteScreens({ ids: [id], userId: user.id });
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
    }, [user, dataAccess, createRequestId, logSyncEvent]);

    const deleteAllScreens = useCallback(async () => {
        if (!user) return;
        const requestId = createRequestId();
        try {
            const ids = screens.map(s => s.id);
            await dataAccess.deleteScreens({ ids, userId: user.id });
            setScreens([]);
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
    }, [user, screens, dataAccess, createRequestId, logSyncEvent]);

    const handleTogglePin = useCallback(async (screenId: string) => {
        if (!user) return;
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
    }, [dataAccess, pinnedIds, user]);

    const onQueueItemReplay = useCallback(
        (item: PendingItem, error: unknown, meta: { attempt: number; delayMs?: number }) => {
            const recentFailure = item.failures?.[item.failures.length - 1];
            const requestId = recentFailure?.requestId ?? createRequestId();
            const message = recentFailure?.message ?? (error instanceof Error ? error.message : String(error));
            logSyncEvent("queue", {
                state: "error",
                requestId,
                at: item.lastAttemptAt ?? Date.now(),
                message: `${item.kind} ${item.id} replay failed (attempt ${meta.attempt})${
                    meta.delayMs ? `, retrying in ${meta.delayMs}ms` : ""
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
        queueReplayCallbacks: {
            onItemFailure: onQueueItemReplay,
            onSuccess: onQueueItemSuccess,
        },
        logSyncEvent,
        dataAccess
    };
};
