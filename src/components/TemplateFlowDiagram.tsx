import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  ReactFlowInstance,
  NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { AlertCircle, Home, RotateCw, ListChecks, ArrowLeftRight, ArrowUpDown, Maximize2, Minimize2, Network } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { findAllCircularReferences, generateRelationshipGraph } from '@/lib/referenceChecker';
import { supabase } from '@/integrations/supabase/client';
import dagre from '@dagrejs/dagre';

import { Screen, KeyboardRow, KeyboardButton } from '@/types/telegram';

interface TemplateFlowDiagramProps {
  screens: Screen[];
  currentScreenId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScreenClick?: (screenId: string) => void;
  userId?: string;
}

type NodePositionPayload = { id: string; x: number; y: number };

const serializePositions = (positions: NodePositionPayload[]) =>
  positions.map((p) => `${p.id}:${Math.round(p.x)}:${Math.round(p.y)}`).join("|");

const mapFromPositions = (positions: NodePositionPayload[]) => {
  const map = new Map<string, { x: number; y: number }>();
  positions.forEach((pos) => map.set(pos.id, { x: pos.x, y: pos.y }));
  return map;
};

const nodesToPositions = (nodes: Node[]): NodePositionPayload[] =>
  nodes
    .filter((n) => typeof n.position?.x === "number" && typeof n.position?.y === "number")
    .map((n) => ({ id: n.id, x: n.position!.x, y: n.position!.y }));

const TemplateFlowDiagram: React.FC<TemplateFlowDiagramProps> = ({
  screens,
  currentScreenId,
  open,
  onOpenChange,
  onScreenClick,
  userId,
}) => {
  // 控件：布局方向与边标签
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [showButtonLabels, setShowButtonLabels] = useState<boolean>(false);
  const [focusCurrent, setFocusCurrent] = useState<boolean>(false);
  const [hideIsolated, setHideIsolated] = useState<boolean>(false);
  const [edgeStraight, setEdgeStraight] = useState<boolean>(false);
  const [nodeScale, setNodeScale] = useState<number>(1);
  const [mindMapMode, setMindMapMode] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const diagramRef = useRef<HTMLDivElement | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [fullscreen, setFullscreen] = useState<boolean>(false);
  const autoOrientedRef = useRef(false);
  const PREF_KEY = 'diagram_pref_mindmap';
  const POS_KEY = `diagram_positions_${userId || 'anon'}`;
  const [useSavedPositions, setUseSavedPositions] = useState<boolean>(false);
  const savedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [layoutSavedAt, setLayoutSavedAt] = useState<number | null>(null);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const lastSavedSignatureRef = useRef<string>('');
  const autoSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // 预计算循环集合
  const cycleNodeIds = useMemo(() => {
    const cycles = findAllCircularReferences(screens);
    const ids = new Set<string>();
    cycles.forEach(c => c.path.forEach(id => ids.add(id)));
    return ids;
  }, [screens]);

  // 构建节点和边（改进：结构化分层布局 + 循环高亮 + 心智图模式）
  const { nodes: initialNodes, edges: initialEdges, edgeHints, matchIds } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const screenMap = new Map(screens.map(s => [s.id, s]));
    const edgeHintMap = new Map<string, string>();

    // 检测孤立节点和入口节点
    const hasIncomingEdge = new Set<string>();
    const hasOutgoingEdge = new Set<string>();

    // 第一遍：收集所有引用关系
    screens.forEach(screen => {
      screen.keyboard.forEach(row => {
        row.buttons.forEach(btn => {
          if (btn.linked_screen_id && screenMap.has(btn.linked_screen_id)) {
            hasOutgoingEdge.add(screen.id);
            hasIncomingEdge.add(btn.linked_screen_id);
          }
        });
      });
    });

    // 准备邻接表
    const outgoingAll = new Map<string, Set<string>>();
    const incomingAll = new Map<string, Set<string>>();
    screens.forEach(s => {
      const out = new Set<string>();
      s.keyboard.forEach(r => r.buttons.forEach(b => b.linked_screen_id && out.add(b.linked_screen_id)));
      outgoingAll.set(s.id, out);
      out.forEach(t => {
        const set = incomingAll.get(t) || new Set<string>();
        set.add(s.id);
        incomingAll.set(t, set);
      });
    });

    // 使用结构化布局或心智图布局
    const levelIndexMap = new Map<string, { level: number; index: number; side?: 'left' | 'right' }>();
    if (!mindMapMode) {
      const { nodes: gNodes } = generateRelationshipGraph(screens);
      const levelGroups = new Map<number, string[]>();
      gNodes.forEach(n => {
        const list = levelGroups.get(n.level) || [];
        list.push(n.id);
        levelGroups.set(n.level, list);
      });
      const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
      sortedLevels.forEach(level => {
        const ids = (levelGroups.get(level) || []).slice().sort((a, b) => {
          const an = screenMap.get(a)?.name || '';
          const bn = screenMap.get(b)?.name || '';
          return an.localeCompare(bn, 'zh');
        });
        ids.forEach((id, idx) => levelIndexMap.set(id, { level, index: idx }));
      });
    } else {
      // 心智图布局：以 root 为中心，左右分支
      // root 选择：currentScreenId > 入口（无入有出）> 第一个 screen
      let rootId: string | undefined = currentScreenId;
      if (!rootId) {
        const entries = screens.filter(s => !incomingAll.has(s.id) && outgoingAll.get(s.id)?.size);
        rootId = entries[0]?.id || screens[0]?.id;
      }
      if (rootId) {
        const visited = new Set<string>();
        const parent = new Map<string, string>();
        const side = new Map<string, 'left' | 'right'>();
        const level = new Map<string, number>();
        const q: string[] = [rootId];
        visited.add(rootId);
        level.set(rootId, 0);
        let toggleRight = true; // 第一层左右交替
        while (q.length) {
          const id = q.shift()!;
          const lv = level.get(id) || 0;
          const children = Array.from(outgoingAll.get(id) || []);
          for (const ch of children) {
            if (!visited.has(ch)) {
              visited.add(ch);
              parent.set(ch, id);
              level.set(ch, lv + 1);
              // 侧边：第一层交替，其余继承父侧
              if (lv === 0) {
                side.set(ch, toggleRight ? 'right' : 'left');
                toggleRight = !toggleRight;
              } else {
                side.set(ch, side.get(id) || 'right');
              }
              q.push(ch);
            }
          }
        }
        // 分层收集
        const groupsL = new Map<number, string[]>();
        const groupsR = new Map<number, string[]>();
        screens.forEach(s => {
          if (!level.has(s.id)) return; // 未连通暂时忽略
          const lv = level.get(s.id)!;
          const sd = lv === 0 ? undefined : side.get(s.id);
          if (lv === 0) {
            levelIndexMap.set(s.id, { level: 0, index: 0 });
            return;
          }
          if (sd === 'left') {
            const arr = groupsL.get(lv) || [];
            arr.push(s.id);
            groupsL.set(lv, arr);
          } else {
            const arr = groupsR.get(lv) || [];
            arr.push(s.id);
            groupsR.set(lv, arr);
          }
        });
        // 排序并写入索引
        const levels = new Set<number>([...groupsL.keys(), ...groupsR.keys()]);
        Array.from(levels).sort((a, b) => a - b).forEach(lv => {
          const leftIds = (groupsL.get(lv) || []).slice().sort((a, b) => (screenMap.get(a)?.name || '').localeCompare(screenMap.get(b)?.name || '', 'zh'));
          const rightIds = (groupsR.get(lv) || []).slice().sort((a, b) => (screenMap.get(a)?.name || '').localeCompare(screenMap.get(b)?.name || '', 'zh'));
          leftIds.forEach((id, idx) => levelIndexMap.set(id, { level: lv, index: idx, side: 'left' }));
          rightIds.forEach((id, idx) => levelIndexMap.set(id, { level: lv, index: idx, side: 'right' }));
        });
      } else {
        // 回退到普通布局
        const { nodes: gNodes } = generateRelationshipGraph(screens);
        const levelGroups = new Map<number, string[]>();
        gNodes.forEach(n => {
          const list = levelGroups.get(n.level) || [];
          list.push(n.id);
          levelGroups.set(n.level, list);
        });
        const sorted = Array.from(levelGroups.keys()).sort((a, b) => a - b);
        sorted.forEach(levelVal => {
          const ids = (levelGroups.get(levelVal) || []).slice();
          ids.forEach((id, idx) => levelIndexMap.set(id, { level: levelVal, index: idx }));
        });
      }
    }

    // 计算邻接表，供“只看当前相关”过滤
    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();
    screens.forEach(s => {
      const out = new Set<string>();
      s.keyboard.forEach(r => r.buttons.forEach(b => b.linked_screen_id && out.add(b.linked_screen_id)));
      outgoing.set(s.id, out);
      out.forEach(t => {
        const set = incoming.get(t) || new Set<string>();
        set.add(s.id);
        incoming.set(t, set);
      });
    });

    // 若启用只看当前相关，确定需要保留的节点集合（上下游两层）
    const visibleNodes = new Set<string>();
    if (focusCurrent && currentScreenId) {
      const depthLimit = 2;
      const visit = (start: string, dir: 'out' | 'in') => {
        const q: Array<{ id: string; d: number }> = [{ id: start, d: 0 }];
        const seen = new Set<string>([start]);
        while (q.length) {
          const { id, d } = q.shift()!;
          visibleNodes.add(id);
          if (d >= depthLimit) continue;
          const nexts = dir === 'out' ? outgoing.get(id) : incoming.get(id);
          nexts?.forEach(n => {
            if (!seen.has(n)) {
              seen.add(n);
              q.push({ id: n, d: d + 1 });
            }
          });
        }
      };
      visit(currentScreenId, 'out');
      visit(currentScreenId, 'in');
    }

    // 创建节点
    // 预先计算搜索匹配
    const lowerQuery = searchQuery.trim().toLowerCase();
    const matched = new Set<string>();
    if (lowerQuery) {
      screens.forEach(s => {
        if ((s.name || '').toLowerCase().includes(lowerQuery)) matched.add(s.id);
      });
    }

    screens.forEach((screen) => {
      if (hideIsolated) {
        const isolated = !hasIncomingEdge.has(screen.id) && !hasOutgoingEdge.has(screen.id);
        if (isolated) return;
      }
      if (focusCurrent && currentScreenId && !visibleNodes.has(screen.id)) return;
      const isCurrentScreen = screen.id === currentScreenId;
      const isEntryPoint = !hasIncomingEdge.has(screen.id) && hasOutgoingEdge.has(screen.id);
      const isOrphan = !hasIncomingEdge.has(screen.id) && !hasOutgoingEdge.has(screen.id);
      const isEndPoint = hasIncomingEdge.has(screen.id) && !hasOutgoingEdge.has(screen.id);
      const isInCycle = cycleNodeIds.has(screen.id);

      // 计算按钮统计
      const totalButtons = screen.keyboard.reduce((sum, row) => sum + row.buttons.length, 0);
      const linkedButtons = screen.keyboard.reduce(
        (sum, row) => sum + row.buttons.filter(btn => btn.linked_screen_id).length,
        0
      );

      // 布局：按层级和层内序号布置坐标
      const li = levelIndexMap.get(screen.id) || { level: 0, index: 0 };
      const baseW = 220;
      const baseH = 110;
      const nodeW = Math.round(baseW * nodeScale);
      const nodeH = Math.round(baseH * nodeScale);
      const xGap = Math.round(280 * nodeScale);
      const yGap = Math.round(160 * nodeScale);
      let x: number;
      let y: number;
      if (mindMapMode) {
        if (li.level === 0) {
          x = 0; y = 0;
        } else {
          const side = li.side || 'right';
          const sideFactor = side === 'right' ? 1 : -1;
          x = sideFactor * li.level * xGap;
          // 层内垂直居中展开
          const siblings = Array.from(levelIndexMap.entries()).filter(([, v]) => v.level === li.level && v.side === side).length;
          const centerIndex = (siblings - 1) / 2;
          y = (li.index - centerIndex) * yGap;
        }
      } else {
        x = orientation === 'horizontal' ? li.level * xGap : li.index * xGap;
        y = orientation === 'horizontal' ? li.index * yGap : li.level * yGap;
      }

      let nodeColor = 'hsl(var(--primary))';
      let nodeLabel = screen.name;
      let nodeBorderStyle = isInCycle ? 'dashed' : 'solid';
      const isMatched = matched.has(screen.id);

      if (isCurrentScreen) {
        nodeColor = 'hsl(var(--primary))';
        nodeBorderStyle = 'solid';
      } else if (isEntryPoint) {
        nodeColor = 'hsl(var(--success, 142 76% 36%))'; // 绿色 - 入口点
        nodeLabel = `🏠 ${screen.name}`;
      } else if (isOrphan) {
        nodeColor = 'hsl(var(--destructive))'; // 红色 - 孤立节点
        nodeLabel = `⚠️ ${screen.name}`;
      } else if (isEndPoint) {
        nodeColor = 'hsl(var(--secondary-foreground))'; // 蓝色 - 终点
        nodeLabel = `🎯 ${screen.name}`;
      }

      // 允许应用已保存的位置
      const saved = savedPositionsRef.current.get(screen.id);
      nodes.push({
        id: screen.id,
        type: 'default',
        data: {
          label: (
            <div className="flex flex-col items-start gap-1 p-2">
              <div
                className="font-semibold text-sm break-words leading-tight"
                style={{ maxWidth: nodeW - 60, maxHeight: 36, overflow: 'hidden' }}
                title={screen.name}
              >
                {nodeLabel}
              </div>
              <div className="text-xs text-muted-foreground">
                {totalButtons} 按钮 | {linkedButtons} 链接
              </div>
              {isOrphan && (
                <div className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  未被引用
                </div>
              )}
              {isInCycle && (
                <div className="text-[10px] text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> 循环
                </div>
              )}
              {isMatched && (
                <div className="text-[10px] text-primary">匹配</div>
              )}
            </div>
          ),
        },
        position: saved ? { x: saved.x, y: saved.y } : { x, y },
        style: {
          background: 'hsl(var(--card))',
          border: `2px ${nodeBorderStyle} ${isMatched ? 'hsl(var(--primary))' : nodeColor}`,
          borderRadius: '8px',
          padding: '0',
          width: nodeW,
          cursor: 'pointer',
          boxShadow: isCurrentScreen ? '0 0 0 3px hsla(var(--primary), 0.3)' : undefined,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    });

    // 创建边（连接关系）
    const edgeMap = new Map<string, { count: number; buttons: string[] }>();

    screens.forEach(screen => {
      if (hideIsolated) {
        const isolated = !hasIncomingEdge.has(screen.id) && !hasOutgoingEdge.has(screen.id);
        if (isolated) return;
      }
      if (focusCurrent && currentScreenId && !visibleNodes.has(screen.id)) return;
      screen.keyboard.forEach(row => {
        row.buttons.forEach(btn => {
          if (btn.linked_screen_id && screenMap.has(btn.linked_screen_id)) {
            if (focusCurrent && currentScreenId && (!visibleNodes.has(screen.id) || !visibleNodes.has(btn.linked_screen_id))) {
              return;
            }
            const edgeKey = `${screen.id}->${btn.linked_screen_id}`;
            if (!edgeMap.has(edgeKey)) {
              edgeMap.set(edgeKey, { count: 0, buttons: [] });
            }
            const edgeData = edgeMap.get(edgeKey)!;
            edgeData.count++;
            edgeData.buttons.push(btn.text);
          }
        });
      });
    });

    edgeMap.forEach((data, key) => {
      const [sourceId, targetId] = key.split('->');
      const buttonList = data.buttons.slice(0, 3).join(', ') + (data.buttons.length > 3 ? '...' : '');
      const fullList = data.buttons.join(', ');

      edges.push({
        id: key,
        source: sourceId,
        target: targetId,
        type: mindMapMode ? 'bezier' : (edgeStraight ? 'straight' : 'smoothstep'),
        animated: sourceId === currentScreenId,
        label: showButtonLabels ? buttonList : (data.count > 1 ? `${data.count}个按钮` : data.buttons[0] ?? ''),
        labelStyle: {
          fill: 'hsl(var(--foreground))',
          fontSize: 11,
          fontWeight: 500,
        },
        labelBgStyle: {
          fill: 'hsl(var(--card))',
          fillOpacity: 0.9,
        },
        style: {
          stroke: sourceId === currentScreenId ? 'hsl(var(--primary))' : 'hsl(var(--border))',
          strokeWidth: Math.min(3.5, 1 + Math.log2(1 + data.count)),
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: sourceId === currentScreenId ? 'hsl(var(--primary))' : 'hsl(var(--border))',
          width: 20,
          height: 20,
        },
      });
      edgeHintMap.set(key, fullList);
    });

    return { nodes, edges, edgeHints: edgeHintMap, matchIds: matched };
  }, [screens, currentScreenId, orientation, showButtonLabels, cycleNodeIds, focusCurrent, searchQuery, nodeScale, hideIsolated, edgeStraight, mindMapMode]);

  // 打开时：加载偏好/自动选择模式与方向，并 fitView
  useEffect(() => {
    if (!open) { autoOrientedRef.current = false; return; }
    // 1) 读取本地偏好（低风险：只在有偏好时覆盖）
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw === 'true' || raw === 'false') {
        setMindMapMode(raw === 'true');
      }
    } catch (e) { void e; }

    // 2) 自动选择方向 + 默认心智图（仅大图时开启，低风险）
    if (!autoOrientedRef.current) {
      const { nodes: gNodes } = generateRelationshipGraph(screens);
      const levelSet = new Set<number>();
      gNodes.forEach(n => levelSet.add(n.level));
      const levelCount = levelSet.size;
      const nodeCount = screens.length;
      if (levelCount >= 5) setOrientation('vertical');
      // 大图默认心智图模式（节点>=15 或 层级>=5）
      if (nodeCount >= 15 || levelCount >= 5) {
        setMindMapMode(true);
      }
      autoOrientedRef.current = true;
    }

    // 3) 初始自适应
    setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 80);
  }, [open, screens, rfInstance]);

  // 切换心智图时保存偏好
  useEffect(() => {
    try { localStorage.setItem(PREF_KEY, mindMapMode ? 'true' : 'false'); } catch (e) { void e; }
  }, [mindMapMode]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [edgeHintsMap, setEdgeHintsMap] = useState<Map<string, string>>(edgeHints);
  useEffect(() => setEdgeHintsMap(edgeHints), [edgeHints]);

  const persistPositions = useCallback(async (positions: NodePositionPayload[], options?: { silent?: boolean }) => {
    const signature = serializePositions(positions);
    savedPositionsRef.current = mapFromPositions(positions);
    setUseSavedPositions(positions.length > 0);
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(positions));
    } catch (e) { void e; }

    if (!options?.silent) {
      setLayoutSaving(true);
    }

    lastSavedSignatureRef.current = signature;
    setLayoutSavedAt(Date.now());

    if (userId) {
      try {
        const ids = positions.map((p) => p.id);
        if (ids.length === 0) {
          await supabase.from("screen_layouts").delete().eq("user_id", userId);
        } else {
          await supabase.from("screen_layouts").delete().eq("user_id", userId).in("screen_id", ids);
          const payload = positions.map((p) => ({ user_id: userId, screen_id: p.id, x: p.x, y: p.y }));
          await supabase.from("screen_layouts").upsert(payload, { onConflict: "user_id,screen_id" });
        }
      } catch (e) { /* ignore cloud errors */ }
    }

    if (!options?.silent) {
      setLayoutSaving(false);
    }
  }, [POS_KEY, userId]);

  // 合并自动布局与用户布局：如已存在用户/保存的布局，保留当前坐标，仅为新增节点填充位置
  useEffect(() => {
    setNodes(prev => {
      if (!useSavedPositions && savedPositionsRef.current.size === 0) {
        return initialNodes;
      }
      const prevMap = new Map(prev.map(n => [n.id, n]));
      const merged = initialNodes.map(n => {
        const old = prevMap.get(n.id);
        return old ? { ...n, position: old.position } : n;
      });
      return merged;
    });
  }, [initialNodes, setNodes, useSavedPositions]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // 统计信息
  const stats = useMemo(() => {
    const totalScreens = screens.length;
    const hasIncoming = new Set<string>();
    const hasOutgoing = new Set<string>();

    screens.forEach(screen => {
      screen.keyboard.forEach(row => {
        row.buttons.forEach(btn => {
          if (btn.linked_screen_id) {
            hasOutgoing.add(screen.id);
            hasIncoming.add(btn.linked_screen_id);
          }
        });
      });
    });

    const entryPoints = screens.filter(s => !hasIncoming.has(s.id) && hasOutgoing.has(s.id)).length;
    const orphans = screens.filter(s => !hasIncoming.has(s.id) && !hasOutgoing.has(s.id)).length;
    const endpoints = screens.filter(s => hasIncoming.has(s.id) && !hasOutgoing.has(s.id)).length;

    return { totalScreens, entryPoints, orphans, endpoints, totalLinks: edges.length };
  }, [screens, edges]);

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    if (onScreenClick) {
      onScreenClick(node.id);
      onOpenChange(false);
    }
  };

  // 包装 nodes change：拖拽后开启布局保留
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (changes.some(c => c.type === 'position' || c.type === 'dimensions')) {
      setUseSavedPositions(true);
    }
    onNodesChange(changes);
  }, [onNodesChange]);

  // 布局持久化
  const saveLayout = useCallback(async () => {
    const snapshot = nodesToPositions(nodes);
    await persistPositions(snapshot);
    rfInstance?.fitView({ padding: 0.2, maxZoom: 1 });
  }, [nodes, persistPositions, rfInstance]);

  const loadLayout = useCallback(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return false;
      const arr = JSON.parse(raw) as Array<{ id: string; x: number; y: number }>;
      const m = new Map<string, { x: number; y: number }>();
      arr.forEach(d => m.set(d.id, { x: d.x, y: d.y }));
      savedPositionsRef.current = m;
      const hasData = m.size > 0;
      if (hasData) {
        const payload = arr.map(d => ({ id: d.id, x: d.x, y: d.y }));
        lastSavedSignatureRef.current = serializePositions(payload);
        setLayoutSavedAt(Date.now());
      }
      setUseSavedPositions(hasData);
      return hasData;
    } catch (e) { void e; return false; }
  }, [POS_KEY]);

  const loadLayoutCloud = useCallback(async () => {
    if (!userId) return false;
    try {
      const ids = screens.map(s => s.id);
      if (ids.length === 0) return false;
      const { data, error } = await supabase
        .from("screen_layouts")
        .select("screen_id,x,y")
        .eq("user_id", userId)
        .in("screen_id", ids);
      if (error || !data) return false;
      const m = new Map<string, { x: number; y: number }>();
      const payload: NodePositionPayload[] = [];
      (data as Array<{ screen_id: string; x: number; y: number }>).forEach(row => {
        m.set(row.screen_id, { x: row.x, y: row.y });
        payload.push({ id: row.screen_id, x: row.x, y: row.y });
      });
      if (m.size === 0) return false;
      savedPositionsRef.current = m;
      lastSavedSignatureRef.current = serializePositions(payload);
      setLayoutSavedAt(Date.now());
      setUseSavedPositions(true);
      return true;
    } catch (e) { return false; }
  }, [userId, screens]);

  const clearLayout = useCallback(async () => {
    try { localStorage.removeItem(POS_KEY); } catch (e) { void e; }
    savedPositionsRef.current = new Map();
    lastSavedSignatureRef.current = '';
    setLayoutSavedAt(null);
    setUseSavedPositions(false);
      if (userId) {
        try {
          await supabase.from("screen_layouts").delete().eq("user_id", userId);
        } catch (e) { /* ignore cloud errors */ }
      }
    setNodes(initialNodes);
    setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 50);
  }, [POS_KEY, initialNodes, rfInstance, setNodes, userId]);

  // 自动保存：用户调整或智能整理后延迟写入，避免重复点击
  useEffect(() => {
    if (!open || !useSavedPositions) return;
    const payload = nodesToPositions(nodes);
    if (payload.length === 0) return;
    const signature = serializePositions(payload);
    if (signature === lastSavedSignatureRef.current) return;
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      void persistPositions(payload, { silent: true });
    }, 800);
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [nodes, open, useSavedPositions, persistPositions]);

  // 打开时尝试加载已保存布局
  useEffect(() => {
    if (!open) return;
    const ok = loadLayout();
    if (ok) {
      // 应用保存位置
      setNodes(prev => prev.map(n => {
        const p = savedPositionsRef.current.get(n.id);
        return p ? { ...n, position: { x: p.x, y: p.y } } : n;
      }));
      setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 80);
    }
    // 云端加载（优先级高于本地）
    (async () => {
      const okCloud = await loadLayoutCloud();
      if (okCloud) {
        setNodes(prev => prev.map(n => {
          const p = savedPositionsRef.current.get(n.id);
          return p ? { ...n, position: { x: p.x, y: p.y } } : n;
        }));
        setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 80);
      }
    })();
  }, [open, loadLayout, loadLayoutCloud, rfInstance, setNodes]);

  const runSmartArrange = useCallback(() => {
    if (screens.length === 0) return;

    // 根据规模自动切换方向/心智图
    const { nodes: gNodes } = generateRelationshipGraph(screens);
    const levelGroups = new Map<number, string[]>();
    gNodes.forEach(n => {
      const arr = levelGroups.get(n.level) || [];
      arr.push(n.id);
      levelGroups.set(n.level, arr);
    });
    const levels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
    if (levels.length === 0) return;

    const nodeCount = screens.length;
    const levelCount = levels.length;
    const useRadial = nodeCount >= 24 || levelCount >= 6;
    const shouldMindMap = !useRadial && (nodeCount >= 14 || levelCount >= 5);
    setMindMapMode(shouldMindMap);
    setOrientation(shouldMindMap ? 'horizontal' : (levelCount >= 5 ? 'vertical' : orientation));
    if (nodeCount > 20) {
      setShowButtonLabels(false);
      setEdgeStraight(true);
    }

    const neighbor = new Map<string, Set<string>>();
    const revNeighbor = new Map<string, Set<string>>();
    const undirected = new Map<string, Set<string>>();
    screens.forEach(s => {
      const out = new Set<string>();
      s.keyboard.forEach(r => r.buttons.forEach(b => b.linked_screen_id && out.add(b.linked_screen_id)));
      neighbor.set(s.id, out);
      out.forEach(t => {
        const set = revNeighbor.get(t) || new Set<string>();
        set.add(s.id);
        revNeighbor.set(t, set);
      });
      const und = undirected.get(s.id) || new Set<string>();
      out.forEach(t => und.add(t));
      undirected.set(s.id, und);
      out.forEach(t => {
        const revSet = undirected.get(t) || new Set<string>();
        revSet.add(s.id);
        undirected.set(t, revSet);
      });
    });

    const order = new Map<number, string[]>();
    levels.forEach(lv => {
      const ids = (levelGroups.get(lv) || []).slice().sort((a, b) => {
        const an = screens.find(s => s.id === a)?.name || '';
        const bn = screens.find(s => s.id === b)?.name || '';
        return an.localeCompare(bn, 'zh');
      });
      order.set(lv, ids);
    });

    const passes = 3;
    for (let p = 0; p < passes && !useRadial; p++) {
      for (let i = 1; i < levels.length; i++) {
        const prev = order.get(levels[i - 1]) || [];
        const cur = order.get(levels[i]) || [];
        const idx = new Map(prev.map((id, ix) => [id, ix] as const));
        const scored = cur.map(id => {
          const ns = Array.from(revNeighbor.get(id) || []);
          const vals = ns.map(n => idx.get(n)).filter(v => v !== undefined) as number[];
          const bc = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : Infinity;
          return { id, bc };
        });
        scored.sort((a, b) => (a.bc === b.bc ? cur.indexOf(a.id) - cur.indexOf(b.id) : (a.bc < b.bc ? -1 : 1)));
        order.set(levels[i], scored.map(s => s.id));
      }
      for (let i = levels.length - 2; i >= 0; i--) {
        const next = order.get(levels[i + 1]) || [];
        const cur = order.get(levels[i]) || [];
        const idx = new Map(next.map((id, ix) => [id, ix] as const));
        const scored = cur.map(id => {
          const ns = Array.from(neighbor.get(id) || []);
          const vals = ns.map(n => idx.get(n)).filter(v => v !== undefined) as number[];
          const bc = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : Infinity;
          return { id, bc };
        });
        scored.sort((a, b) => (a.bc === b.bc ? cur.indexOf(a.id) - cur.indexOf(b.id) : (a.bc < b.bc ? -1 : 1)));
        order.set(levels[i], scored.map(s => s.id));
      }
    }

    const positions = new Map<string, { x: number; y: number }>();
    if (useRadial) {
      const rootCandidate =
        currentScreenId ||
        screens.find(s => !revNeighbor.has(s.id) && neighbor.get(s.id)?.size)?.id ||
        screens[0]?.id;
      const levelMap = new Map<string, number>();
      const queue: string[] = [];
      if (rootCandidate) {
        levelMap.set(rootCandidate, 0);
        queue.push(rootCandidate);
      }
      while (queue.length) {
        const node = queue.shift()!;
        const lv = levelMap.get(node) ?? 0;
        const children = Array.from(undirected.get(node) || []);
        children.forEach(child => {
          if (!levelMap.has(child)) {
            levelMap.set(child, lv + 1);
            queue.push(child);
          }
        });
      }
      screens.forEach(s => {
        if (!levelMap.has(s.id)) {
          levelMap.set(s.id, (levelMap.size + 1));
        }
      });
      const groups = new Map<number, string[]>();
      levelMap.forEach((lv, id) => {
        const arr = groups.get(lv) || [];
        arr.push(id);
        groups.set(lv, arr);
      });
      const radialBase = 140 * nodeScale;
      groups.forEach((ids, lv) => {
        const radius = lv * radialBase;
        const count = ids.length;
        ids.forEach((id, idx) => {
          const angle = count === 1 ? -Math.PI / 2 : (2 * Math.PI * idx) / count - Math.PI / 2;
          const x = radius * Math.cos(angle);
          const y = radius * Math.sin(angle);
          positions.set(id, { x, y });
        });
      });
    } else if (shouldMindMap) {
      const rootId = currentScreenId || order.get(levels[0])?.[0] || screens[0]?.id;
      const sideMap = new Map<string, 'left' | 'right'>();
      const levelMap = new Map<string, number>();
      if (rootId) {
        levelMap.set(rootId, 0);
        const queue: string[] = [rootId];
        let toggle = true;
        while (queue.length) {
          const node = queue.shift()!;
          const lv = levelMap.get(node) ?? 0;
          const children = order.get(lv + 1)?.filter(id => (revNeighbor.get(id) || new Set()).has(node)) || [];
          children.forEach(child => {
            if (!levelMap.has(child)) {
              levelMap.set(child, lv + 1);
              if (lv === 0) {
                sideMap.set(child, toggle ? 'right' : 'left');
                toggle = !toggle;
              } else {
                sideMap.set(child, sideMap.get(node) || 'right');
              }
              queue.push(child);
            }
          });
        }
        const xGap = Math.round(360 * nodeScale);
        const yGap = Math.round(180 * nodeScale);
        const leftGroups = new Map<number, string[]>();
        const rightGroups = new Map<number, string[]>();
        screens.forEach(s => {
          const lv = levelMap.get(s.id);
          if (lv === undefined) return;
          if (lv === 0) {
            positions.set(s.id, { x: 0, y: 0 });
            return;
          }
          const side = sideMap.get(s.id) || 'right';
          const map = side === 'left' ? leftGroups : rightGroups;
          const arr = map.get(lv) || [];
          arr.push(s.id);
          map.set(lv, arr);
        });
        Array.from(new Set([...leftGroups.keys(), ...rightGroups.keys()])).sort((a, b) => a - b).forEach(lv => {
          const left = (leftGroups.get(lv) || []).slice();
          const right = (rightGroups.get(lv) || []).slice();
          left.forEach((id, idx) => {
            positions.set(id, { x: -lv * xGap, y: (idx - (left.length - 1) / 2) * yGap });
          });
          right.forEach((id, idx) => {
            positions.set(id, { x: lv * xGap, y: (idx - (right.length - 1) / 2) * yGap });
          });
        });
      }
    } else {
      const dagreGraph = new dagre.graphlib.Graph();
      dagreGraph.setGraph({
        rankdir: orientation === 'horizontal' ? 'LR' : 'TB',
        ranksep: 260 * nodeScale,
        nodesep: 180 * nodeScale,
        marginx: 100,
        marginy: 100,
      });
      dagreGraph.setDefaultEdgeLabel(() => ({}));
      const approxWidth = 250 * nodeScale;
      const approxHeight = 130 * nodeScale;

      screens.forEach(screen => {
        dagreGraph.setNode(screen.id, { width: approxWidth, height: approxHeight });
      });
      screens.forEach(screen => {
        screen.keyboard.forEach(row => {
          row.buttons.forEach(btn => {
            if (btn.linked_screen_id && screens.find(s => s.id === btn.linked_screen_id)) {
              dagreGraph.setEdge(screen.id, btn.linked_screen_id);
            }
          });
        });
      });

      try {
        dagre.layout(dagreGraph);
        screens.forEach(screen => {
          const node = dagreGraph.node(screen.id);
          if (node) {
            positions.set(screen.id, {
              x: node.x - node.width / 2,
              y: node.y - node.height / 2,
            });
          }
        });
      } catch (error) {
        console.error('[FlowDiagram] Dagre layout failed', error);
        const xGap = Math.round(260 * nodeScale);
        const yGap = Math.round(160 * nodeScale);
        levels.forEach((lv, li) => {
          const ids = order.get(lv) || [];
          const center = (ids.length - 1) / 2;
          ids.forEach((id, idx) => {
            const x = orientation === 'horizontal' ? li * xGap : idx * xGap;
            const y = orientation === 'horizontal' ? (idx - center) * yGap : li * yGap;
            positions.set(id, { x, y });
          });
        });
      }
    }

    if (positions.size === 0) return;

    setUseSavedPositions(false);
    setNodes(prev => prev.map(n => positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n));
    setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 80);
  }, [screens, nodeScale, orientation, currentScreenId, setNodes, rfInstance]);

  // 边悬浮提示
  const [edgeTooltip, setEdgeTooltip] = useState<{ visible: boolean; x: number; y: number; text: string }>({ visible: false, x: 0, y: 0, text: '' });
  const showEdgeTooltip = (e: React.MouseEvent, edgeId: string) => {
    const rect = diagramRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left || 0) + 10;
    const y = e.clientY - (rect?.top || 0) + 10;
    const text = edgeHintsMap.get(edgeId) || '';
    setEdgeTooltip({ visible: true, x, y, text });
  };
  const moveEdgeTooltip = (e: React.MouseEvent) => {
    if (!edgeTooltip.visible) return;
    const rect = diagramRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left || 0) + 10;
    const y = e.clientY - (rect?.top || 0) + 10;
    setEdgeTooltip(prev => ({ ...prev, x, y }));
  };
  const hideEdgeTooltip = () => setEdgeTooltip(prev => ({ ...prev, visible: false }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          fullscreen
            ? "w-[100vw] h-[100vh] max-w-none max-h-none p-0 gap-0 flex flex-col rounded-none"
            : "w-[98vw] h-[92vh] max-w-[98vw] max-h-[92vh] p-0 gap-0 flex flex-col"
        }
      >
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className="text-base font-semibold">模版关系图</span>
              <div className="flex flex-wrap items-center gap-4 text-sm font-normal text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Home className="w-4 h-4 text-green-600" />
                  入口: {stats.entryPoints}
                </span>
                <span>终点: {stats.endpoints}</span>
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-destructive" />
                  孤立: {stats.orphans}
                </span>
                <span>总链接: {stats.totalLinks}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm font-normal text-muted-foreground">
              <Button variant="outline" size="sm" onClick={() => setOrientation(o => o === 'horizontal' ? 'vertical' : 'horizontal')} title="切换布局方向">
                {orientation === 'horizontal' ? <ArrowLeftRight className="w-4 h-4 mr-1" /> : <ArrowUpDown className="w-4 h-4 mr-1" />}
                {orientation === 'horizontal' ? '水平' : '垂直'}
              </Button>
              <Button
                size="sm"
                onClick={runSmartArrange}
                title="智能整理（自动选择并细化布局顺序）"
              >
                <Network className="w-4 h-4 mr-1" /> 智能整理
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setUseSavedPositions(false); setNodes(initialNodes); setEdges(initialEdges); setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 50); }} title="重新布局（自动排布）">
                <RotateCw className="w-4 h-4 mr-1" /> 重新布局
              </Button>
              <Button variant="outline" size="sm" onClick={() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 })} title="重置视图">
                重置视图
              </Button>
              <div className="flex items-center gap-2" title="显示边上的按钮名称">
                <ListChecks className="w-4 h-4" />
                <Switch checked={showButtonLabels} onCheckedChange={v => setShowButtonLabels(!!v)} />
              </div>
              <div className="flex items-center gap-2" title="只显示与当前模版相关的节点（上下游2层）">
                <span className="text-muted-foreground">仅关联</span>
                <Switch checked={focusCurrent} onCheckedChange={v => setFocusCurrent(!!v)} />
              </div>
              <div className="flex items-center gap-2" title="心智图模式（从中心向两侧发散）">
                <span className="text-muted-foreground">心智图</span>
                <Switch checked={mindMapMode} onCheckedChange={v => { setMindMapMode(!!v); setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 50); }} />
              </div>
              <div className="flex items-center gap-2" title="隐藏孤立节点（未被引用且无输出）">
                <span className="text-muted-foreground">隐藏孤立</span>
                <Switch checked={hideIsolated} onCheckedChange={v => setHideIsolated(!!v)} />
              </div>
              <div className="flex items-center gap-2" title="边样式：直线/曲线">
                <span className="text-muted-foreground">直线边</span>
                <Switch checked={edgeStraight} onCheckedChange={v => setEdgeStraight(!!v)} />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => void saveLayout()} title="保存当前布局位置">
                    保存布局
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void clearLayout()} title="清除保存并重置到自动布局">
                    重置位置
                  </Button>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {layoutSaving
                    ? '正在保存布局…'
                    : layoutSavedAt
                      ? `布局已保存 ${new Date(layoutSavedAt).toLocaleTimeString()}`
                      : '尚未保存布局'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="搜索节点..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const q = searchQuery.trim().toLowerCase();
                      if (!q) return;
                      const target = screens.find(s => (s.name || '').toLowerCase().includes(q));
                      if (!target) return;
                      const node = nodes.find(n => n.id === target.id);
                      if (node && rfInstance) {
                        const cx = (node.position?.x || 0) + 110;
                        const cy = (node.position?.y || 0) + 55;
                        rfInstance.setCenter(cx, cy, { zoom: 1, duration: 400 });
                      }
                    }
                  }}
                  className="h-8 w-44"
                />
              </div>
              <div className="flex items-center gap-2 w-48" title="节点尺寸/间距">
                <span className="text-muted-foreground text-xs whitespace-nowrap">节点大小</span>
                <Slider min={0.8} max={1.6} step={0.1} value={[nodeScale]} onValueChange={(v) => setNodeScale(v[0] ?? 1)} />
              </div>
              <Button variant="outline" size="sm" onClick={() => { setFullscreen(f => !f); setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 50); }} title={fullscreen ? "退出全屏" : "全屏显示"}>
                {fullscreen ? <Minimize2 className="w-4 h-4 mr-1" /> : <Maximize2 className="w-4 h-4 mr-1" />}
                {fullscreen ? '退出全屏' : '全屏'}
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 relative overflow-hidden" ref={diagramRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onEdgeMouseEnter={(e, edge) => showEdgeTooltip(e as unknown as React.MouseEvent, edge.id)}
            onEdgeMouseMove={(e) => moveEdgeTooltip(e as unknown as React.MouseEvent)}
            onEdgeMouseLeave={hideEdgeTooltip}
            onInit={(inst) => setRfInstance(inst)}
            fitView
            fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
            minZoom={0.1}
            maxZoom={2}
            attributionPosition="bottom-left"
          >
            <Background color="rgba(255,255,255,0.08)" gap={24} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                if (node.id === currentScreenId) return 'hsl(var(--primary))';
                return 'hsl(var(--muted))';
              }}
              maskColor="hsla(var(--background), 0.8)"
            />
          </ReactFlow>
          {edgeTooltip.visible && edgeTooltip.text && (
            <div
              className="absolute z-50 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow"
              style={{ left: edgeTooltip.x, top: edgeTooltip.y }}
            >
              {edgeTooltip.text}
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t bg-muted/30 text-xs text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-green-600"></span>
              🏠 入口点（无输入有输出）
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-blue-600"></span>
              🎯 终点（有输入无输出）
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-destructive"></span>
              ⚠️ 孤立节点（未被引用）
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-amber-600"></span>
              ◌ 循环（在环上的节点，虚线边框）
            </span>
          </div>
          <span>点击节点可跳转到该模版</span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateFlowDiagram;
