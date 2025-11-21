export { CallbackFactory } from './factory';
export { CallbackParser } from './parser';
export { CallbackRouter } from './router';
export { MemoryCache } from './cache';
export * from './types';

import { CallbackFactory } from './factory';
import { CallbackParser } from './parser';
import { CallbackRouter } from './router';
import { MemoryCache } from './cache';

/**
 * 创建一个完整的回调管理实例
 */
export function createCallbackManager(options?: {
  ttl?: number;
  maxLength?: number;
}) {
  const cache = new MemoryCache(options?.ttl || 300000); // 5分钟默认
  const factory = new CallbackFactory({ 
    maxLength: options?.maxLength || 64,
    cache 
  });
  const parser = new CallbackParser({ cache });
  const router = new CallbackRouter();

  return {
    factory,
    parser,
    router,
    cache,
    
    // 便捷方法
    make: factory.make.bind(factory),
    parse: parser.parse.bind(parser),
    middleware: parser.middleware.bind(parser),
    on: router.on.bind(router),
    dispatch: router.dispatch.bind(router),
    
    // 常用封装
    confirm: (action: string, data?: Record<string, unknown>) => 
      factory.make('confirm', action, data),
    page: (page: number, data?: Record<string, unknown>) => 
      factory.make('page', 'nav', { ...data, page }),
    open: (target: string, data?: Record<string, unknown>) => 
      factory.make('nav', 'open', { ...data, target }),
  };
}

// 默认导出
export default createCallbackManager;
