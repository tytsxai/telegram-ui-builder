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
    share_token?: string;
    is_public?: boolean;
    updated_at?: string; // Optional for local use, present in DB
}
