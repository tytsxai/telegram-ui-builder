import { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SupabaseDataAccess, SaveScreenInput, UpdateScreenInput } from '@/lib/dataAccess';
import { Screen } from '@/types/telegram';
import { SyncStatus } from '@/types/sync';
import { publishSyncEvent } from '@/lib/syncTelemetry';
import { toast } from 'sonner';
import { User } from '@supabase/supabase-js';

export const useSupabaseSync = (user: User | null) => {
    const [screens, setScreens] = useState<Screen[]>([]);
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [shareLoading, setShareLoading] = useState(false);
    const [shareSyncStatus, setShareSyncStatus] = useState<SyncStatus>({ state: "idle" });
    const [layoutSyncStatus, setLayoutSyncStatus] = useState<SyncStatus>({ state: "idle" });
    const [pendingQueueSize, setPendingQueueSize] = useState(0);

    const dataAccess = useMemo(() => new SupabaseDataAccess(supabase, { userId: user?.id }), [user]);

    const logSyncEvent = useCallback(
        (scope: "share" | "layout" | "queue", status: SyncStatus & { requestId?: string; message?: string }) => {
            if (import.meta.env.DEV) {
                console.info("[Sync]", {
                    scope,
                    state: status.state,
                    requestId: status.requestId,
                    message: status.message,
                    at: status.at || Date.now(),
                    pendingQueueSize,
                });
            }
            publishSyncEvent({ scope, status });
        },
        [pendingQueueSize],
    );

    const loadScreens = useCallback(async () => {
        if (!user) return;
        setIsLoading(true);
        try {
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
                .select('pinned_screen_ids')
                .eq('user_id', user.id)
                .single();

            if (pinsError && pinsError.code !== 'PGRST116') { // Ignore not found
                console.error('Error loading pins:', pinsError);
            }
            if (pinsData) {
                setPinnedIds(pinsData.pinned_screen_ids || []);
            }

        } catch (error) {
            console.error('Error loading screens:', error);
            toast.error('Failed to load screens');
        } finally {
            setIsLoading(false);
        }
    }, [user]);

    const saveScreen = useCallback(async (payload: SaveScreenInput) => {
        if (!user) return null;
        setShareLoading(true);
        try {
            const data = await dataAccess.saveScreen(payload);
            setScreens(prev => [...prev, data as unknown as Screen]);
            toast.success("Screen saved");
            return data;
        } catch (error) {
            console.error("Error saving screen:", error);
            toast.error("Failed to save screen");
            throw error;
        } finally {
            setShareLoading(false);
        }
    }, [user, dataAccess]);

    const updateScreen = useCallback(async (params: UpdateScreenInput) => {
        if (!user) return null;
        try {
            const data = await dataAccess.updateScreen(params);
            setScreens(prev => prev.map(s => s.id === params.screenId ? (data as unknown as Screen) : s));
            return data;
        } catch (error) {
            console.error("Error updating screen:", error);
            toast.error("Failed to update screen");
            throw error;
        }
    }, [user, dataAccess]);

    const deleteScreen = useCallback(async (id: string) => {
        if (!user) return;
        try {
            await dataAccess.deleteScreens({ ids: [id], userId: user.id });
            setScreens(prev => prev.filter(s => s.id !== id));
            toast.success("Screen deleted");
        } catch (error) {
            console.error("Error deleting screen:", error);
            toast.error("Failed to delete screen");
        }
    }, [user, dataAccess]);

    const deleteAllScreens = useCallback(async () => {
        if (!user) return;
        try {
            const ids = screens.map(s => s.id);
            await dataAccess.deleteScreens({ ids, userId: user.id });
            setScreens([]);
            toast.success("All screens deleted");
        } catch (error) {
            console.error("Error deleting all screens:", error);
            toast.error("Failed to delete all screens");
        }
    }, [user, screens, dataAccess]);

    const handleTogglePin = useCallback(async (screenId: string) => {
        if (!user) return;
        let previous: string[] = [];
        const nextPinned = (() => {
            let computed: string[] = [];
            setPinnedIds((prev) => {
                previous = prev;
                if (prev.includes(screenId)) {
                    computed = prev.filter(id => id !== screenId);
                } else {
                    computed = [...prev, screenId];
                }
                return computed;
            });
            return computed;
        })();

        try {
            await dataAccess.upsertPins({ user_id: user.id, pinned_screen_ids: nextPinned });
        } catch (error) {
            console.error("Error updating pins:", error);
            toast.error("Failed to update pins");
            setPinnedIds(previous);
        }
    }, [user, dataAccess]);

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
        logSyncEvent,
        dataAccess
    };
};
