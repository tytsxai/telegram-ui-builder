import React, { useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

interface WorkbenchLayoutProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  centerCanvas: React.ReactNode;
  bottomPanel: React.ReactNode;
}

export const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({
  leftPanel,
  rightPanel,
  centerCanvas,
  bottomPanel,
}) => {
  const [isBottomCollapsed, setIsBottomCollapsed] = useState(false);

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
    <div className="h-screen w-full bg-background overflow-hidden">
      <ResizablePanelGroup direction="horizontal">
        {/* Left Panel */}
        <ResizablePanel
          defaultSize={20}
          minSize={15}
          maxSize={25}
          className="bg-card/50 backdrop-blur-sm border-r border-border hidden md:block"
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
            <ResizablePanel defaultSize={75} className="bg-slate-50/50 dark:bg-slate-950/50 relative">
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
              className={`bg-card/50 backdrop-blur-sm border-t border-border flex flex-col transition-all duration-300 ${isBottomCollapsed ? 'min-h-[36px]' : ''}`}
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
          className="bg-card/50 backdrop-blur-sm border-l border-border hidden lg:block"
        >
          <div className="h-full overflow-y-auto">
            {rightPanel}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
