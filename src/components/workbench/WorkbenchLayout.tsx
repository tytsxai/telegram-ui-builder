import React, { useState, useEffect } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Badge } from "@/components/ui/badge";
import { WifiOff, Wifi, Clock3, Loader2 } from "lucide-react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

interface WorkbenchLayoutProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  centerCanvas: React.ReactNode;
  bottomPanel: React.ReactNode;
  pendingCount?: number;
  unsaved?: boolean;
  lastSavedAt?: string | null;
  isOnline?: boolean;
}

export const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({
  leftPanel,
  rightPanel,
  centerCanvas,
  bottomPanel,
  pendingCount = 0,
  unsaved = false,
  lastSavedAt = null,
  isOnline = true,
}) => {
  const [isBottomCollapsed, setIsBottomCollapsed] = useState(false);
  const network = useNetworkStatus();
  const online = isOnline ?? network.isOnline;

  // 默认在小屏下折叠底部面板，避免遮挡
  useEffect(() => {
    if (typeof window === "undefined") return;
    const shouldCollapse = window.innerWidth < 768;
    setIsBottomCollapsed(shouldCollapse);
  }, []);
  const [bottomPanelSize, setBottomPanelSize] = useState(25);

  React.useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsBottomCollapsed(true);
        setBottomPanelSize(5); // Small default size for mobile
      }
    };

    // Initial check
    if (window.innerWidth < 768) {
      setIsBottomCollapsed(true);
      setBottomPanelSize(5);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="h-screen w-full bg-transparent overflow-hidden">
      <div
        className="h-10 px-4 flex items-center gap-3 text-xs text-muted-foreground bg-card/60 backdrop-blur border-b border-border/50"
        role="status"
        aria-live="polite"
      >
        <Badge variant="secondary" className="flex items-center gap-1 bg-muted/70 border-border/70">
          {online ? <Wifi className="w-3 h-3" aria-hidden /> : <WifiOff className="w-3 h-3" aria-hidden />}
          <span>{online ? "在线" : "离线"}</span>
        </Badge>

        <div className="flex items-center gap-1" aria-label={`待同步操作 ${pendingCount} 条`}>
          <Loader2 className={`w-3 h-3 ${pendingCount > 0 ? "text-amber-500 animate-spin" : "text-muted-foreground/60"}`} aria-hidden />
          <span>待同步 {pendingCount}</span>
        </div>

        <div className="flex items-center gap-1" aria-label={unsaved ? "存在未保存更改" : `最近保存于 ${lastSavedAt ?? "未知"}`}>
          <Clock3 className="w-3 h-3" aria-hidden />
          {unsaved ? <span className="text-amber-500">未保存</span> : <span>已保存 {lastSavedAt ?? "刚刚"}</span>}
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal">
        {/* Left Panel */}
        <ResizablePanel
          defaultSize={20}
          minSize={15}
          maxSize={25}
          className="bg-card/40 backdrop-blur-xl border-r border-white/5 hidden md:block"
        >
          <div className="h-full overflow-y-auto">
            {leftPanel}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Center & Bottom Group */}
        <ResizablePanel defaultSize={60}>
          <ResizablePanelGroup direction="vertical">
            {/* Center Canvas */}
            <ResizablePanel defaultSize={75} className="bg-transparent relative">
              <div className="h-full w-full overflow-y-auto flex items-center justify-center p-4 md:p-8">
                {centerCanvas}
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Bottom Panel */}
            <ResizablePanel
              defaultSize={bottomPanelSize}
              minSize={5}
              collapsible={true}
              collapsedSize={0}
              onCollapse={() => setIsBottomCollapsed(true)}
              onExpand={() => setIsBottomCollapsed(false)}
              className={`bg-card/40 backdrop-blur-xl border-t border-white/5 flex flex-col transition-all duration-300 ${isBottomCollapsed ? 'min-h-[36px]' : ''}`}
            >
              <div className="flex flex-col h-full">
                {/* Header for manual toggle if needed, or just rely on drag */}
                <div
                  className="h-9 flex-shrink-0 flex items-center justify-between px-4 border-b border-border/50 bg-muted/20 select-none cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => setIsBottomCollapsed(!isBottomCollapsed)}
                >
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isBottomCollapsed ? 'bg-slate-400' : 'bg-green-500'}`} />
                    系统日志 & JSON 预览
                  </span>
                  <span className="text-xs text-muted-foreground/50">
                    {isBottomCollapsed ? '展开' : '收起'}
                  </span>
                </div>
                <div className={`flex-1 overflow-y-auto ${isBottomCollapsed ? 'hidden' : ''}`}>
                  {bottomPanel}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right Panel */}
        <ResizablePanel
          defaultSize={20}
          minSize={15}
          maxSize={25}
          className="bg-card/40 backdrop-blur-xl border-l border-white/5 hidden lg:block"
        >
          <div className="h-full overflow-y-auto">
            {rightPanel}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
