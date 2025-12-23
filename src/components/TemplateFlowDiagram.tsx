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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { AlertCircle, Home, RotateCw, ListChecks, ArrowLeftRight, ArrowUpDown, Maximize2, Minimize2, Network, Edit, Trash2, PlayCircle, Star, Filter, Crosshair, RefreshCcw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { findAllCircularReferences, findCircularEdges, generateRelationshipGraph } from '@/lib/referenceChecker';
import { toast } from 'sonner';
import dagre from '@dagrejs/dagre';
import { SupabaseDataAccess } from '@/lib/dataAccess';
import { supabase } from '@/integrations/supabase/client';
import { hasSupabaseEnv } from '@/lib/runtimeConfig';

import { Screen } from '@/types/telegram';
import { SyncStatus, makeRequestId } from '@/types/sync';

interface TemplateFlowDiagramProps {
  screens: Screen[];
  currentScreenId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScreenClick?: (screenId: string) => void;
  userId?: string;
  entryScreenId?: string | null;
  pinnedIds?: string[];
  onLayoutSync?: (status: SyncStatus) => void;
  onSetEntry?: (screenId: string) => void;
  onDeleteScreen?: (screenId: string) => void;
  onCreateLink?: (sourceId: string, targetId: string) => void;
}

type NodePositionPayload = { id: string; x: number; y: number };

export const MAX_VISIBLE_NODES = 300;
const LAZY_BATCH_SIZE = 60;
const LAZY_BATCH_DELAY_MS = 80;
const INITIAL_BATCH_SIZE = 80;
const VIEWPORT_PADDING = 160;
const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 120;

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

const getNodeDimension = (value: unknown, fallback: number) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const isNodeInViewport = (
  node: Node,
  viewport: { x: number; y: number; zoom: number },
  containerRect?: DOMRect,
) => {
  if (!containerRect || containerRect.width === 0 || containerRect.height === 0) {
    return true;
  }
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  const viewLeft = -viewport.x / zoom - VIEWPORT_PADDING;
  const viewTop = -viewport.y / zoom - VIEWPORT_PADDING;
  const viewRight = viewLeft + containerRect.width / zoom + VIEWPORT_PADDING * 2;
  const viewBottom = viewTop + containerRect.height / zoom + VIEWPORT_PADDING * 2;
  const width = getNodeDimension(node.width ?? node.style?.width, DEFAULT_NODE_WIDTH);
  const height = getNodeDimension(node.height ?? node.style?.height, DEFAULT_NODE_HEIGHT);
  const x = node.position?.x ?? 0;
  const y = node.position?.y ?? 0;
  const right = x + Math.max(0, width);
  const bottom = y + Math.max(0, height);
  return right >= viewLeft && x <= viewRight && bottom >= viewTop && y <= viewBottom;
};

const TemplateFlowDiagram: React.FC<TemplateFlowDiagramProps> = ({
  screens,
  currentScreenId,
  open,
  onOpenChange,
  onScreenClick,
  userId,
  entryScreenId,
  pinnedIds,
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
  const ENTRY_KEY = 'telegram_ui_entry_screen';
  const [useSavedPositions, setUseSavedPositions] = useState<boolean>(false);
  const [entryId, setEntryId] = useState<string | null>(entryScreenId ?? null);
  const [pinnedState, setPinnedState] = useState<string[]>(pinnedIds ?? []);
  const [entryFilterOnly, setEntryFilterOnly] = useState<boolean>(false);
  const [pinnedFilterOnly, setPinnedFilterOnly] = useState<boolean>(false);
  const savedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [layoutSavedAt, setLayoutSavedAt] = useState<number | null>(null);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const lastSavedSignatureRef = useRef<string>('');
  const autoSaveTimerRef = useRef<number | null>(null);
  const layoutWarningRef = useRef(false);
  const supabaseEnabled = useMemo(() => hasSupabaseEnv(), []);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      layoutWarningRef.current = false;
    }
  }, [open]);

  // 同步入口/置顶信息（优先使用外部传入，其次使用本地/云端）
  useEffect(() => {
    if (typeof entryScreenId !== "undefined") {
      setEntryId(entryScreenId ?? null);
      return;
    }
    try {
      const stored = localStorage.getItem(ENTRY_KEY);
      setEntryId(stored || null);
    } catch (e) {
      void e;
    }
  }, [entryScreenId, open, ENTRY_KEY]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === ENTRY_KEY) {
        setEntryId(event.newValue || null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [ENTRY_KEY]);

  useEffect(() => {
    if (pinnedIds) {
      setPinnedState(pinnedIds);
    }
  }, [pinnedIds]);

  useEffect(() => {
    const fetchPinned = async () => {
      if (!open || !userId || !supabaseEnabled || (pinnedIds && pinnedIds.length > 0)) return;
      try {
        const cloudPins = await dataAccess.fetchPins();
        if (Array.isArray(cloudPins) && cloudPins.length > 0) {
          setPinnedState(cloudPins);
        }
      } catch (e) {
        void e;
      }
    };
    void fetchPinned();
  }, [open, userId, pinnedIds, dataAccess, supabaseEnabled]);

  // 预计算循环集合
  const cycleNodeIds = useMemo(() => {
    const cycles = findAllCircularReferences(screens);
    const ids = new Set<string>();
    cycles.forEach(c => c.path.forEach(id => ids.add(id)));
    return ids;
  }, [screens]);
  const cycleEdgeIds = useMemo(() => findCircularEdges(screens), [screens]);

  const pinnedSet = useMemo(() => new Set(pinnedIds ?? pinnedState), [pinnedIds, pinnedState]);
  const entrySet = useMemo(() => {
    const set = new Set<string>();
    if (entryId) set.add(entryId);
    return set;
  }, [entryId]);
  const entryAnchors = useMemo(() => {
    const idSet = new Set(screens.map((s) => s.id));
    const incoming = new Set<string>();
    const outgoing = new Set<string>();
    screens.forEach((screen) => {
      screen.keyboard.forEach((row) => {
        row.buttons.forEach((btn) => {
          if (btn.linked_screen_id && idSet.has(btn.linked_screen_id)) {
            incoming.add(btn.linked_screen_id);
            outgoing.add(screen.id);
          }
        });
      });
    });
    const roots = new Set<string>(entrySet);
    screens.forEach((screen) => {
      if (!incoming.has(screen.id) && outgoing.has(screen.id)) {
        roots.add(screen.id);
      }
    });
    return roots;
  }, [screens, entrySet]);

  useEffect(() => {
    if (entryAnchors.size === 0 && entryFilterOnly) {
      setEntryFilterOnly(false);
    }
  }, [entryAnchors, entryFilterOnly]);

  useEffect(() => {
    if (pinnedSet.size === 0 && pinnedFilterOnly) {
      setPinnedFilterOnly(false);
    }
  }, [pinnedSet, pinnedFilterOnly]);

  // 构建节点和边（改进：结构化分层布局 + 循环高亮 + 心智图模式）
  const { nodes: initialNodes, edges: initialEdges, edgeHints, matchIds } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const screenMap = new Map(screens.map(s => [s.id, s]));
    const edgeHintMap = new Map<string, string>();

    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();

    screens.forEach((screen) => {
      const out = new Set<string>();
      screen.keyboard.forEach((row) => {
        row.buttons.forEach((btn) => {
          if (btn.linked_screen_id && screenMap.has(btn.linked_screen_id)) {
            out.add(btn.linked_screen_id);
          }
        });
      });
      outgoing.set(screen.id, out);
      out.forEach((targetId) => {
        const prev = incoming.get(targetId) || new Set<string>();
        prev.add(screen.id);
        incoming.set(targetId, prev);
      });
    });

    const expandAround = (roots: Set<string>, depthLimit: number) => {
      const keep = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = Array.from(roots).map((id) => ({ id, depth: 0 }));
      while (queue.length) {
        const { id, depth } = queue.shift()!;
        if (keep.has(id)) continue;
        keep.add(id);
        if (depth >= depthLimit) continue;
        outgoing.get(id)?.forEach((next) => queue.push({ id: next, depth: depth + 1 }));
        incoming.get(id)?.forEach((prev) => queue.push({ id: prev, depth: depth + 1 }));
      }
      return keep;
    };

    const entryRoots = new Set<string>(entryAnchors);

    const entryScope = entryRoots.size ? expandAround(entryRoots, 1) : new Set<string>();
    const pinnedScope = pinnedSet.size ? expandAround(pinnedSet, 1) : new Set<string>();
    const focusScope = new Set<string>();
    if (focusCurrent && currentScreenId) {
      expandAround(new Set([currentScreenId]), 2).forEach((id) => focusScope.add(id));
    }

    const lowerQuery = searchQuery.trim().toLowerCase();
    const matched = new Set<string>();
    if (lowerQuery) {
      screens.forEach((s) => {
        if ((s.name || "").toLowerCase().includes(lowerQuery)) matched.add(s.id);
      });
    }

    const shouldHide = (id: string) => {
      if (hideIsolated) {
        const isolated = !(incoming.get(id)?.size) && !(outgoing.get(id)?.size);
        if (isolated) return true;
      }
      if (focusCurrent && currentScreenId && !focusScope.has(id)) return true;
      const entryPass = !entryFilterOnly || entryScope.size === 0 || entryScope.has(id);
      const pinnedPass = !pinnedFilterOnly || pinnedScope.size === 0 || pinnedScope.has(id);
      const anyFilterActive = (entryFilterOnly && entryScope.size > 0) || (pinnedFilterOnly && pinnedScope.size > 0);
      if (anyFilterActive && !(entryPass || pinnedPass)) return true;
      return false;
    };

    screens.forEach((screen) => {
      if (shouldHide(screen.id)) return;

      const isCurrentScreen = screen.id === currentScreenId;
      const hasIn = incoming.get(screen.id)?.size ?? 0;
      const hasOut = outgoing.get(screen.id)?.size ?? 0;
      const isEntryPoint = entryRoots.has(screen.id);
      const isPinned = pinnedSet.has(screen.id);
      const isOrphan = hasIn === 0 && hasOut === 0;
      const isEndPoint = hasIn > 0 && hasOut === 0;
      const isInCycle = cycleNodeIds.has(screen.id);
      const inEntryScope = entryScope.has(screen.id);
      const inPinnedScope = pinnedScope.has(screen.id);

      // 计算按钮统计
      const totalButtons = screen.keyboard.reduce((sum, row) => sum + row.buttons.length, 0);
      const linkedButtons = screen.keyboard.reduce(
        (sum, row) => sum + row.buttons.filter(btn => btn.linked_screen_id).length,
        0
      );

      const baseW = DEFAULT_NODE_WIDTH;
      const nodeW = Math.round(baseW * nodeScale);

      let nodeColor = 'hsl(var(--primary))';
      let nodeBorderStyle = isInCycle ? 'dashed' : 'solid';
      const isMatched = matched.has(screen.id);

      // Hover/高亮逻辑
      const isDimmed = highlightedPath && !highlightedPath.nodes.has(screen.id);
      const isHighlighted = highlightedPath && highlightedPath.nodes.has(screen.id);

      if (isCurrentScreen) {
        nodeColor = 'hsl(var(--primary))';
        nodeBorderStyle = 'solid';
      } else if (isPinned) {
        nodeColor = 'rgb(234, 179, 8)';
      } else if (isEntryPoint) {
        nodeColor = 'hsl(var(--success, 142 76% 36%))';
      } else if (isOrphan) {
        nodeColor = 'hsl(var(--destructive))';
      } else if (isEndPoint) {
        nodeColor = 'hsl(var(--secondary-foreground))';
      }

      // 允许应用已保存的位置
      const saved = savedPositionsRef.current.get(screen.id);
      nodes.push({
        id: screen.id,
        type: 'default',
        data: {
          label: (
            <div className="flex flex-col items-start gap-1 p-2">
              <div className="flex items-start justify-between gap-2 w-full">
                <div
                  className="font-semibold text-sm break-words leading-tight flex-1"
                  style={{ maxWidth: nodeW - 80, maxHeight: 36, overflow: 'hidden' }}
                  title={screen.name}
                >
                  {screen.name}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isEntryPoint && (
                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 text-[10px] inline-flex items-center gap-1">
                      <Home className="w-3 h-3" /> 入口
                    </span>
                  )}
                  {isPinned && (
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 text-[10px] inline-flex items-center gap-1">
                      <Star className="w-3 h-3" /> 置顶
                    </span>
                  )}
                </div>
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
              <div className="flex flex-wrap gap-1 text-[10px]">
                {isInCycle && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 inline-flex items-center gap-1">
                    <RefreshCcw className="w-3 h-3" /> 循环
                  </span>
                )}
                {!isEntryPoint && inEntryScope && (
                  <span className="px-1 py-0.5 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                    <Home className="w-3 h-3" /> 入口邻近
                  </span>
                )}
                {!isPinned && inPinnedScope && (
                  <span className="px-1 py-0.5 rounded-full bg-amber-50 text-amber-700 inline-flex items-center gap-1">
                    <Star className="w-3 h-3" /> 置顶邻近
                  </span>
                )}
                {isMatched && (
                  <span className="px-1 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">匹配</span>
                )}
              </div>
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

    screens.forEach((screen) => {
      if (shouldHide(screen.id)) return;
      screen.keyboard.forEach((row) => {
        row.buttons.forEach((btn) => {
          if (btn.linked_screen_id && screenMap.has(btn.linked_screen_id)) {
            if (shouldHide(btn.linked_screen_id)) return;
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

      const isCycleEdge = cycleEdgeIds.has(key);
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
        animated: sourceId === currentScreenId || isEdgeHighlighted || isCycleEdge,
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
          stroke: isEdgeHighlighted
            ? 'hsl(var(--primary))'
            : (isCycleEdge
              ? 'rgb(234, 179, 8)'
              : (sourceId === currentScreenId ? 'hsl(var(--primary))' : 'hsl(var(--border))')),
          strokeWidth: isEdgeHighlighted ? 3 : Math.min(3.5, 1 + Math.log2(1 + data.count)),
          opacity: isEdgeDimmed ? 0.2 : 1,
          zIndex: isEdgeHighlighted || isCycleEdge ? 10 : 0,
          strokeDasharray: isCycleEdge ? '6 4' : undefined,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isEdgeHighlighted || isCycleEdge ? 'hsl(var(--primary))' : (sourceId === currentScreenId ? 'hsl(var(--primary))' : 'hsl(var(--border))'),
          width: 20,
          height: 20,
        },
      });
      edgeHintMap.set(key, fullList);
    });

    return { nodes, edges, edgeHints: edgeHintMap, matchIds: matched };
  }, [screens, currentScreenId, showButtonLabels, cycleNodeIds, focusCurrent, searchQuery, nodeScale, hideIsolated, highlightedPath, edgeStraight, entryFilterOnly, pinnedFilterOnly, pinnedSet, entryAnchors, cycleEdgeIds]);

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
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const [renderBudget, setRenderBudget] = useState(0);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) return;
    const updateRect = () => {
      if (diagramRef.current) {
        setContainerRect(diagramRef.current.getBoundingClientRect());
        return;
      }
      setContainerRect(new DOMRect(0, 0, window.innerWidth, window.innerHeight));
    };
    updateRect();
    if (!diagramRef.current) return;
    const observer = new ResizeObserver(updateRect);
    observer.observe(diagramRef.current);
    window.addEventListener("resize", updateRect);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateRect);
    };
  }, [open]);

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
    if (userId && supabaseEnabled) {
      try {
        const ids = positions.map((p) => p.id);
        if (ids.length === 0) {
          layoutSyncRef.current?.({ state: "pending", requestId, message: "清除布局中" });
          await dataAccess.deleteLayouts({});
          layoutSyncRef.current?.({ state: "success", requestId, at: Date.now(), message: "已清除云端布局" });
        } else {
          layoutSyncRef.current?.({ state: "pending", requestId, message: "保存布局中" });
          await dataAccess.deleteLayouts({ ids });
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
  }, [POS_KEY, userId, dataAccess, supabaseEnabled]);

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

  const visibleCandidates = useMemo(
    () => nodes.filter((node) => isNodeInViewport(node, viewport, containerRect ?? undefined)).slice(0, MAX_VISIBLE_NODES),
    [nodes, viewport, containerRect],
  );

  useEffect(() => {
    if (!open) return;
    if (visibleCandidates.length === 0) {
      setRenderBudget(0);
      return;
    }
    let active = true;
    let timer: number | null = null;
    const initialBatch = Math.min(INITIAL_BATCH_SIZE, visibleCandidates.length);
    setRenderBudget(initialBatch);
    const schedule = (current: number) => {
      if (!active || current >= visibleCandidates.length) return;
      timer = window.setTimeout(() => {
        setRenderBudget((prev) => Math.min(visibleCandidates.length, prev + LAZY_BATCH_SIZE));
        schedule(current + LAZY_BATCH_SIZE);
      }, LAZY_BATCH_DELAY_MS);
    };
    schedule(initialBatch);
    return () => {
      active = false;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [visibleCandidates.length, open]);

  const visibleNodes = useMemo(() => visibleCandidates.slice(0, renderBudget), [visibleCandidates, renderBudget]);
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [edges, visibleNodeIds],
  );

  const showPerformanceWarning = screens.length > MAX_VISIBLE_NODES;

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

    const entryPoints = entryAnchors.size;
    const orphans = screens.filter(s => !hasIncoming.has(s.id) && !hasOutgoing.has(s.id)).length;
    const endpoints = screens.filter(s => hasIncoming.has(s.id) && !hasOutgoing.has(s.id)).length;

    return {
      totalScreens,
      entryPoints,
      orphans,
      endpoints,
      totalLinks: edges.length,
      pinned: pinnedSet.size,
      cycles: cycleNodeIds.size,
    };
  }, [screens, edges, entryAnchors, pinnedSet, cycleNodeIds]);

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    if (onScreenClick) {
      onScreenClick(node.id);
      onOpenChange(false);
    }
  };

  const focusOnNodeIds = useCallback((ids: Set<string>) => {
    if (!rfInstance || ids.size === 0) return;
    const targetNodes = nodes.filter((n) => ids.has(n.id));
    if (targetNodes.length === 0) return;
    const xs = targetNodes.map((n) => n.position?.x ?? 0);
    const ys = targetNodes.map((n) => n.position?.y ?? 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = minX + (maxX - minX) / 2 + 110;
    const centerY = minY + (maxY - minY) / 2 + 55;
    const zoom = Math.max(0.4, Math.min(1.3, 1.05 - targetNodes.length * 0.03));
    rfInstance.setCenter(centerX, centerY, { zoom, duration: 400 });
  }, [nodes, rfInstance]);

  const handleFocusEntry = useCallback(() => focusOnNodeIds(entryAnchors), [focusOnNodeIds, entryAnchors]);
  const handleFocusPinned = useCallback(() => focusOnNodeIds(pinnedSet), [focusOnNodeIds, pinnedSet]);

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
    if (!userId || !supabaseEnabled) return false;
    try {
      const ids = screens.map(s => s.id);
      if (ids.length === 0) return false;
      const data = await dataAccess.fetchLayouts({ ids });
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
  }, [userId, screens, dataAccess, supabaseEnabled]);

  const clearLayout = useCallback(async () => {
    try { localStorage.removeItem(POS_KEY); } catch (e) { void e; }
    savedPositionsRef.current = new Map();
    lastSavedSignatureRef.current = '';
    setLayoutSavedAt(null);
    setUseSavedPositions(false);
    if (userId && supabaseEnabled) {
      try {
        await dataAccess.deleteLayouts({});
        layoutSyncRef.current?.({ state: "success", at: Date.now(), message: "已清空云端布局" });
      } catch (e) { /* ignore cloud errors */ }
    }
    setNodes(initialNodes);
    setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 50);
  }, [POS_KEY, initialNodes, rfInstance, setNodes, userId, dataAccess, supabaseEnabled]);

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
      if (!layoutWarningRef.current) {
        toast.warning("关系图布局失败，使用简化网格布局");
        layoutWarningRef.current = true;
      }
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
      setEntryId(nodeId);
      try {
        localStorage.setItem(ENTRY_KEY, nodeId);
      } catch (e) {
        void e;
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
                <span className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-500" />
                  置顶: {stats.pinned}
                </span>
                <span>终点: {stats.endpoints}</span>
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-destructive" />
                  孤立: {stats.orphans}
                </span>
                <span className="flex items-center gap-2">
                  <RefreshCcw className="w-4 h-4 text-amber-600" />
                  循环: {stats.cycles}
                </span>
                <span>总链接: {stats.totalLinks}</span>
              </div>
            </div>
            {showPerformanceWarning && (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertCircle className="h-4 w-4" />
                节点过多，已启用视口裁剪与分批加载，最多渲染 {MAX_VISIBLE_NODES} 个节点。
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm font-normal text-muted-foreground">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOrientation(o => o === 'horizontal' ? 'vertical' : 'horizontal')}
                title="切换布局方向"
                disabled={!screens.length}
              >
                {orientation === 'horizontal' ? <ArrowLeftRight className="w-4 h-4 mr-1" /> : <ArrowUpDown className="w-4 h-4 mr-1" />}
                {orientation === 'horizontal' ? '水平' : '垂直'}
              </Button>
              <Button
                size="sm"
                onClick={runSmartArrange}
                title="智能整理（自动选择并细化布局顺序）"
                disabled={!screens.length}
              >
                <Network className="w-4 h-4 mr-1" /> 智能整理
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setUseSavedPositions(false); setNodes(initialNodes); setEdges(initialEdges); setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 50); }}
                title="重新布局（自动排布）"
                disabled={!screens.length}
              >
                <RotateCw className="w-4 h-4 mr-1" /> 重新布局
              </Button>
              <Button variant="outline" size="sm" onClick={() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 })} title="重置视图" disabled={!screens.length}>
                重置视图
              </Button>
              <Button variant="ghost" size="sm" onClick={handleFocusEntry} title="入口节点居中显示" disabled={!screens.length || entryAnchors.size === 0}>
                <Crosshair className="w-4 h-4 mr-1" /> 入口视图
              </Button>
              <Button variant="ghost" size="sm" onClick={handleFocusPinned} title="置顶节点居中显示" disabled={!screens.length || pinnedSet.size === 0}>
                <Crosshair className="w-4 h-4 mr-1" /> 置顶视图
              </Button>
              <div className="flex items-center gap-2" title="显示边上的按钮名称">
                <ListChecks className="w-4 h-4" />
                <Switch aria-label="显示按钮标签" checked={showButtonLabels} onCheckedChange={v => setShowButtonLabels(!!v)} />
              </div>
              <div className="flex items-center gap-2" title="只显示与当前模版相关的节点（上下游2层）">
                <span className="text-muted-foreground">仅关联</span>
                <Switch aria-label="仅关联" checked={focusCurrent} onCheckedChange={v => setFocusCurrent(!!v)} />
              </div>
              <div className="flex items-center gap-2" title="心智图模式（从中心向两侧发散）">
                <span className="text-muted-foreground">心智图</span>
                <Switch aria-label="心智图" checked={mindMapMode} onCheckedChange={v => { setMindMapMode(!!v); setTimeout(() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 }), 50); }} />
              </div>
              <div className="flex items-center gap-2" title="紧凑模式（更密集的布局）">
                <span className="text-muted-foreground">紧凑</span>
                <Switch aria-label="紧凑模式" checked={isCompact} onCheckedChange={v => setIsCompact(!!v)} />
              </div>
              <div className="flex items-center gap-2" title="隐藏孤立节点（未被引用且无输出）">
                <span className="text-muted-foreground">隐藏孤立</span>
                <Switch aria-label="隐藏孤立" checked={hideIsolated} onCheckedChange={v => setHideIsolated(!!v)} />
              </div>
              <div className="flex items-center gap-2" title="只显示入口节点及一层上下游">
                <Filter className="w-4 h-4" />
                <span className="text-muted-foreground">入口筛选</span>
                <Switch aria-label="入口筛选" checked={entryFilterOnly} onCheckedChange={v => setEntryFilterOnly(!!v)} disabled={entryAnchors.size === 0} />
              </div>
              <div className="flex items-center gap-2" title="只显示置顶节点及一层上下游">
                <Star className="w-4 h-4 text-amber-500" />
                <span className="text-muted-foreground">置顶筛选</span>
                <Switch aria-label="置顶筛选" checked={pinnedFilterOnly} onCheckedChange={v => setPinnedFilterOnly(!!v)} disabled={pinnedSet.size === 0} />
              </div>
              <div className="flex items-center gap-2" title="边样式：直线/曲线">
                <span className="text-muted-foreground">直线边</span>
                <Switch aria-label="直线边" checked={edgeStraight} onCheckedChange={v => setEdgeStraight(!!v)} />
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
          <DialogDescription className="sr-only">
            可视化查看模版节点的入口、置顶、循环关系并调整布局。
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 relative overflow-hidden" ref={diagramRef}>
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
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
          onInit={(inst) => {
            setRfInstance(inst);
            if ("getViewport" in inst && typeof inst.getViewport === "function") {
              setViewport(inst.getViewport());
            }
          }}
          onMove={(_event, nextViewport) => {
            if (nextViewport) setViewport(nextViewport);
          }}
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
                if (entryAnchors.has(node.id)) return 'hsl(var(--success, 142 76% 36%))';
                if (pinnedSet.has(node.id)) return 'rgb(234, 179, 8)';
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
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              ★ 置顶（收藏节点）
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
