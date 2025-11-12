import type { ParsedCallback, ParserOptions, MiddlewareContext } from './types';

/**
 * 回调数据解析器
 */
export class CallbackParser {
  private cache?: ParserOptions['cache'];

  constructor(options: ParserOptions = {}) {
    this.cache = options.cache;
  }

  /**
   * 解析回调数据字符串
   */
  parse(callbackData: string): ParsedCallback {
    const parts = callbackData.split(':');
    const [ns, action, dataB64 = '', expStr = '', nonce = ''] = parts;

    // 解析数据
    let data: Record<string, unknown> | undefined;
    if (dataB64) {
      try {
        const dataStr = this.base64urlDecode(dataB64);
        data = JSON.parse(dataStr) as Record<string, unknown>;
      } catch {
        // 忽略解析错误
      }
    }

    // 解析过期时间
    let exp: number | undefined;
    let expired = false;
    if (expStr) {
      exp = parseInt(expStr, 36);
      expired = Date.now() > exp;
    }

    // 检查重复
    let duplicate = false;
    if (this.cache && nonce) {
      duplicate = this.cache.has(`cb:${nonce}`);
      if (!duplicate) {
        // 标记为已使用
        this.cache.set(`cb:${nonce}`, true, 300000);
      }
    }

    return {
      ns,
      action,
      data,
      exp,
      nonce: nonce || undefined,
      raw: callbackData,
      expired,
      duplicate,
    };
  }

  /**
   * 中间件：自动解析并附加到上下文
   */
  middleware() {
    return async (ctx: MiddlewareContext, next: () => Promise<void>) => {
      const callbackData = ctx.callbackQuery?.data;
      
      if (callbackData) {
        const parsed = this.parse(callbackData);
        
        // 校验
        if (parsed.expired) {
          await ctx.answerCallbackQuery?.('操作已过期', { show_alert: true });
          return;
        }
        
        if (parsed.duplicate) {
          await ctx.answerCallbackQuery?.('请勿重复点击', { show_alert: false });
          return;
        }
        
        ctx.parsedCallback = parsed;
      }
      
      await next();
    };
  }

  /**
   * Base64URL 解码
   */
  private base64urlDecode(str: string): string {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    return Buffer.from(base64 + padding, 'base64').toString('utf-8');
  }
}
