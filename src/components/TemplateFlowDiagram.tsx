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
  Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { AlertCircle, Home, RotateCw, ListChecks, ArrowLeftRight, ArrowUpDown, Maximize2, Minimize2, Network, Edit, Trash2, PlayCircle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { findAllCircularReferences, generateRelationshipGraph } from '@/lib/referenceChecker';
import dagre from '@dagrejs/dagre';
import { SupabaseDataAccess } from '@/lib/dataAccess';
import { supabase } from '@/integrations/supabase/client';

import { Screen } from '@/types/telegram';
import { SyncStatus, makeRequestId } from '@/types/sync';

interface TemplateFlowDiagramProps {
  screens: Screen[];
  currentScreenId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScreenClick?: (screenId: string) => void;
  userId?: string;
  onLayoutSync?: (status: SyncStatus) => void;
  onSetEntry?: (screenId: string) => void;
  onDeleteScreen?: (screenId: string) => void;
  onCreateLink?: (sourceId: string, targetId: string) => void;
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
  onLayoutSync,
  onSetEntry,
  onDeleteScreen,
  onCreateLink,
}) => {
  const dataAccess = useMemo(() => new SupabaseDataAccess(supabase, { userId }), [userId]);
  const layoutSyncRef = useRef(onLayoutSync);
  useEffect(() => {
    layoutSyncRef.current = onLayoutSync;
  }, [onLayoutSync]);
  // 控件：布局方向与边标签
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [showButtonLabels, setShowButtonLabels] = useState<boolean>(false);
  const [focusCurrent, setFocusCurrent] = useState<boolean>(false);
  const [hideIsolated, setHideIsolated] = useState<boolean>(false);
  const [edgeStraight, setEdgeStraight] = useState<boolean>(false);
  const [nodeScale, setNodeScale] = useState<number>(1);
  const [mindMapMode, setMindMapMode] = useState<boolean>(false);
  const [isCompact, setIsCompact] = useState<boolean>(false);
  const [highlightedPath, setHighlightedPath] = useState<{ nodes: Set<string>; edges: Set<string> } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
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

    // 预先计算搜索匹配
    const lowerQuery = searchQuery.trim().toLowerCase();
    const matched = new Set<string>();
    if (lowerQuery) {
      screens.forEach(s => {
        if ((s.name || '').toLowerCase().includes(lowerQuery)) matched.add(s.id);
      });
    }

    // 简化布局：初始全部设为 (0,0)，依靠 runSmartArrange 或已保存位置
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

      const baseW = 220;
      const nodeW = Math.round(baseW * nodeScale);

      let nodeColor = 'hsl(var(--primary))';
      let nodeLabel = screen.name;
      let nodeBorderStyle = isInCycle ? 'dashed' : 'solid';
      const isMatched = matched.has(screen.id);

      // Highlight logic
      const isDimmed = highlightedPath && !highlightedPath.nodes.has(screen.id);
      const isHighlighted = highlightedPath && highlightedPath.nodes.has(screen.id);

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
        position: saved ? { x: saved.x, y: saved.y } : { x: 0, y: 0 },
        style: {
          background: 'hsl(var(--card))',
          border: `2px ${nodeBorderStyle} ${isMatched ? 'hsl(var(--primary))' : nodeColor}`,
          borderRadius: '8px',
          padding: '0',
          width: nodeW,
          cursor: 'pointer',
          boxShadow: isCurrentScreen ? '0 0 0 3px hsla(var(--primary), 0.3)' : undefined,
          opacity: isDimmed ? 0.2 : 1,
          transition: 'opacity 0.2s, border-color 0.2s',
          borderColor: isHighlighted ? 'hsl(var(--primary))' : undefined,
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

      const isEdgeDimmed = highlightedPath && !highlightedPath.edges.has(key);
      const isEdgeHighlighted = highlightedPath && highlightedPath.edges.has(key);
      const truncatedLabel = showButtonLabels
        ? (buttonList.length > 15 ? buttonList.slice(0, 15) + '...' : buttonList)
        : (data.count > 1 ? `${data.count}个按钮` : (data.buttons[0]?.length > 15 ? data.buttons[0].slice(0, 15) + '...' : data.buttons[0] ?? ''));

      edges.push({
        id: key,
        source: sourceId,
        target: targetId,
        type: edgeStraight ? 'default' : 'smoothstep',
        pathOptions: { borderRadius: 20 },
        animated: sourceId === currentScreenId || isEdgeHighlighted,
        label: truncatedLabel,
        labelStyle: {
          fill: isEdgeHighlighted ? 'hsl(var(--primary))' : 'hsl(var(--foreground))',
          fontSize: 11,
          fontWeight: 500,
          opacity: isEdgeDimmed ? 0.2 : 1,
        },
        labelBgStyle: {
          fill: 'hsl(var(--card))',
          fillOpacity: 0.9,
          opacity: isEdgeDimmed ? 0.2 : 1,
        },
        style: {
          stroke: isEdgeHighlighted ? 'hsl(var(--primary))' : (sourceId === currentScreenId ? 'hsl(var(--primary))' : 'hsl(var(--border))'),
          strokeWidth: isEdgeHighlighted ? 3 : Math.min(3.5, 1 + Math.log2(1 + data.count)),
          opacity: isEdgeDimmed ? 0.2 : 1,
          zIndex: isEdgeHighlighted ? 10 : 0,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isEdgeHighlighted ? 'hsl(var(--primary))' : (sourceId === currentScreenId ? 'hsl(var(--primary))' : 'hsl(var(--border))'),
          width: 20,
          height: 20,
        },
      });
      edgeHintMap.set(key, fullList);
    });

    return { nodes, edges, edgeHints: edgeHintMap, matchIds: matched };
  }, [screens, currentScreenId, showButtonLabels, cycleNodeIds, focusCurrent, searchQuery, nodeScale, hideIsolated, highlightedPath, edgeStraight]);

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

    const requestId = makeRequestId();
    if (userId) {
      try {
        const ids = positions.map((p) => p.id);
        if (ids.length === 0) {
          layoutSyncRef.current?.({ state: "pending", requestId, message: "清除布局中" });
          await dataAccess.deleteLayouts({ userId });
          layoutSyncRef.current?.({ state: "success", requestId, at: Date.now(), message: "已清除云端布局" });
        } else {
          layoutSyncRef.current?.({ state: "pending", requestId, message: "保存布局中" });
          await dataAccess.deleteLayouts({ userId, ids });
          const payload = positions.map((p) => ({ user_id: userId, screen_id: p.id, x: p.x, y: p.y }));
          await dataAccess.upsertLayouts(payload);
          layoutSyncRef.current?.({ state: "success", requestId, at: Date.now(), message: "布局已保存到云端" });
        }
      } catch (e) {
        layoutSyncRef.current?.({
          state: "error",
          requestId,
          message: e instanceof Error ? e.message : "布局保存失败",
        });
      }
    }

    if (!options?.silent) {
      setLayoutSaving(false);
    }
  }, [POS_KEY, userId, dataAccess]);

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
      const data = await dataAccess.fetchLayouts({ userId, ids });
      if (!data) return false;
      const m = new Map<string, { x: number; y: number }>();
      const payload: NodePositionPayload[] = [];
      data.forEach(row => {
        m.set(row.screen_id, { x: row.x, y: row.y });
        payload.push({ id: row.screen_id, x: row.x, y: row.y });
      });
      if (m.size === 0) return false;
      savedPositionsRef.current = m;
      lastSavedSignatureRef.current = serializePositions(payload);
      setLayoutSavedAt(Date.now());
      setUseSavedPositions(true);
      layoutSyncRef.current?.({ state: "success", at: Date.now(), message: "已加载云端布局" });
      return true;
    } catch (e) { layoutSyncRef.current?.({ state: "error", message: "加载云端布局失败" }); return false; }
  }, [userId, screens, dataAccess]);

  const clearLayout = useCallback(async () => {
    try { localStorage.removeItem(POS_KEY); } catch (e) { void e; }
    savedPositionsRef.current = new Map();
    lastSavedSignatureRef.current = '';
    setLayoutSavedAt(null);
    setUseSavedPositions(false);
    if (userId) {
      try {
        await dataAccess.deleteLayouts({ userId });
        layoutSyncRef.current?.({ state: "success", at: Date.now(), message: "已清空云端布局" });
      } catch (e) { /* ignore cloud errors */ }
    }
    setNodes(initialNodes);
    setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 50);
  }, [POS_KEY, initialNodes, rfInstance, setNodes, userId, dataAccess]);

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

    if (screens.length === 0) return;

    // Always use Dagre layout for consistent hierarchical structure
    // Remove custom radial/mindmap logic as requested to fix large graph layout issues

    // Auto-switch to vertical if levels are deep, otherwise keep current or default
    const { nodes: gNodes } = generateRelationshipGraph(screens);
    const levelSet = new Set<number>();
    gNodes.forEach(n => levelSet.add(n.level));
    if (levelSet.size >= 5) {
      setOrientation('vertical');
    }

    // Disable button labels for very large graphs to reduce clutter
    if (screens.length > 20) {
      setShowButtonLabels(false);
      setEdgeStraight(true);
    }

    const positions = new Map<string, { x: number; y: number }>();

    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setGraph({
      rankdir: orientation === 'horizontal' ? 'LR' : 'TB',
      ranksep: (isCompact ? 80 : 150) * nodeScale,
      nodesep: (isCompact ? 50 : 100) * nodeScale,
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
      // Fallback to simple grid if dagre fails
      const xGap = Math.round(260 * nodeScale);
      const yGap = Math.round(160 * nodeScale);
      const levelGroups = new Map<number, string[]>();
      gNodes.forEach(n => {
        const arr = levelGroups.get(n.level) || [];
        arr.push(n.id);
        levelGroups.set(n.level, arr);
      });
      const levels = Array.from(levelGroups.keys()).sort((a, b) => a - b);

      levels.forEach((lv, li) => {
        const ids = levelGroups.get(lv) || [];
        const center = (ids.length - 1) / 2;
        ids.forEach((id, idx) => {
          const x = orientation === 'horizontal' ? li * xGap : idx * xGap;
          const y = orientation === 'horizontal' ? (idx - center) * yGap : li * yGap;
          positions.set(id, { x, y });
        });
      });
    }

    if (positions.size === 0) return;

    setUseSavedPositions(false);
    setNodes(prev => prev.map(n => positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n));
    setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 80);
  }, [screens, nodeScale, orientation, setNodes, rfInstance, isCompact]);

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

  const handleNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    const connectedNodes = new Set<string>();
    const connectedEdges = new Set<string>();
    connectedNodes.add(node.id);

    // Traverse outgoing
    const traverseOut = (id: string) => {
      edges.forEach(e => {
        if (e.source === id) {
          connectedEdges.add(e.id);
          if (!connectedNodes.has(e.target)) {
            connectedNodes.add(e.target);
            traverseOut(e.target);
          }
        }
      });
    };

    // Traverse incoming
    const traverseIn = (id: string) => {
      edges.forEach(e => {
        if (e.target === id) {
          connectedEdges.add(e.id);
          if (!connectedNodes.has(e.source)) {
            connectedNodes.add(e.source);
            traverseIn(e.source);
          }
        }
      });
    };

    traverseOut(node.id);
    traverseIn(node.id);
    setHighlightedPath({ nodes: connectedNodes, edges: connectedEdges });
  }, [edges]);

  const handleNodeMouseLeave = useCallback(() => {
    setHighlightedPath(null);
  }, []);

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    // Calculate position relative to the viewport or dialog
    // Using clientX/Y for simplicity, but might need adjustment based on container
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);

  const handleContextAction = (action: 'edit' | 'entry' | 'delete') => {
    if (!contextMenu) return;
    const { nodeId } = contextMenu;
    setContextMenu(null);

    if (action === 'edit') {
      if (onScreenClick) {
        onScreenClick(nodeId);
        onOpenChange(false);
      }
    } else if (action === 'entry') {
      if (onSetEntry) {
        onSetEntry(nodeId);
        // Optional: Show toast or visual feedback
      }
    } else if (action === 'delete') {
      if (confirm('确定要删除这个模版吗？此操作不可撤销。')) {
        if (onDeleteScreen) {
          onDeleteScreen(nodeId);
        }
      }
    }
  };

  // Close context menu on click elsewhere
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

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
              <div className="flex items-center gap-2" title="紧凑模式（更密集的布局）">
                <span className="text-muted-foreground">紧凑</span>
                <Switch checked={isCompact} onCheckedChange={v => setIsCompact(!!v)} />
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
            onNodeMouseEnter={handleNodeMouseEnter}
            onNodeMouseLeave={handleNodeMouseLeave}
            onNodeContextMenu={handleNodeContextMenu}
          onEdgeMouseEnter={(e, edge) => showEdgeTooltip(e as unknown as React.MouseEvent, edge.id)}
          onEdgeMouseMove={(e) => moveEdgeTooltip(e as unknown as React.MouseEvent)}
          onEdgeMouseLeave={hideEdgeTooltip}
          onConnect={(connection: Connection) => {
            if (onCreateLink && connection.source && connection.target) {
              onCreateLink(connection.source, connection.target);
            }
          }}
          onInit={(inst) => setRfInstance(inst)}
          fitView
          fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
            minZoom={0.1}
            maxZoom={2}
            attributionPosition="bottom-left"
            snapToGrid={true}
            snapGrid={[15, 15]}
          >
            <Background color="rgba(255,255,255,0.08)" gap={15} size={1} />
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
          {contextMenu && (
            <div
              className="fixed z-50 bg-popover text-popover-foreground border rounded-md shadow-md p-1 min-w-[120px] flex flex-col"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground rounded-sm w-full text-left"
                onClick={() => handleContextAction('edit')}
              >
                <Edit className="w-4 h-4" /> 编辑模版
              </button>
              <button
                className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground rounded-sm w-full text-left"
                onClick={() => handleContextAction('entry')}
              >
                <PlayCircle className="w-4 h-4" /> 设为入口
              </button>
              <button
                className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-destructive/10 text-destructive hover:text-destructive rounded-sm w-full text-left"
                onClick={() => handleContextAction('delete')}
              >
                <Trash2 className="w-4 h-4" /> 删除模版
              </button>
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
