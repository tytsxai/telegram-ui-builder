import { useState, useCallback } from 'react';
import { Screen } from '@/types/telegram';

export const useScreenNavigation = (
    screens: Screen[],
    setScreens: (screens: Screen[]) => void,
    loadScreens: () => Promise<void>
) => {
    const [currentScreenId, setCurrentScreenId] = useState<string | undefined>(undefined);
    const [navigationHistory, setNavigationHistory] = useState<string[]>([]);

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

    return {
        currentScreenId,
        setCurrentScreenId,
        navigationHistory,
        handleNavigateBack,
        handleNavigateToScreen,
    };
};
