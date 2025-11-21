import type { CallbackData, FactoryOptions, MakeOptions } from './types';

/**
 * 回调数据工厂
 */
export class CallbackFactory {
  private maxLength: number;
  private cache?: FactoryOptions['cache'];

  constructor(options: FactoryOptions = {}) {
    this.maxLength = options.maxLength || 64;
    this.cache = options.cache;
  }

  /**
   * 生成回调数据字符串
   */
  make(
    namespace: string,
    action: string,
    data?: Record<string, unknown>,
    options?: MakeOptions
  ): string {
    const payload: CallbackData = {
      ns: namespace,
      action,
    };

    // 添加过期时间
    if (options?.ttl) {
      payload.exp = Date.now() + options.ttl;
    }

    // 添加随机值防重放
    if (options?.nonce !== false) {
      payload.nonce = this.generateNonce();
    }

    // 添加数据
    if (data && Object.keys(data).length > 0) {
      payload.data = data;
    }

    // 序列化并检查长度
    let result = this.serialize(payload);
    
    // 如果超长，尝试裁剪
    if (result.length > this.maxLength) {
      result = this.truncate(payload);
    }

    // 存储到缓存（用于防重放）
    if (this.cache && payload.nonce) {
      this.cache.set(`cb:${payload.nonce}`, true, options?.ttl || 300000);
    }

    return result;
  }

  /**
   * 序列化为紧凑格式
   */
  private serialize(payload: CallbackData): string {
    // 使用紧凑的分隔符格式: ns:action:data:exp:nonce
    const parts: string[] = [payload.ns, payload.action];
    
    if (payload.data) {
      // 使用 base64url 编码 JSON
      const dataStr = JSON.stringify(payload.data);
      parts.push(this.base64urlEncode(dataStr));
    } else {
      parts.push('');
    }
    
    if (payload.exp) {
      parts.push(payload.exp.toString(36)); // 36进制更短
    } else {
      parts.push('');
    }
    
    if (payload.nonce) {
      parts.push(payload.nonce);
    }
    
    return parts.join(':');
  }

  /**
   * 截断数据以满足长度限制
   */
  private truncate(payload: CallbackData): string {
    // 策略：逐步移除非关键数据
    const attempts = [
      // 1. 移除 nonce
      () => ({ ...payload, nonce: undefined }),
      // 2. 移除过期时间
      () => ({ ...payload, nonce: undefined, exp: undefined }),
      // 3. 简化数据字段
      () => ({
        ...payload,
        nonce: undefined,
        exp: undefined,
        data: payload.data ? this.simplifyData(payload.data) : undefined,
      }),
      // 4. 移除所有数据
      () => ({
        ns: payload.ns,
        action: payload.action,
      }),
    ];

    for (const attempt of attempts) {
      const simplified = attempt();
      const result = this.serialize(simplified);
      if (result.length <= this.maxLength) {
        return result;
      }
    }

    // 最后手段：强制截断
    const basic = `${payload.ns}:${payload.action}`;
    return basic.slice(0, this.maxLength);
  }

  /**
   * 简化数据对象（只保留最重要的字段）
   */
  private simplifyData(data: Record<string, unknown>): Record<string, unknown> {
    const important = ['id', 'page', 'action', 'type'];
    const simplified: Record<string, unknown> = {};
    
    for (const key of important) {
      if (key in data) {
        simplified[key] = data[key];
      }
    }
    
    return Object.keys(simplified).length > 0 ? simplified : { _: 1 };
  }

  /**
   * Base64URL 编码
   */
  private base64urlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * 生成短随机值
   */
  private generateNonce(): string {
    return Math.random().toString(36).slice(2, 8);
  }
}
