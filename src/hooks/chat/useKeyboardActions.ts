import { useCallback } from 'react';
import { KeyboardRow, KeyboardButton } from '@/types/telegram';
import { MAX_BUTTONS_PER_ROW, MAX_KEYBOARD_ROWS } from '@/lib/validation';
import { toast } from 'sonner';

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
            pushToHistory(messageContent, newKeyboard);
            return newKeyboard;
        });
    }, [setKeyboard, pushToHistory, messageContent]);

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
            const timestamp = Date.now();
            const lastRow = prev[prev.length - 1];
            const isLastRowFull = lastRow ? lastRow.buttons.length >= MAX_BUTTONS_PER_ROW : false;

            if (isLastRowFull && prev.length >= MAX_KEYBOARD_ROWS) {
                toast.error(`已达到最大行数（${MAX_KEYBOARD_ROWS}行），无法再添加按钮`);
                return prev;
            }

            const newKeyboard = prev.map((row) => ({
                ...row,
                buttons: row.buttons.map((btn) => ({ ...btn })),
            }));

            const clonedLastRow = newKeyboard[newKeyboard.length - 1];
            if (clonedLastRow && clonedLastRow.buttons.length < MAX_BUTTONS_PER_ROW) {
                const updatedRow: KeyboardRow = {
                    ...clonedLastRow,
                    buttons: [
                        ...clonedLastRow.buttons,
                        {
                            id: `btn-${timestamp}`,
                            text: "New Button",
                            callback_data: `btn_${timestamp}`,
                        },
                    ],
                };
                newKeyboard[newKeyboard.length - 1] = updatedRow;
            } else if (newKeyboard.length < MAX_KEYBOARD_ROWS) {
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
            } else {
                toast.error(`已达到最大行数（${MAX_KEYBOARD_ROWS}行），无法再添加按钮`);
                return prev;
            }
            if (lastRow && lastRow.buttons.length >= MAX_BUTTONS_PER_ROW) {
                toast.warning(`每行最多 ${MAX_BUTTONS_PER_ROW} 个按钮，已新建一行。`);
            }
            pushToHistory(messageContent, newKeyboard);
            return newKeyboard;
        });
    }, [setKeyboard, pushToHistory, messageContent]);

    const handleAddRow = useCallback(() => {
        setKeyboard((prev) => {
            const timestamp = Date.now();
            if (prev.length >= MAX_KEYBOARD_ROWS) {
                toast.error(`已达到最大行数（${MAX_KEYBOARD_ROWS}行）`);
                return prev;
            }
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

    const handleReorder = useCallback((rows: KeyboardRow[]) => {
        setKeyboard(rows);
        pushToHistory(messageContent, rows);
    }, [setKeyboard, pushToHistory, messageContent]);

    return {
        handleButtonTextChange,
        handleButtonUpdate,
        handleDeleteButton,
        handleAddButton,
        handleAddRow,
        handleReorder,
    };
};
