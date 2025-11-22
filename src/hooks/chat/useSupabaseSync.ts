import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SupabaseDataAccess } from '@/lib/dataAccess';
import { Screen } from '@/types/telegram';
import { SyncStatus, makeRequestId } from '@/types/sync';
import { publishSyncEvent } from '@/lib/syncTelemetry';
import { toast } from 'sonner';
import { User } from '@supabase/supabase-js';

export const useSupabaseSync = (user: User | null) => {
    const [screens, setScreens] = useState<Screen[]>([]);
    const [shareLoading, setShareLoading] = useState(false);
    const [shareSyncStatus, setShareSyncStatus] = useState<SyncStatus>({ state: "idle" });
    const [layoutSyncStatus, setLayoutSyncStatus] = useState<SyncStatus>({ state: "idle" });
    const [pendingQueueSize, setPendingQueueSize] = useState(0);

    const dataAccess = new SupabaseDataAccess(supabase, { userId: user?.id });

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
        try {
            const { data, error } = await supabase
                .from('screens')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: true });

            if (error) throw error;

            // Transform data to match Screen type if necessary
            // Assuming data matches Screen type for now, or add mapper
            setScreens(data as unknown as Screen[]);
        } catch (error) {
            console.error('Error loading screens:', error);
            toast.error('Failed to load screens');
        }
    }, [user]);

    // Add other sync methods (saveScreen, updateScreen, etc.) here as needed
    // For now, focusing on the structure.

    return {
        screens,
        setScreens,
        loadScreens,
        shareLoading,
        shareSyncStatus,
        layoutSyncStatus,
        pendingQueueSize,
        logSyncEvent,
        dataAccess
    };
};
