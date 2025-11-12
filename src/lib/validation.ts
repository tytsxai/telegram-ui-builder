import { z } from 'zod';

/**
 * 按钮数据验证 Schema
 */
export const ButtonSchema = z.object({
  id: z.string(),
  text: z.string().min(1, "按钮文本不能为空").max(30, "按钮文本最多30个字符"),
  url: z.string().url("无效的URL格式").optional().or(z.literal('')),
  callback_data: z.string().max(64, "callback_data最多64字节").optional(),
  linked_screen_id: z.string().optional(),
});

/**
 * 键盘行验证 Schema
 */
export const KeyboardRowSchema = z.object({
  id: z.string(),
  buttons: z.array(ButtonSchema).min(1, "每行至少要有一个按钮").max(8, "每行最多8个按钮"),
});

/**
 * 键盘验证 Schema
 */
export const KeyboardSchema = z.array(KeyboardRowSchema).max(100, "最多100行按钮");

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
  try {
    return ButtonSchema.parse(button);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => e.message).join(', ');
      throw new Error(`按钮数据验证失败: ${messages}`);
    }
    throw error;
  }
};

/**
 * 验证键盘数据
 */
export const validateKeyboard = (keyboard: unknown) => {
  try {
    return KeyboardSchema.parse(keyboard);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => e.message).join(', ');
      throw new Error(`键盘数据验证失败: ${messages}`);
    }
    throw error;
  }
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
