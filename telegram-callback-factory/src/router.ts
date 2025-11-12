import type { ParsedCallback, RouteHandler } from './types';

interface Route {
  namespace: string;
  action: string;
  handler: RouteHandler;
}

/**
 * 回调路由器
 */
export class CallbackRouter {
  private routes: Route[] = [];

  /**
   * 注册路由
   */
  on(namespace: string, action: string, handler: RouteHandler): this {
    this.routes.push({ namespace, action, handler });
    return this;
  }

  /**
   * 注册通配符路由（匹配所有 action）
   */
  onNamespace(namespace: string, handler: RouteHandler): this {
    return this.on(namespace, '*', handler);
  }

  /**
   * 调度执行
   */
  async dispatch(parsed: ParsedCallback, ctx?: unknown): Promise<boolean> {
    for (const route of this.routes) {
      const namespaceMatch = route.namespace === '*' || route.namespace === parsed.ns;
      const actionMatch = route.action === '*' || route.action === parsed.action;
      
      if (namespaceMatch && actionMatch) {
        await route.handler(parsed, ctx);
        return true;
      }
    }
    
    return false;
  }

  /**
   * 生成正则模式（用于 bot.action）
   */
  pattern(namespace?: string, action?: string): RegExp {
    if (namespace && action) {
      return new RegExp(`^${this.escapeRegex(namespace)}:${this.escapeRegex(action)}:`);
    }
    if (namespace) {
      return new RegExp(`^${this.escapeRegex(namespace)}:`);
    }
    return /.*/;
  }

  /**
   * 转义正则特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 获取所有路由
   */
  getRoutes(): Route[] {
    return [...this.routes];
  }

  /**
   * 清空路由
   */
  clear(): void {
    this.routes = [];
  }
}
