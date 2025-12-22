/**
 * 引用完整性检查工具
 */

import { Screen, KeyboardRow, KeyboardButton } from '@/types/telegram';

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
  const MAX_DEPTH = 100;
  const screenMap = new Map(allScreens.map((screen) => [screen.id, screen]));

  if (!screenMap.has(startScreenId)) {
    return { hasCircle: false, path: [] };
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  const dfs = (screenId: string, depth: number): boolean => {
    if (depth > MAX_DEPTH) return false;

    visited.add(screenId);
    recursionStack.add(screenId);
    path.push(screenId);

    const screen = screenMap.get(screenId);
    if (!screen) {
      recursionStack.delete(screenId);
      path.pop();
      return false;
    }

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
          if (dfs(targetId, depth + 1)) {
            return true;
          }
        }
      }
    }

    recursionStack.delete(screenId);
    path.pop();
    return false;
  };

  const hasCircle = dfs(startScreenId, 0);

  return { hasCircle, path };
};

/**
 * 获取所有循环引用路径
 */
export const findAllCircularReferences = (
  allScreens: Screen[]
): Array<{ path: string[]; screenNames: string[] }> => {
  const circles: Array<{ path: string[]; screenNames: string[] }> = [];

  const { adjacency, screenMap } = buildGraph(allScreens);
  const components = findStronglyConnectedComponents(adjacency);
  const circularComponents = components.filter((component) => {
    if (component.length > 1) return true;
    const node = component[0];
    return adjacency.get(node)?.includes(node) ?? false;
  });

  circularComponents.forEach((component) => {
    const path = findCyclePathInComponent(component, adjacency);
    if (!path) return;

    const screenNames = path.map((id) => screenMap.get(id)?.name || id);
    circles.push({ path, screenNames });
  });

  return circles;
};

export const circularEdgesFromPaths = (cycles: Array<{ path: string[] }>): Set<string> => {
  const edgeIds = new Set<string>();
  cycles.forEach(({ path }) => {
    for (let i = 0; i < path.length - 1; i++) {
      edgeIds.add(`${path[i]}->${path[i + 1]}`);
    }
  });
  return edgeIds;
};

export const findCircularEdges = (allScreens: Screen[]): Set<string> => {
  const edgeIds = new Set<string>();
  const { adjacency } = buildGraph(allScreens);
  const components = findStronglyConnectedComponents(adjacency);

  components.forEach((component) => {
    const componentSet = new Set(component);
    const isCircular =
      component.length > 1 ||
      (component.length === 1 && adjacency.get(component[0])?.includes(component[0]));
    if (!isCircular) return;

    component.forEach((from) => {
      (adjacency.get(from) || []).forEach((to) => {
        if (componentSet.has(to)) {
          edgeIds.add(`${from}->${to}`);
        }
      });
    });
  });

  return edgeIds;
};

const buildGraph = (allScreens: Screen[]) => {
  const screenMap = new Map(allScreens.map((screen) => [screen.id, screen]));
  const adjacency = new Map<string, string[]>();

  allScreens.forEach((screen) => {
    const targets: string[] = [];
    const keyboard = screen.keyboard ?? [];
    keyboard.forEach((row) => {
      row.buttons?.forEach((button) => {
        if (!button.linked_screen_id) return;
        if (!screenMap.has(button.linked_screen_id)) return;
        targets.push(button.linked_screen_id);
      });
    });
    adjacency.set(screen.id, targets);
  });

  return { adjacency, screenMap };
};

const findStronglyConnectedComponents = (
  adjacency: Map<string, string[]>
): string[][] => {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const components: string[][] = [];

  const strongConnect = (node: string) => {
    indices.set(node, index);
    lowlink.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    (adjacency.get(node) || []).forEach((neighbor) => {
      if (!indices.has(neighbor)) {
        strongConnect(neighbor);
        lowlink.set(
          node,
          Math.min(lowlink.get(node)!, lowlink.get(neighbor)!)
        );
      } else if (onStack.has(neighbor)) {
        lowlink.set(
          node,
          Math.min(lowlink.get(node)!, indices.get(neighbor)!)
        );
      }
    });

    if (lowlink.get(node) === indices.get(node)) {
      const component: string[] = [];
      let current: string | undefined;
      do {
        current = stack.pop();
        if (!current) break;
        onStack.delete(current);
        component.push(current);
      } while (current !== node);
      components.push(component);
    }
  };

  adjacency.forEach((_value, node) => {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  });

  return components;
};

const findCyclePathInComponent = (
  component: string[],
  adjacency: Map<string, string[]>
): string[] | null => {
  const componentSet = new Set(component);
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  const dfs = (node: string): string[] | null => {
    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const neighbor of adjacency.get(node) || []) {
      if (!componentSet.has(neighbor)) continue;

      if (inStack.has(neighbor)) {
        const cycleStartIndex = path.indexOf(neighbor);
        return path.slice(cycleStartIndex).concat(neighbor);
      }

      if (!visited.has(neighbor)) {
        const result = dfs(neighbor);
        if (result) return result;
      }
    }

    inStack.delete(node);
    path.pop();
    return null;
  };

  for (const node of component) {
    if (!visited.has(node)) {
      const result = dfs(node);
      if (result) return result;
    }
  }

  return null;
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
