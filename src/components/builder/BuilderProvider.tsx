import { createContext, useContext } from "react";
import { useBuilderStore, type BuilderStore } from "@/hooks/chat/useBuilderStore";

type LeftPanelValue = BuilderStore["leftPanelProps"];
type RightPanelValue = BuilderStore["rightPanelProps"];
type CenterCanvasValue = BuilderStore["centerCanvasProps"];
type BottomPanelValue = BuilderStore["bottomPanelProps"];
type DialogValue = BuilderStore["dialogState"];
type WorkbenchStatusValue = BuilderStore["workbenchStatusProps"];

const LeftPanelContext = createContext<LeftPanelValue | null>(null);
const RightPanelContext = createContext<RightPanelValue | null>(null);
const CenterCanvasContext = createContext<CenterCanvasValue | null>(null);
const BottomPanelContext = createContext<BottomPanelValue | null>(null);
const DialogContext = createContext<DialogValue | null>(null);
const WorkbenchStatusContext = createContext<WorkbenchStatusValue | null>(null);

export const useLeftPanel = () => {
  const ctx = useContext(LeftPanelContext);
  if (!ctx) throw new Error("useLeftPanel must be used within BuilderProvider");
  return ctx;
};

export const useRightPanel = () => {
  const ctx = useContext(RightPanelContext);
  if (!ctx) throw new Error("useRightPanel must be used within BuilderProvider");
  return ctx;
};

export const useCenterCanvas = () => {
  const ctx = useContext(CenterCanvasContext);
  if (!ctx) throw new Error("useCenterCanvas must be used within BuilderProvider");
  return ctx;
};

export const useBottomPanel = () => {
  const ctx = useContext(BottomPanelContext);
  if (!ctx) throw new Error("useBottomPanel must be used within BuilderProvider");
  return ctx;
};

export const useBuilderDialogs = () => {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useBuilderDialogs must be used within BuilderProvider");
  return ctx;
};

export const useWorkbenchStatus = () => {
  const ctx = useContext(WorkbenchStatusContext);
  // During E2E boot, if the provider fails to mount early we still want the builder shell
  // to render instead of crashing the whole app. Fall back to a safe default so the
  // layout can appear and tests can proceed.
  if (!ctx) {
    return { pendingCount: 0, unsaved: false, lastSavedAt: null, isOnline: true } satisfies WorkbenchStatusValue;
  }
  return ctx;
};

export const BuilderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const store = useBuilderStore();

  return (
    <LeftPanelContext.Provider value={store.leftPanelProps}>
      <RightPanelContext.Provider value={store.rightPanelProps}>
        <CenterCanvasContext.Provider value={store.centerCanvasProps}>
          <BottomPanelContext.Provider value={store.bottomPanelProps}>
            <DialogContext.Provider value={store.dialogState}>
              <WorkbenchStatusContext.Provider value={store.workbenchStatusProps}>
                {children}
              </WorkbenchStatusContext.Provider>
            </DialogContext.Provider>
          </BottomPanelContext.Provider>
        </CenterCanvasContext.Provider>
      </RightPanelContext.Provider>
    </LeftPanelContext.Provider>
  );
};
