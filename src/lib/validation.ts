import { z } from 'zod';
import type { KeyboardRow } from '@/types/telegram';

export const BUTTON_TEXT_MAX = 30;
export const CALLBACK_DATA_MAX_BYTES = 64;
export const MAX_BUTTONS_PER_ROW = 8;
export const MAX_KEYBOARD_ROWS = 100;
export const CALLBACK_DATA_ERROR_MESSAGE = `callback_data 最多 ${CALLBACK_DATA_MAX_BYTES} 字节`;

/**
 * Byte length for Telegram constraints.
 * Telegram's `callback_data` limit is specified in bytes, not characters; use UTF-8.
 */
export const getByteLength = (value: string) => new TextEncoder().encode(value).length;

const formatKeyboardIssue = (issue: z.ZodIssue) => {
  const [rowIdx, maybeButtons, btnIdx, field] = issue.path;
  if (typeof rowIdx === "number") {
    const rowLabel = `第${rowIdx + 1}行`;
    if (maybeButtons === "buttons") {
      if (typeof btnIdx === "number") {
        const btnLabel = `${rowLabel}第${btnIdx + 1}个按钮`;
        if (typeof field === "string") {
          return `${btnLabel} ${issue.message}`;
        }
        return `${btnLabel}: ${issue.message}`;
      }
      return `${rowLabel} ${issue.message}`;
    }
    return `${rowLabel} ${issue.message}`;
  }
  return issue.message;
};

/**
 * 按钮数据验证 Schema
 */
export const ButtonSchema = z.object({
  id: z.string(),
  text: z.string().min(1, "按钮文本不能为空").max(BUTTON_TEXT_MAX, "按钮文本最多30个字符"),
  url: z.string().url("无效的URL格式").optional().or(z.literal('')),
  callback_data: z.string().optional().refine(
    (val) => {
      if (!val) return true;
      return getByteLength(val) <= CALLBACK_DATA_MAX_BYTES;
    },
    { message: CALLBACK_DATA_ERROR_MESSAGE }
  ),
  linked_screen_id: z.string().optional(),
});

/**
 * 键盘行验证 Schema
 */
export const KeyboardRowSchema = z.object({
  id: z.string(),
  buttons: z.array(ButtonSchema).min(1, "每行至少要有一个按钮").max(MAX_BUTTONS_PER_ROW, `每行最多${MAX_BUTTONS_PER_ROW}个按钮`),
});

/**
 * 键盘验证 Schema
 */
export const KeyboardSchema = z.array(KeyboardRowSchema).max(MAX_KEYBOARD_ROWS, `最多${MAX_KEYBOARD_ROWS}行按钮`);

/**
 * 消息内容验证 Schema
 */
export const MessageContentSchema = z.string()
  .min(1, "消息内容不能为空")
  .max(4096, "消息内容最多4096个字符");

/**
 * 模版验证 Schema
 */
export const ScreenSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "模版名称不能为空").max(100, "模版名称最多100个字符"),
  message_content: MessageContentSchema,
  keyboard: KeyboardSchema,
  share_token: z.string().optional(),
  is_public: z.boolean(),
});

/**
 * 流程导出格式验证 Schema
 */
export const FlowExportSchema = z.object({
  version: z.string(),
  entry_screen_id: z.string(),
  screens: z.array(ScreenSchema),
});

/**
 * 验证按钮数据
 */
export const validateButton = (button: unknown) => {
  const result = ButtonSchema.safeParse(button);
  if (!result.success) {
    const messages = result.error.errors.map(e => e.message).join(', ');
    throw new Error(`按钮数据验证失败: ${messages}`);
  }
  return result.data;
};

export const validateCallbackData = (value: string) => {
  const bytes = getByteLength(value);
  if (bytes > CALLBACK_DATA_MAX_BYTES) {
    throw new Error(CALLBACK_DATA_ERROR_MESSAGE);
  }
  return value;
};

/**
 * 验证键盘数据
 */
export const validateKeyboard = (keyboard: unknown) => {
  const result = KeyboardSchema.safeParse(keyboard);
  if (!result.success) {
    const messages = result.error.errors.map(formatKeyboardIssue).join(', ');
    throw new Error(`键盘数据验证失败: ${messages}`);
  }
  return result.data;
};

/**
 * 验证消息内容
 */
export const validateMessageContent = (content: unknown) => {
  try {
    return MessageContentSchema.parse(content);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => e.message).join(', ');
      throw new Error(`消息内容验证失败: ${messages}`);
    }
    throw error;
  }
};

/**
 * 验证模版数据
 */
export const validateScreen = (screen: unknown) => {
  try {
    return ScreenSchema.parse(screen);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => e.message).join(', ');
      throw new Error(`模版数据验证失败: ${messages}`);
    }
    throw error;
  }
};

/**
 * 收集键盘校验错误（用于内联提示）
 */
export const getKeyboardValidationErrors = (keyboard: KeyboardRow[] | unknown) => {
  const result = KeyboardSchema.safeParse(keyboard);
  if (result.success) return [];
  return result.error.errors.map(formatKeyboardIssue);
};

/**
 * 验证流程导出数据
 */
export const validateFlowExport = (data: unknown) => {
  try {
    return FlowExportSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => e.message).join(', ');
      throw new Error(`流程数据验证失败: ${messages}`);
    }
    throw error;
  }
};
