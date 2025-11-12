import type { CacheInterface } from './types';

interface CacheEntry {
  value: unknown;
  expires: number;
}

/**
 * 轻量级内存缓存实现
 */
export class MemoryCache implements CacheInterface {
  private store = new Map<string, CacheEntry>();
  private defaultTTL: number;

  constructor(defaultTTL = 300000) {
    this.defaultTTL = defaultTTL;
    
    // 定期清理过期项
    setInterval(() => this.cleanup(), 60000);
  }

  set(key: string, value: unknown, ttl?: number): void {
    const expires = Date.now() + (ttl || this.defaultTTL);
    this.store.set(key, { value, expires });
  }

  get(key: string): unknown {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return undefined;
    }
    
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expires) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}
