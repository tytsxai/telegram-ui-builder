import React from "react";
import { WorkbenchLayout } from "@/components/workbench/WorkbenchLayout";
import { BuilderProvider } from "./BuilderProvider";
import { LeftPanelContainer } from "./LeftPanelContainer";
import { RightPanelContainer } from "./RightPanelContainer";
import { CenterCanvasContainer } from "./CenterCanvasContainer";
import { BottomPanelContainer } from "./BottomPanelContainer";
import { BuilderDialogs } from "./BuilderDialogs";
import { useWorkbenchStatus } from "./BuilderProvider";

const WorkbenchWithStatus = () => {
  const status = useWorkbenchStatus();

  return (
    <WorkbenchLayout
      leftPanel={<LeftPanelContainer />}
      rightPanel={<RightPanelContainer />}
      centerCanvas={<CenterCanvasContainer />}
      bottomPanel={<BottomPanelContainer />}
      pendingCount={status.pendingCount}
      unsaved={status.unsaved}
      lastSavedAt={status.lastSavedAt}
    />
  );
};

export const BuilderRoot = () => {
  // Workbench status is driven by builder store (pending queue, unsaved, last-saved)
  return (
    <BuilderProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <WorkbenchWithStatus />
        <BuilderDialogs />
      </div>
    </BuilderProvider>
  );
};
