import { useState, useCallback, useEffect } from 'react';
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

interface TelegramExportButton {
    text: string;
    url?: string;
    callback_data?: string;
}

interface TelegramExportPayload {
    text: string;
    parse_mode: "HTML";
    reply_markup?: {
        inline_keyboard: TelegramExportButton[][];
    };
}

export const useChatState = () => {
    const [messageContent, setMessageContent] = useState("Welcome to the Telegram UI Builder!\n\nEdit this message directly.\n\nFormatting:\n**bold text** for bold\n`code blocks` for code");
    const [keyboard, setKeyboard] = useState<KeyboardRow[]>(DEFAULT_KEYBOARD_TEMPLATE);
    const [history, setHistory] = useState<{ messageContent: string; keyboard: KeyboardRow[] }[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [editableJSON, setEditableJSON] = useState("");

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

    const convertToTelegramFormat = useCallback((): TelegramExportPayload => {
        const escapeHtml = (input: string) =>
            input
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

        const text = escapeHtml(messageContent)
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')  // Bold
            .replace(/`(.*?)`/g, '<code>$1</code>')  // Code
            .replace(/_(.*?)_/g, '<i>$1</i>');       // Italic

        const reply_markup = keyboard.length > 0 ? {
            inline_keyboard: keyboard.map(row =>
                row.buttons.map(btn => {
                    const btnData: TelegramExportButton = { text: btn.text };
                    if (btn.url) {
                        btnData.url = btn.url;
                    } else if (btn.linked_screen_id) {
                        btnData.callback_data = `goto_screen_${btn.linked_screen_id}`;
                    } else {
                        btnData.callback_data = btn.callback_data || btn.text.toLowerCase().replace(/\s+/g, '_');
                    }
                    return btnData;
                })
            )
        } : undefined;

        return {
            text,
            parse_mode: "HTML",
            ...(reply_markup && { reply_markup })
        };
    }, [messageContent, keyboard]);

    useEffect(() => {
        setEditableJSON(JSON.stringify(convertToTelegramFormat(), null, 2));
    }, [convertToTelegramFormat]);

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
        editableJSON,
        setEditableJSON,
        convertToTelegramFormat
    };
};
