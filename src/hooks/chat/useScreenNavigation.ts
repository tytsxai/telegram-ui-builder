import { useState, useCallback, useEffect } from 'react';
import { Screen } from '@/types/telegram';

const ENTRY_KEY = "telegram_ui_entry_screen";

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
    useEffect(() => {
        setEntryScreenId((prev) => {
            if (screens.length === 0) {
                return null;
            }
            if (prev && screens.some((s) => s.id === prev)) {
                return prev;
            }
            if (!prev && screens.length === 1) {
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
        setNavigationHistory((prev) => [...prev, screenId]);
    }, []);

    const handleSetEntry = useCallback((screenId: string | null) => {
        setEntryScreenId(screenId);
    }, []);

    const handleJumpToEntry = useCallback(() => {
        if (entryScreenId && screens.some(s => s.id === entryScreenId)) {
            handleNavigateToScreen(entryScreenId);
        }
    }, [entryScreenId, screens, handleNavigateToScreen]);

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
