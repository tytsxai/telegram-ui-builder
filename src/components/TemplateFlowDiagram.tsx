import React, { useEffect, useMemo } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertCircle, Home } from 'lucide-react';

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
  // 构建节点和边
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const screenMap = new Map(screens.map(s => [s.id, s]));

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

    // 创建节点
    screens.forEach((screen, index) => {
      const isCurrentScreen = screen.id === currentScreenId;
      const isEntryPoint = !hasIncomingEdge.has(screen.id) && hasOutgoingEdge.has(screen.id);
      const isOrphan = !hasIncomingEdge.has(screen.id) && !hasOutgoingEdge.has(screen.id);
      const isEndPoint = hasIncomingEdge.has(screen.id) && !hasOutgoingEdge.has(screen.id);

      // 计算按钮统计
      const totalButtons = screen.keyboard.reduce((sum, row) => sum + row.buttons.length, 0);
      const linkedButtons = screen.keyboard.reduce(
        (sum, row) => sum + row.buttons.filter(btn => btn.linked_screen_id).length,
        0
      );

      // 使用网格布局
      const col = index % 4;
      const row = Math.floor(index / 4);

      let nodeColor = 'hsl(var(--primary))';
      let nodeLabel = screen.name;
      let nodeBorderStyle = 'solid';

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
              <div className="font-semibold text-sm truncate max-w-[150px]" title={screen.name}>
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
            </div>
          ),
        },
        position: { x: col * 250, y: row * 150 },
        style: {
          background: 'hsl(var(--card))',
          border: `2px ${nodeBorderStyle} ${nodeColor}`,
          borderRadius: '8px',
          padding: '0',
          width: 200,
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
      screen.keyboard.forEach(row => {
        row.buttons.forEach(btn => {
          if (btn.linked_screen_id && screenMap.has(btn.linked_screen_id)) {
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
      
      edges.push({
        id: key,
        source: sourceId,
        target: targetId,
        type: 'smoothstep',
        animated: sourceId === currentScreenId,
        label: data.count > 1 ? `${data.count}个按钮` : buttonList,
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
          strokeWidth: sourceId === currentScreenId ? 2 : 1.5,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: sourceId === currentScreenId ? 'hsl(var(--primary))' : 'hsl(var(--border))',
          width: 20,
          height: 20,
        },
      });
    });

    return { nodes, edges };
  }, [screens, currentScreenId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] h-[800px] p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center justify-between">
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
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
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
          </div>
          <span>点击节点可跳转到该模版</span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateFlowDiagram;
