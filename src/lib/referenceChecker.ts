/**
 * 引用完整性检查工具
 */

interface KeyboardButton {
  id: string;
  text: string;
  url?: string;
  callback_data?: string;
  linked_screen_id?: string;
}

interface KeyboardRow {
  id: string;
  buttons: KeyboardButton[];
}

interface Screen {
  id: string;
  name: string;
  keyboard: KeyboardRow[];
}

interface ReferenceInfo {
  screenId: string;
  screenName: string;
  buttonText: string;
  rowIndex: number;
  buttonIndex: number;
}

/**
 * 检查模版是否被其他模版的按钮引用
 */
export const findScreenReferences = (
  targetScreenId: string,
  allScreens: Screen[]
): ReferenceInfo[] => {
  const references: ReferenceInfo[] = [];

  allScreens.forEach((screen) => {
    if (screen.id === targetScreenId) return; // 跳过自己

    const keyboard = screen.keyboard ?? [];
    keyboard.forEach((row, rowIndex) => {
      row.buttons?.forEach((button, buttonIndex) => {
        if (button.linked_screen_id === targetScreenId) {
          references.push({
            screenId: screen.id,
            screenName: screen.name,
            buttonText: button.text,
            rowIndex,
            buttonIndex,
          });
        }
      });
    });
  });

  return references;
};

/**
 * 检查循环引用
 * 使用深度优先搜索检测环路
 */
export const detectCircularReferences = (
  startScreenId: string,
  allScreens: Screen[]
): { hasCircle: boolean; path: string[] } => {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  const dfs = (screenId: string): boolean => {
    visited.add(screenId);
    recursionStack.add(screenId);
    path.push(screenId);

    const screen = allScreens.find((s) => s.id === screenId);
    if (!screen) return false;

    const keyboard = screen.keyboard ?? [];
    for (const row of keyboard) {
      for (const button of row.buttons || []) {
        if (!button.linked_screen_id) continue;

        const targetId = button.linked_screen_id;

        // 如果目标在递归栈中，说明找到了环
        if (recursionStack.has(targetId)) {
          path.push(targetId);
          return true;
        }

        // 如果目标未访问过，继续深度优先搜索
        if (!visited.has(targetId)) {
          if (dfs(targetId)) {
            return true;
          }
        }
      }
    }

    recursionStack.delete(screenId);
    path.pop();
    return false;
  };

  const hasCircle = dfs(startScreenId);

  return { hasCircle, path };
};

/**
 * 获取所有循环引用路径
 */
export const findAllCircularReferences = (
  allScreens: Screen[]
): Array<{ path: string[]; screenNames: string[] }> => {
  const circles: Array<{ path: string[]; screenNames: string[] }> = [];
  const checkedStartNodes = new Set<string>();

  allScreens.forEach((screen) => {
    if (checkedStartNodes.has(screen.id)) return;

    const { hasCircle, path } = detectCircularReferences(screen.id, allScreens);

    if (hasCircle) {
      // 标记路径中的所有节点为已检查
      path.forEach((id) => checkedStartNodes.add(id));

      const screenNames = path.map((id) => {
        const s = allScreens.find((x) => x.id === id);
        return s?.name || id;
      });

      circles.push({ path, screenNames });
    }
  });

  return circles;
};

/**
 * 获取模版的所有子孙模版（递归）
 */
export const getDescendantScreens = (
  screenId: string,
  allScreens: Screen[],
  visited = new Set<string>()
): Set<string> => {
  if (visited.has(screenId)) return visited;

  visited.add(screenId);

  const screen = allScreens.find((s) => s.id === screenId);
  if (!screen) return visited;

  const keyboard = screen.keyboard ?? [];
  keyboard.forEach((row) => {
    row.buttons?.forEach((button) => {
      if (button.linked_screen_id && !visited.has(button.linked_screen_id)) {
        getDescendantScreens(button.linked_screen_id, allScreens, visited);
      }
    });
  });

  return visited;
};

/**
 * 生成模版关系图数据（用于可视化）
 */
export interface GraphNode {
  id: string;
  name: string;
  level: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  buttonText: string;
}

export const generateRelationshipGraph = (
  allScreens: Screen[]
): { nodes: GraphNode[]; edges: GraphEdge[] } => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const levelMap = new Map<string, number>();

  // BFS计算层级
  const calculateLevels = (startId: string) => {
    const queue: Array<{ id: string; level: number }> = [{ id: startId, level: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      if (visited.has(id)) continue;

      visited.add(id);
      levelMap.set(id, Math.min(levelMap.get(id) || Infinity, level));

      const screen = allScreens.find((s) => s.id === id);
      if (!screen) continue;

      const keyboard = screen.keyboard ?? [];
      keyboard.forEach((row) => {
        row.buttons?.forEach((button) => {
          if (button.linked_screen_id) {
            queue.push({ id: button.linked_screen_id, level: level + 1 });
            edges.push({
              from: id,
              to: button.linked_screen_id,
              buttonText: button.text,
            });
          }
        });
      });
    }
  };

  // 找到所有根节点（没有被引用的模版）
  const referencedIds = new Set<string>();
  allScreens.forEach((screen) => {
    const keyboard = screen.keyboard ?? [];
    keyboard.forEach((row) => {
      row.buttons?.forEach((button) => {
        if (button.linked_screen_id) {
          referencedIds.add(button.linked_screen_id);
        }
      });
    });
  });

  const rootScreens = allScreens.filter((s) => !referencedIds.has(s.id));

  // 从根节点开始计算层级；若不存在明确根节点（所有节点都互相引用），选择一个具有输出的节点作为锚点
  if (rootScreens.length > 0) {
    rootScreens.forEach((root) => calculateLevels(root.id));
  } else if (allScreens.length > 0) {
    const fallback =
      allScreens.find((screen) =>
        (screen.keyboard ?? []).some((row) =>
          row.buttons?.some((btn) => Boolean(btn.linked_screen_id))
        )
      ) || allScreens[0];
    if (fallback) {
      calculateLevels(fallback.id);
    }
  }

  // 为孤立节点设置层级
  allScreens.forEach((screen) => {
    if (!levelMap.has(screen.id)) {
      levelMap.set(screen.id, 0);
    }
  });

  // 生成节点
  allScreens.forEach((screen) => {
    nodes.push({
      id: screen.id,
      name: screen.name,
      level: levelMap.get(screen.id) || 0,
    });
  });

  return { nodes, edges };
};

/**
 * 检查是否可以安全删除模版
 */
export const canSafelyDeleteScreen = (
  screenId: string,
  allScreens: Screen[]
): { canDelete: boolean; references: ReferenceInfo[] } => {
  const references = findScreenReferences(screenId, allScreens);
  return {
    canDelete: references.length === 0,
    references,
  };
};
