import type { KeyboardRow } from "./telegram";

export type ParseMode = "HTML" | "MarkdownV2";
export type MessageType = "text" | "photo" | "video";

export interface TemplatePayload {
  message_content: string;
  keyboard: KeyboardRow[];
  parse_mode?: ParseMode;
  message_type?: MessageType;
  media_url?: string;
}

export type TemplateMeta = {
  id: string;
  name: string;
  summary?: string;
  file: string;
  accent?: string;
  estimated_time?: string;
  tags?: string[];
  preview?: string;
  category?: string;
};

export type TemplateDefinition = TemplateMeta & TemplatePayload;
