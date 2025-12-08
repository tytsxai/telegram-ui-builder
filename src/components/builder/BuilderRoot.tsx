import React from "react";
import { WorkbenchLayout } from "@/components/workbench/WorkbenchLayout";
import { BuilderProvider } from "./BuilderProvider";
import { LeftPanelContainer } from "./LeftPanelContainer";
import { RightPanelContainer } from "./RightPanelContainer";
import { CenterCanvasContainer } from "./CenterCanvasContainer";
import { BottomPanelContainer } from "./BottomPanelContainer";
import { BuilderDialogs } from "./BuilderDialogs";

export const BuilderRoot = () => {
  return (
    <BuilderProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <WorkbenchLayout
          leftPanel={<LeftPanelContainer />}
          rightPanel={<RightPanelContainer />}
          centerCanvas={<CenterCanvasContainer />}
          bottomPanel={<BottomPanelContainer />}
        />
        <BuilderDialogs />
      </div>
    </BuilderProvider>
  );
};
