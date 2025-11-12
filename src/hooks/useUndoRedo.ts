import { useState, useCallback, useRef } from 'react';

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

interface UseUndoRedoOptions {
  maxHistorySize?: number; // 最大历史记录数
}

/**
 * 撤销/重做 Hook
 * - 支持 Ctrl+Z / Ctrl+Y 快捷键
 * - 限制历史记录大小防止内存溢出
 * - 提供 canUndo / canRedo 状态
 */
export const useUndoRedo = <T>(
  initialState: T,
  options: UseUndoRedoOptions = {}
) => {
  const { maxHistorySize = 50 } = options;
  
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: [],
  });

  const ignoreNextUpdate = useRef(false);

  // 设置新状态
  const setState = useCallback(
    (newState: T | ((prev: T) => T)) => {
      // 如果是忽略更新，则跳过
      if (ignoreNextUpdate.current) {
        ignoreNextUpdate.current = false;
        return;
      }

      setHistory((currentHistory) => {
        const resolvedState =
          typeof newState === 'function'
            ? (newState as (prev: T) => T)(currentHistory.present)
            : newState;

        // 检查状态是否真的改变了
        if (JSON.stringify(resolvedState) === JSON.stringify(currentHistory.present)) {
          return currentHistory;
        }

        const newPast = [...currentHistory.past, currentHistory.present];
        
        // 限制历史记录大小
        if (newPast.length > maxHistorySize) {
          newPast.shift();
        }

        return {
          past: newPast,
          present: resolvedState,
          future: [], // 新操作会清空 future
        };
      });
    },
    [maxHistorySize]
  );

  // 撤销
  const undo = useCallback(() => {
    setHistory((currentHistory) => {
      if (currentHistory.past.length === 0) {
        return currentHistory;
      }

      const previous = currentHistory.past[currentHistory.past.length - 1];
      const newPast = currentHistory.past.slice(0, currentHistory.past.length - 1);

      return {
        past: newPast,
        present: previous,
        future: [currentHistory.present, ...currentHistory.future],
      };
    });
  }, []);

  // 重做
  const redo = useCallback(() => {
    setHistory((currentHistory) => {
      if (currentHistory.future.length === 0) {
        return currentHistory;
      }

      const next = currentHistory.future[0];
      const newFuture = currentHistory.future.slice(1);

      return {
        past: [...currentHistory.past, currentHistory.present],
        present: next,
        future: newFuture,
      };
    });
  }, []);

  // 重置历史
  const reset = useCallback((newState: T) => {
    ignoreNextUpdate.current = true;
    setHistory({
      past: [],
      present: newState,
      future: [],
    });
  }, []);

  // 清空历史但保留当前状态
  const clearHistory = useCallback(() => {
    setHistory((currentHistory) => ({
      past: [],
      present: currentHistory.present,
      future: [],
    }));
  }, []);

  return {
    state: history.present,
    setState,
    undo,
    redo,
    reset,
    clearHistory,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    historySize: history.past.length,
  };
};
