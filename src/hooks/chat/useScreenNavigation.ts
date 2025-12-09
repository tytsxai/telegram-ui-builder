import { useState, useCallback, useEffect, useRef } from 'react';
import { Screen } from '@/types/telegram';

const ENTRY_KEY = "telegram_ui_entry_screen";
const MAX_HISTORY = 100;

export const isEntrySet = (entryId: string | null, screens: Screen[]) =>
    !!entryId && screens.some((s) => s.id === entryId);

export const useScreenNavigation = (
    screens: Screen[],
    setScreens: (screens: Screen[]) => void,
    loadScreens: () => Promise<void>
) => {
    const [currentScreenId, setCurrentScreenId] = useState<string | undefined>(undefined);
    const [navigationHistory, setNavigationHistory] = useState<string[]>([]);
    const [entryScreenId, setEntryScreenId] = useState<string | null>(null);

    // Load entry screen from local storage
    useEffect(() => {
        const savedEntry = localStorage.getItem(ENTRY_KEY);
        if (savedEntry) {
            setEntryScreenId(savedEntry);
        }
    }, []);

    // Persist entry screen
    useEffect(() => {
        if (entryScreenId) {
            localStorage.setItem(ENTRY_KEY, entryScreenId);
        } else {
            localStorage.removeItem(ENTRY_KEY);
        }
    }, [entryScreenId]);

    // Keep entry consistent with available screens
    const hasSeenScreens = useRef(false);
    useEffect(() => {
        if (screens.length === 0) {
            // 避免在首次加载前清空入口；只有在曾经加载过列表后才清空
            if (hasSeenScreens.current) {
                setEntryScreenId(null);
            }
            return;
        }
        hasSeenScreens.current = true;
        setEntryScreenId((prev) => {
            if (prev) {
                return screens.some((s) => s.id === prev) ? prev : null;
            }
            if (screens.length === 1) {
                return screens[0].id;
            }
            return null;
        });
    }, [screens]);

    const handleNavigateBack = useCallback(() => {
        setNavigationHistory((prev) => {
            const newHistory = [...prev];
            newHistory.pop(); // Remove current screen
            const previousScreenId = newHistory[newHistory.length - 1];
            setCurrentScreenId(previousScreenId);
            return newHistory;
        });
    }, []);

    const handleNavigateToScreen = useCallback((screenId: string) => {
        setCurrentScreenId(screenId);
        setNavigationHistory((prev) => {
            const next = [...prev, screenId];
            return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
        });
    }, []);

    const handleSetEntry = useCallback((screenId: string | null) => {
        setEntryScreenId(screenId);
    }, []);

    const handleJumpToEntry = useCallback(() => {
        if (entryScreenId && screens.some(s => s.id === entryScreenId)) {
            handleNavigateToScreen(entryScreenId);
        }
    }, [entryScreenId, screens, handleNavigateToScreen]);

    // Cleanup navigation history and current screen when screens list changes
    useEffect(() => {
        const ids = new Set(screens.map((s) => s.id));
        setNavigationHistory((prev) => {
            const filtered = prev.filter((id) => ids.has(id));
            const clipped = filtered.length > MAX_HISTORY ? filtered.slice(-MAX_HISTORY) : filtered;
            const unchanged = clipped.length === prev.length && clipped.every((id, idx) => id === prev[idx]);
            return unchanged ? prev : clipped;
        });
        setCurrentScreenId((prev) => {
            if (prev && ids.has(prev)) return prev;
            return undefined;
        });
    }, [screens, navigationHistory]);

    return {
        currentScreenId,
        setCurrentScreenId,
        navigationHistory,
        entryScreenId,
        handleNavigateBack,
        handleNavigateToScreen,
        handleSetEntry,
        handleJumpToEntry
    };
};
