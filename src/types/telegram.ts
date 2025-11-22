export interface KeyboardButton {
    id: string;
    text: string;
    url?: string;
    callback_data?: string;
    linked_screen_id?: string;
}

export interface KeyboardRow {
    id: string;
    buttons: KeyboardButton[];
}

export interface Screen {
    id: string;
    name: string;
    message_content: string;
    keyboard: KeyboardRow[];
    parse_mode?: "HTML" | "MarkdownV2";
    message_type?: "text" | "photo" | "video";
    media_url?: string | null;
    share_token?: string | null;
    is_public?: boolean | null;
    created_at?: string | null;
    updated_at?: string | null;
    user_id?: string | null;
}
