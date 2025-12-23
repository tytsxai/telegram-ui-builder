import { useEffect, useRef, useCallback } from 'react';

interface AutoSaveOptions<TData> {
  interval?: number; // 自动保存间隔（毫秒）
  enabled?: boolean; // 是否启用自动保存
  onSave: () => void | Promise<void>; // 保存回调函数
  data: TData; // 需要监听变化的数据
  storageKey?: string; // localStorage 存储键名
  beaconUrl?: string; // sendBeacon 发送地址
  beaconPayload?: (data: TData) => BodyInit; // sendBeacon 自定义数据
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
  beaconUrl,
  beaconPayload,
}: AutoSaveOptions<TData>) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");
  const latestDataRef = useRef<TData>(data);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // 保存到 localStorage
  const saveToLocalStorage = useCallback((skipDirtyCheck = false) => {
    if (!storageKey) return;

    try {
      const dataString = JSON.stringify(latestDataRef.current);
      if (!skipDirtyCheck && dataString === lastSavedRef.current) {
        return;
      }
      localStorage.setItem(storageKey, dataString);
      localStorage.setItem(`${storageKey}_timestamp`, Date.now().toString());
      lastSavedRef.current = dataString;
    } catch (error) {
      console.error('[AutoSave] 保存到 localStorage 失败:', error);
    }
  }, [storageKey]);

  // 使用 sendBeacon 作为卸载备选
  const sendBeaconSnapshot = useCallback(() => {
    if (!beaconUrl || typeof navigator === 'undefined' || !navigator.sendBeacon) {
      return false;
    }

    try {
      const payload =
        beaconPayload?.(latestDataRef.current) ??
        new Blob([JSON.stringify(latestDataRef.current)], { type: 'application/json' });
      return navigator.sendBeacon(beaconUrl, payload);
    } catch (error) {
      console.error('[AutoSave] sendBeacon 失败:', error);
      return false;
    }
  }, [beaconPayload, beaconUrl]);

  // 清除 localStorage
  const clearLocalStorage = useCallback(() => {
    if (!storageKey) return;
    
    try {
      localStorage.removeItem(storageKey);
      localStorage.removeItem(`${storageKey}_timestamp`);
      lastSavedRef.current = '';
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
          // restored within retention window
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

    // 清除旧的定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 设置新的定时器
    timerRef.current = setTimeout(() => {
      saveToLocalStorage();
      void onSaveRef.current();
    }, interval);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [data, enabled, interval, saveToLocalStorage]);

  // 页面卸载前保存
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const currentData = JSON.stringify(latestDataRef.current);
      const isDirty = currentData !== lastSavedRef.current;

      // Always save on beforeunload to capture latest state
      saveToLocalStorage(true);

      // Use beacon to ensure data sync if configured
      sendBeaconSnapshot();

      // Warn if there were unsaved changes
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '您有未保存的更改，确定要离开吗？';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveToLocalStorage, sendBeaconSnapshot]);

  // 页面隐藏时提前保存（避免 beforeunload 丢失）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      saveToLocalStorage();
      void onSaveRef.current();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [saveToLocalStorage]);

  // 组件卸载时保存
  useEffect(() => {
    return () => {
      saveToLocalStorage();
      void onSaveRef.current();
    };
  }, [saveToLocalStorage]);

  return {
    saveToLocalStorage,
    restoreFromLocalStorage,
    clearLocalStorage,
  };
};
