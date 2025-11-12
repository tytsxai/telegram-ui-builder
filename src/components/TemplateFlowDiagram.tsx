import React, { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { AlertCircle, Home, RotateCw, ListChecks, ArrowLeftRight, ArrowUpDown } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { findAllCircularReferences, generateRelationshipGraph } from '@/lib/referenceChecker';

interface Screen {
  id: string;
  name: string;
  keyboard: KeyboardRow[];
  message_content: string;
}

interface KeyboardRow {
  id: string;
  buttons: KeyboardButton[];
}

interface KeyboardButton {
  id: string;
  text: string;
  url?: string;
  callback_data?: string;
  linked_screen_id?: string;
}

interface TemplateFlowDiagramProps {
  screens: Screen[];
  currentScreenId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScreenClick?: (screenId: string) => void;
}

const TemplateFlowDiagram: React.FC<TemplateFlowDiagramProps> = ({
  screens,
  currentScreenId,
  open,
  onOpenChange,
  onScreenClick,
}) => {
  // 控件：布局方向与边标签
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [showButtonLabels, setShowButtonLabels] = useState<boolean>(false);
  const [focusCurrent, setFocusCurrent] = useState<boolean>(false);
  const [hideIsolated, setHideIsolated] = useState<boolean>(false);
  const [edgeStraight, setEdgeStraight] = useState<boolean>(false);
  const [nodeScale, setNodeScale] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const diagramRef = useRef<HTMLDivElement | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  // 预计算循环集合
  const cycleNodeIds = useMemo(() => {
    const cycles = findAllCircularReferences(screens);
    const ids = new Set<string>();
    cycles.forEach(c => c.path.forEach(id => ids.add(id)));
    return ids;
  }, [screens]);

  // 构建节点和边（改进：结构化分层布局 + 循环高亮）
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

    // 使用结构化布局：按层级摆放
    const { nodes: gNodes } = generateRelationshipGraph(screens);
    const levelGroups = new Map<number, string[]>();
    gNodes.forEach(n => {
      const list = levelGroups.get(n.level) || [];
      list.push(n.id);
      levelGroups.set(n.level, list);
    });

    // 对每一层按名称排序，提升可读性
    const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
    const levelIndexMap = new Map<string, { level: number; index: number }>();
    sortedLevels.forEach(level => {
      const ids = (levelGroups.get(level) || []).slice().sort((a, b) => {
        const an = screenMap.get(a)?.name || '';
        const bn = screenMap.get(b)?.name || '';
        return an.localeCompare(bn, 'zh');
      });
      ids.forEach((id, idx) => levelIndexMap.set(id, { level, index: idx }));
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
      const yGap = Math.round(180 * nodeScale);
      const x = orientation === 'horizontal' ? li.level * xGap : li.index * xGap;
      const y = orientation === 'horizontal' ? li.index * yGap : li.level * yGap;

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
        position: { x, y },
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
        type: edgeStraight ? 'straight' : 'smoothstep',
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
  }, [screens, currentScreenId, orientation, showButtonLabels, cycleNodeIds, focusCurrent, searchQuery, nodeScale, hideIsolated, edgeStraight]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [edgeHintsMap, setEdgeHintsMap] = useState<Map<string, string>>(edgeHints);
  useEffect(() => setEdgeHintsMap(edgeHints), [edgeHints]);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

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
      <DialogContent className="max-w-[95vw] max-h-[95vh] h-[800px] p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center justify-between w-full">
            <span>模版关系图</span>
            <div className="flex items-center gap-4 text-sm font-normal text-muted-foreground">
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
              {/* 控件区 */}
              <div className="flex items-center gap-3 ml-4">
                <Button variant="outline" size="sm" onClick={() => setOrientation(o => o === 'horizontal' ? 'vertical' : 'horizontal')} title="切换布局方向">
                  {orientation === 'horizontal' ? <ArrowLeftRight className="w-4 h-4 mr-1" /> : <ArrowUpDown className="w-4 h-4 mr-1" />}
                  {orientation === 'horizontal' ? '水平' : '垂直'}
                </Button>
                <div className="flex items-center gap-2" title="显示边上的按钮名称">
                  <ListChecks className="w-4 h-4" />
                  <Switch checked={showButtonLabels} onCheckedChange={v => setShowButtonLabels(!!v)} />
                </div>
                <div className="flex items-center gap-2" title="只显示与当前模版相关的节点（上下游2层）">
                  <span className="text-muted-foreground">仅关联</span>
                  <Switch checked={focusCurrent} onCheckedChange={v => setFocusCurrent(!!v)} />
                </div>
                <div className="flex items-center gap-2" title="隐藏孤立节点（未被引用且无输出）">
                  <span className="text-muted-foreground">隐藏孤立</span>
                  <Switch checked={hideIsolated} onCheckedChange={v => setHideIsolated(!!v)} />
                </div>
                <div className="flex items-center gap-2" title="边样式：直线/曲线">
                  <span className="text-muted-foreground">直线边</span>
                  <Switch checked={edgeStraight} onCheckedChange={v => setEdgeStraight(!!v)} />
                </div>
                <Button variant="outline" size="sm" onClick={() => { setNodes(initialNodes); setEdges(initialEdges); }} title="重新布局">
                  <RotateCw className="w-4 h-4 mr-1" /> 重新布局
                </Button>
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
                    className="h-8 w-40"
                  />
                </div>
                <div className="flex items-center gap-2 w-40" title="节点尺寸/间距">
                  <span className="text-muted-foreground text-xs">尺寸</span>
                  <Slider min={0.8} max={1.6} step={0.1} value={[nodeScale]} onValueChange={(v) => setNodeScale(v[0] ?? 1)} />
                </div>
                <Button variant="outline" size="sm" onClick={() => rfInstance?.fitView({ padding: 0.2, maxZoom: 1 })} title="重置视图">
                  重置视图
                </Button>
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 relative" ref={diagramRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onEdgeMouseEnter={(e, edge) => showEdgeTooltip(e as unknown as React.MouseEvent, edge.id)}
            onEdgeMouseMove={(e) => moveEdgeTooltip(e as unknown as React.MouseEvent)}
            onEdgeMouseLeave={hideEdgeTooltip}
            onInit={(inst) => setRfInstance(inst)}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
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
