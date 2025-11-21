import { useEffect, useRef, useCallback } from 'react';

interface AutoSaveOptions<TData> {
  interval?: number; // 自动保存间隔（毫秒）
  enabled?: boolean; // 是否启用自动保存
  onSave: () => void | Promise<void>; // 保存回调函数
  data: TData; // 需要监听变化的数据
  storageKey?: string; // localStorage 存储键名
}

/**
 * 自动保存 Hook
 * - 定期自动保存到 localStorage
 * - 支持从 localStorage 恢复数据
 * - 防抖处理避免频繁保存
 */
export const useAutoSave = <TData,>({
  interval = 30000, // 默认30秒
  enabled = true,
  onSave,
  data,
  storageKey = 'autosave_draft',
}: AutoSaveOptions<TData>) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>('');
  const isInitialMount = useRef(true);

  // 保存到 localStorage
  const saveToLocalStorage = useCallback(() => {
    if (!storageKey) return;
    
    try {
      const dataString = JSON.stringify(data);
      // 只有当数据真正改变时才保存
      if (dataString !== lastSavedRef.current) {
        localStorage.setItem(storageKey, dataString);
        localStorage.setItem(`${storageKey}_timestamp`, Date.now().toString());
        lastSavedRef.current = dataString;
        console.log('[AutoSave] 已保存到本地缓存');
      }
    } catch (error) {
      console.error('[AutoSave] 保存到 localStorage 失败:', error);
    }
  }, [data, storageKey]);

  // 清除 localStorage
  const clearLocalStorage = useCallback(() => {
    if (!storageKey) return;
    
    try {
      localStorage.removeItem(storageKey);
      localStorage.removeItem(`${storageKey}_timestamp`);
      lastSavedRef.current = '';
      console.log('[AutoSave] 已清除本地缓存');
    } catch (error) {
      console.error('[AutoSave] 清除 localStorage 失败:', error);
    }
  }, [storageKey]);

  // 从 localStorage 恢复
  const restoreFromLocalStorage = useCallback((): TData | null => {
    if (!storageKey) return null;
    
    try {
      const saved = localStorage.getItem(storageKey);
      const timestamp = localStorage.getItem(`${storageKey}_timestamp`);
      
      if (saved && timestamp) {
        const savedTime = parseInt(timestamp, 10);
        const now = Date.now();
        const hourInMs = 60 * 60 * 1000;
        
        // 只恢复1小时内的数据
        if (now - savedTime < hourInMs) {
          console.log('[AutoSave] 从本地缓存恢复数据');
          return JSON.parse(saved) as TData;
        }
        // 清除过期数据
        clearLocalStorage();
      }
    } catch (error) {
      console.error('[AutoSave] 从 localStorage 恢复失败:', error);
    }
    
    return null;
  }, [clearLocalStorage, storageKey]);

  // 自动保存定时器
  useEffect(() => {
    if (!enabled) return;

    // 首次挂载时跳过
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // 清除旧的定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 设置新的定时器
    timerRef.current = setTimeout(() => {
      saveToLocalStorage();
      onSave();
    }, interval);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [data, enabled, interval, onSave, saveToLocalStorage]);

  // 页面卸载前保存
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      saveToLocalStorage();
      
      // 检查是否有未保存的更改
      const currentData = JSON.stringify(data);
      if (currentData !== lastSavedRef.current) {
        e.preventDefault();
        e.returnValue = '您有未保存的更改，确定要离开吗？';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [data, saveToLocalStorage]);

  return {
    saveToLocalStorage,
    restoreFromLocalStorage,
    clearLocalStorage,
  };
};
