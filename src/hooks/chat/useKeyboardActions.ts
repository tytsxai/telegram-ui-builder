import { useCallback } from 'react';
import { KeyboardRow, KeyboardButton } from '@/types/telegram';

export const useKeyboardActions = (
    setKeyboard: (value: KeyboardRow[] | ((prev: KeyboardRow[]) => KeyboardRow[])) => void,
    pushToHistory: (content: string, kbd: KeyboardRow[]) => void,
    messageContent: string,
    keyboard: KeyboardRow[]
) => {
    const handleButtonTextChange = useCallback((rowId: string, buttonId: string, newText: string) => {
        setKeyboard((prev) => {
            const newKeyboard = prev.map((row) => {
                if (row.id === rowId) {
                    return {
                        ...row,
                        buttons: row.buttons.map((btn) =>
                            btn.id === buttonId ? { ...btn, text: newText } : btn
                        ),
                    };
                }
                return row;
            });
            return newKeyboard;
        });
    }, [setKeyboard]);

    const handleButtonUpdate = useCallback((rowId: string, buttonId: string, updatedButton: KeyboardButton) => {
        setKeyboard((prev) => {
            const newKeyboard = prev.map((row) => {
                if (row.id === rowId) {
                    return {
                        ...row,
                        buttons: row.buttons.map((btn) =>
                            btn.id === buttonId ? updatedButton : btn
                        ),
                    };
                }
                return row;
            });
            pushToHistory(messageContent, newKeyboard);
            return newKeyboard;
        });
    }, [setKeyboard, pushToHistory, messageContent]);

    const handleDeleteButton = useCallback((rowId: string, buttonId: string) => {
        setKeyboard((prev) => {
            const newKeyboard = prev.map((row) => {
                if (row.id === rowId) {
                    return {
                        ...row,
                        buttons: row.buttons.filter((btn) => btn.id !== buttonId),
                    };
                }
                return row;
            }).filter((row) => row.buttons.length > 0);
            pushToHistory(messageContent, newKeyboard);
            return newKeyboard;
        });
    }, [setKeyboard, pushToHistory, messageContent]);

    const handleAddButton = useCallback(() => {
        setKeyboard((prev) => {
            const newKeyboard = [...prev];
            const lastRow = newKeyboard[newKeyboard.length - 1];
            const timestamp = Date.now();

            if (lastRow && lastRow.buttons.length < 3) {
                lastRow.buttons.push({
                    id: `btn-${timestamp}`,
                    text: "New Button",
                    callback_data: `btn_${timestamp}`,
                });
            } else {
                newKeyboard.push({
                    id: `row-${timestamp}`,
                    buttons: [
                        {
                            id: `btn-${timestamp}`,
                            text: "New Button",
                            callback_data: `btn_${timestamp}`,
                        },
                    ],
                });
            }
            pushToHistory(messageContent, newKeyboard);
            return newKeyboard;
        });
    }, [setKeyboard, pushToHistory, messageContent]);

    const handleAddRow = useCallback(() => {
        setKeyboard((prev) => {
            const timestamp = Date.now();
            const newKeyboard = [
                ...prev,
                {
                    id: `row-${timestamp}`,
                    buttons: [
                        {
                            id: `btn-${timestamp}`,
                            text: "New Button",
                            callback_data: `btn_${timestamp}`,
                        },
                    ],
                },
            ];
            pushToHistory(messageContent, newKeyboard);
            return newKeyboard;
        });
    }, [setKeyboard, pushToHistory, messageContent]);

    return {
        handleButtonTextChange,
        handleButtonUpdate,
        handleDeleteButton,
        handleAddButton,
        handleAddRow,
    };
};
