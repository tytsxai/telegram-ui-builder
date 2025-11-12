import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, Network } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Screen {
  id: string;
  name: string;
}

interface CircularPath {
  path: string[];
  screenNames: string[];
}

interface CircularReferenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  circularPaths: CircularPath[];
  screens: Screen[];
  currentScreenId: string | null;
  onNavigateToScreen: (screenId: string) => void;
  onOpenFlowDiagram: () => void;
}

export default function CircularReferenceDialog({
  open,
  onOpenChange,
  circularPaths,
  screens,
  currentScreenId,
  onNavigateToScreen,
  onOpenFlowDiagram,
}: CircularReferenceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="w-5 h-5" />
            检测到循环引用
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-foreground">
              模版中存在循环导航路径，这可能导致用户无法退出循环。
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <h4 className="font-semibold text-sm text-foreground">循环路径详情：</h4>
            {circularPaths.map((circular, index) => (
              <div 
                key={index}
                className="p-4 border border-destructive/50 bg-destructive/10 rounded-lg space-y-3"
              >
                <div className="flex items-start gap-2">
                  <span className="text-destructive font-semibold text-sm shrink-0">
                    路径 {index + 1}:
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {circular.screenNames.map((name, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const screenId = circular.path[i];
                            if (screenId) {
                              onNavigateToScreen(screenId);
                              onOpenChange(false);
                            }
                          }}
                          className="px-2 py-1 bg-muted hover:bg-accent text-foreground rounded text-sm font-medium transition-colors"
                        >
                          {name}
                        </button>
                        {i < circular.screenNames.length - 1 && (
                          <span className="text-muted-foreground">→</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
            <h4 className="font-semibold text-sm text-foreground">如何解决？</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="shrink-0 text-foreground">1.</span>
                <span>点击上方的模版名称可以快速跳转到对应模版</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-foreground">2.</span>
                <span>移除循环路径中某个按钮的链接，打破循环</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-foreground">3.</span>
                <span>调整按钮链接目标，重新设计导航流程</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-foreground">4.</span>
                <span>使用关系图查看完整的模版结构和导航关系</span>
              </li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={onOpenFlowDiagram}
            className="w-full sm:w-auto"
          >
            <Network className="w-4 h-4 mr-2" />
            查看关系图
          </Button>
          <Button
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            我知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
