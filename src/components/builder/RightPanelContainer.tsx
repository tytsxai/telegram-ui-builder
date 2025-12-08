import React from "react";
import { SidebarRight } from "@/components/workbench/SidebarRight";
import { useRightPanel } from "./BuilderProvider";

export const RightPanelContainer = React.memo(() => {
  const props = useRightPanel();
  return <SidebarRight {...props} />;
});
