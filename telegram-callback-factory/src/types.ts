/**
 * 回调数据结构
 */
export interface CallbackData {
  /** 命名空间 */
  ns: string;
  /** 动作 */
  action: string;
  /** 参数 */
  data?: Record<string, unknown>;
  /** 过期时间戳 */
  exp?: number;
  /** 随机值，防重放 */
  nonce?: string;
}

/**
 * 解析结果
 */
export interface ParsedCallback extends CallbackData {
  /** 原始字符串 */
  raw: string;
  /** 是否过期 */
  expired: boolean;
  /** 是否重复 */
  duplicate: boolean;
}

/**
 * 工厂选项
 */
export interface FactoryOptions {
  /** 最大长度限制 */
  maxLength?: number;
  /** 缓存实例 */
  cache?: CacheInterface;
}

/**
 * 解析器选项
 */
export interface ParserOptions {
  /** 缓存实例 */
  cache?: CacheInterface;
}

/**
 * 生成选项
 */
export interface MakeOptions {
  /** TTL 毫秒 */
  ttl?: number;
  /** 是否添加随机值 */
  nonce?: boolean;
}

/**
 * 缓存接口
 */
export interface CacheInterface {
  set(key: string, value: unknown, ttl?: number): void;
  get(key: string): unknown;
  has(key: string): boolean;
  delete(key: string): void;
}

/**
 * 路由处理器
 */
export type RouteHandler = (parsed: ParsedCallback, ctx?: unknown) => void | Promise<void>;

/**
 * 中间件上下文
 */
export interface MiddlewareContext {
  callbackQuery?: {
    data?: string;
  };
  answerCallbackQuery?: (text?: string, options?: Record<string, unknown>) => Promise<void>;
  parsedCallback?: ParsedCallback;
}
