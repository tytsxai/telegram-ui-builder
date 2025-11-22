import { useState, useCallback } from 'react';
import { KeyboardRow, KeyboardButton } from '@/types/telegram';

const DEFAULT_KEYBOARD_TEMPLATE: KeyboardRow[] = [
    {
        id: "row-1",
        buttons: [
            { id: "btn-1", text: "Button 1", callback_data: "btn_1_action" },
            { id: "btn-2", text: "Button 2", callback_data: "btn_2_action" },
        ],
    },
];

export const useChatState = () => {
    const [messageContent, setMessageContent] = useState("Welcome to the Telegram UI Builder!\n\nEdit this message directly.\n\nFormatting:\n<b>bold text</b> for bold\n<code>code blocks</code> for code");
    const [keyboard, setKeyboard] = useState<KeyboardRow[]>(DEFAULT_KEYBOARD_TEMPLATE);
    const [history, setHistory] = useState<{ messageContent: string; keyboard: KeyboardRow[] }[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const pushToHistory = useCallback((content: string, kbd: KeyboardRow[]) => {
        setHistory((prev) => {
            const newHistory = prev.slice(0, historyIndex + 1);
            newHistory.push({ messageContent: content, keyboard: JSON.parse(JSON.stringify(kbd)) });
            if (newHistory.length > 50) newHistory.shift();
            return newHistory;
        });
        setHistoryIndex((prev) => Math.min(prev + 1, 49));
    }, [historyIndex]);

    const undo = useCallback(() => {
        if (historyIndex > 0) {
            const prevState = history[historyIndex - 1];
            setMessageContent(prevState.messageContent);
            setKeyboard(JSON.parse(JSON.stringify(prevState.keyboard)));
            setHistoryIndex(historyIndex - 1);
        }
    }, [history, historyIndex]);

    const redo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            const nextState = history[historyIndex + 1];
            setMessageContent(nextState.messageContent);
            setKeyboard(JSON.parse(JSON.stringify(nextState.keyboard)));
            setHistoryIndex(historyIndex + 1);
        }
    }, [history, historyIndex]);

    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    return {
        messageContent,
        setMessageContent,
        keyboard,
        setKeyboard,
        pushToHistory,
        undo,
        redo,
        canUndo,
        canRedo,
    };
};
