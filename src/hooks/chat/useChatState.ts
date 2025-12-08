import { useState, useCallback, useEffect } from 'react';
import { KeyboardRow } from '@/types/telegram';
import { validateKeyboard, validateMessageContent } from '@/lib/validation';
import type { TemplatePayload, ParseMode, MessageType } from "@/types/templates";
export type { TemplatePayload, ParseMode, MessageType } from "@/types/templates";

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

type TelegramExportPayload =
    | {
        text: string;
        parse_mode: ParseMode;
        reply_markup?: { inline_keyboard: TelegramExportButton[][] };
    }
    | {
        photo: string;
        caption?: string;
        parse_mode: ParseMode;
        reply_markup?: { inline_keyboard: TelegramExportButton[][] };
    }
    | {
        video: string;
        caption?: string;
        parse_mode: ParseMode;
        reply_markup?: { inline_keyboard: TelegramExportButton[][] };
    };

type SerializedMessage = {
    type: MessageType;
    text: string;
    mediaUrl?: string;
    parse_mode: ParseMode;
};

type LoadTemplateResult = { ok: true } | { ok: false; error: string };

export const useChatState = () => {
    const [messageContent, setMessageContent] = useState("Welcome to the Telegram UI Builder!\n\nEdit this message directly.\n\nFormatting:\n**bold text** for bold\n`code blocks` for code");
    const [keyboard, setKeyboard] = useState<KeyboardRow[]>(DEFAULT_KEYBOARD_TEMPLATE);
    const [history, setHistory] = useState<{ messageContent: string; keyboard: KeyboardRow[] }[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [editableJSON, setEditableJSON] = useState("");
    const [parseMode, setParseMode] = useState<ParseMode>("HTML");
    const [messageType, setMessageType] = useState<MessageType>("text");
    const [mediaUrl, setMediaUrl] = useState("");

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

    const formatText = useCallback(
        (text: string, mode: ParseMode) => {
            if (mode === "HTML") {
                const escapeHtml = (input: string) =>
                    input
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;");
                return escapeHtml(text)
                    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                    .replace(/`(.*?)`/g, '<code>$1</code>')
                    .replace(/_(.*?)_/g, '<i>$1</i>');
            }

            // MarkdownV2: assume text已包含所需格式，做基础转义（保留常见标记）
            const escapeMd = (input: string) =>
                input.replace(/([[\]()~`>#+\-=|{}.!])/g, "\\$1");
            // 保留粗体/斜体/代码块，先标记再恢复
            const placeholders: string[] = [];
            const replaced = text.replace(/\*\*(.*?)\*\*|`(.*?)`|_(.*?)_/g, (match) => {
                placeholders.push(match);
                return `__MARK_${placeholders.length - 1}__`;
            });
            const escaped = escapeMd(replaced);
            return escaped.replace(/__MARK_(\d+)__/g, (_, idx) => placeholders[Number(idx)]);
        },
        []
    );

    const convertToTelegramFormat = useCallback((): TelegramExportPayload => {
        const formattedText = formatText(messageContent, parseMode);

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

        if (messageType === "photo" && mediaUrl) {
            return {
                photo: mediaUrl,
                caption: formattedText,
                parse_mode: parseMode,
                ...(reply_markup && { reply_markup }),
            };
        }
        if (messageType === "video" && mediaUrl) {
            return {
                video: mediaUrl,
                caption: formattedText,
                parse_mode: parseMode,
                ...(reply_markup && { reply_markup }),
            };
        }
        return {
            text: formattedText,
            parse_mode: parseMode,
            ...(reply_markup && { reply_markup })
        };
    }, [messageContent, keyboard, parseMode, messageType, mediaUrl, formatText]);

    const serializeMessagePayload = useCallback(() => {
        const payload: SerializedMessage = {
            type: messageType,
            text: messageContent,
            mediaUrl: mediaUrl || undefined,
            parse_mode: parseMode,
        };
        if (messageType === "text" && !mediaUrl && parseMode === "HTML") {
            return messageContent;
        }
        return JSON.stringify(payload);
    }, [messageType, messageContent, mediaUrl, parseMode]);

    const loadMessagePayload = useCallback((raw: string) => {
        try {
            const parsed = JSON.parse(raw) as Partial<SerializedMessage>;
            if (parsed && typeof parsed === "object" && parsed.type && parsed.text !== undefined) {
                setMessageContent(parsed.text || "");
                setParseMode((parsed.parse_mode as ParseMode) || "HTML");
                setMessageType((parsed.type as MessageType) || "text");
                setMediaUrl(parsed.mediaUrl || "");
                return;
            }
        } catch {
            // fallback to plain text
        }
        setMessageContent(raw);
        setParseMode("HTML");
        setMessageType("text");
        setMediaUrl("");
    }, []);

    const loadTemplate = useCallback((template: TemplatePayload): LoadTemplateResult => {
        try {
            validateMessageContent(template.message_content);
            validateKeyboard(template.keyboard);
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : "模板格式不合法",
            };
        }

        const requestedType = template.message_type ?? "text";
        const allowedTypes: MessageType[] = ["text", "photo", "video"];
        const nextType: MessageType = allowedTypes.includes(requestedType) ? requestedType : "text";
        const nextParseMode: ParseMode = template.parse_mode === "MarkdownV2" ? "MarkdownV2" : "HTML";
        const safeMedia = template.media_url || "";
        const finalType: MessageType = nextType !== "text" && !safeMedia ? "text" : nextType;
        const safeKeyboard = JSON.parse(JSON.stringify(template.keyboard)) as KeyboardRow[];

        setMessageContent(template.message_content);
        setKeyboard(safeKeyboard);
        setParseMode(nextParseMode);
        setMessageType(finalType);
        setMediaUrl(finalType === "text" ? "" : safeMedia);
        pushToHistory(template.message_content, safeKeyboard);

        return { ok: true };
    }, [pushToHistory]);

    useEffect(() => {
        setEditableJSON(JSON.stringify(convertToTelegramFormat(), null, 2));
    }, [convertToTelegramFormat]);

    return {
        messageContent,
        setMessageContent,
        keyboard,
        setKeyboard,
        parseMode,
        setParseMode,
        messageType,
        setMessageType,
        mediaUrl,
        setMediaUrl,
        pushToHistory,
        undo,
        redo,
        canUndo,
        canRedo,
        editableJSON,
        setEditableJSON,
        convertToTelegramFormat,
        serializeMessagePayload,
        loadMessagePayload,
        loadTemplate,
    };
};
